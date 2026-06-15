import {
  access,
  chmod,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import archiver, { type Archiver } from "archiver";
import { PaaWebpConverter } from "./paa.js";
import { PboArchive } from "./pbo.js";

const execFileAsync = promisify(execFile);
const ZIP_DEBINARIZED_MISSION_NAME = "deb-mission.sqm";

export type DebinarizedMissionResult = {
  status: "success" | "skipped" | "failed";
  outputPath?: string;
  reason?: string;
};

export type ParseMissionJsonResult = {
  status: "success" | "failed";
  missionJSON?: Record<string, unknown>;
  reason?: string;
};

export class PboService {
  private readonly tempRoot = path.join("src", "temp");
  private readonly paaWebp = new PaaWebpConverter();

  constructor(private readonly clearTimeoutMs: number) {}

  async clearTempFolderOnStartup(): Promise<void> {
    await mkdir(this.tempRoot, { recursive: true });
    const entries = await readdir(this.tempRoot);

    await Promise.all(
      entries
        .filter((entry) => entry !== ".gitkeep")
        .map((entry) =>
          rm(path.join(this.tempRoot, entry), { recursive: true, force: true }),
        ),
    );
  }

  async extractPboToTempFolder(
    pbo: PboArchive,
    originalName: string,
  ): Promise<string> {
    const baseName = path.basename(originalName, ".pbo");
    const folderName = `${this.sanitizeFileName(baseName)}_${Date.now()}`;
    const outputRoot = path.join(this.tempRoot, folderName);

    await mkdir(outputRoot, { recursive: true });

    for (const filePath of pbo.listFiles()) {
      const fileContent = pbo.getFileContent(filePath);

      if (!fileContent) {
        continue;
      }

      const safeRelativePath = this.sanitizeRelativePath(filePath);
      const outputPath = path.join(outputRoot, safeRelativePath);
      const parentDir = path.dirname(outputPath);

      await mkdir(parentDir, { recursive: true });
      await writeFile(outputPath, fileContent);

      if (PaaWebpConverter.isPaaFilePath(outputPath)) {
        await this.paaWebp.tryWriteWebpBesidePaa(outputPath, fileContent);
      }
    }

    this.scheduleTempFolderCleanup(outputRoot);
    return outputRoot;
  }

  createZipArchiveFromPbo(
    pbo: PboArchive,
    extraFiles: Array<{ name: string; content: Buffer }> = [],
  ): Archiver {
    const archive = archiver("zip", { zlib: { level: 9 } });

    for (const filePath of pbo.listFiles()) {
      const fileContent = pbo.getFileContent(filePath);

      if (!fileContent) {
        continue;
      }

      const safeRelativePath = this.sanitizeRelativePath(filePath);
      archive.append(fileContent, { name: safeRelativePath });
    }

    for (const file of extraFiles) {
      archive.append(file.content, {
        name: this.sanitizeRelativePath(file.name),
      });
    }

    archive.finalize().catch(() => {
      // Errors are surfaced via the archive's "error" event to consumers.
    });

    return archive;
  }

  async createZipArchiveFromPboWithDebinarizedMission(
    pbo: PboArchive,
    originalName: string,
  ): Promise<Archiver> {
    const debinarizedMission = await this.createDebinarizedMissionZipEntry(
      pbo,
      originalName,
    );

    return this.createZipArchiveFromPbo(
      pbo,
      debinarizedMission ? [debinarizedMission] : [],
    );
  }

  buildZipFileName(originalName: string): string {
    const baseName = path.basename(originalName, ".pbo");
    return `${this.sanitizeFileName(baseName)}.zip`;
  }

  async debinarizeMissionSqm(
    extractionFolder: string,
  ): Promise<DebinarizedMissionResult> {
    const missionPath = path.join(extractionFolder, "mission.sqm");

    try {
      await access(missionPath);
    } catch {
      return {
        status: "skipped",
        reason: "mission.sqm not found in extracted files.",
      };
    }

    if (process.platform !== "linux") {
      return {
        status: "skipped",
        reason:
          "Debinarization requires Linux derap binary. Run API in Docker/Linux.",
      };
    }

    const derapPath = path.resolve("src/shared/linux/bin/derap");
    const libsPath = path.resolve("src/shared/linux/lib");
    const debinarizedPath = path.join(
      extractionFolder,
      "mission.debinarized.sqm",
    );
    const originalBackupPath = path.join(
      extractionFolder,
      "mission-original.sqm",
    );

    try {
      await chmod(derapPath, 0o755);
      await execFileAsync(derapPath, [missionPath, debinarizedPath], {
        env: {
          ...process.env,
          LD_LIBRARY_PATH: libsPath,
        },
      });

      await access(debinarizedPath);

      await rename(missionPath, originalBackupPath);
      await rename(debinarizedPath, missionPath);

      return {
        status: "success",
        outputPath: missionPath,
      };
    } catch (error) {
      return {
        status: "failed",
        reason:
          error instanceof Error ? error.message : "Failed to execute derap.",
      };
    }
  }

  async parseMissionSqmToJson(
    extractionFolder: string,
  ): Promise<ParseMissionJsonResult> {
    const missionPath = path.join(extractionFolder, "mission.sqm");
    const missionJsonPath = path.join(extractionFolder, "mission.json");
    const parse2jsonPath = path.resolve("src/shared/parse2json");

    try {
      await access(missionPath);
      await access(parse2jsonPath);
      await chmod(parse2jsonPath, 0o755);

      await execFileAsync(parse2jsonPath, [missionPath, missionJsonPath]);
      const missionJsonRaw = await readFile(missionJsonPath, "utf8");
      const normalizedMissionJson =
        this.normalizeParse2JsonOutput(missionJsonRaw);

      return {
        status: "success",
        missionJSON: JSON.parse(normalizedMissionJson) as Record<
          string,
          unknown
        >,
      };
    } catch (error) {
      return {
        status: "failed",
        reason:
          error instanceof Error
            ? error.message
            : "Failed to execute parse2json.",
      };
    }
  }

  private async createDebinarizedMissionZipEntry(
    pbo: PboArchive,
    originalName: string,
  ): Promise<{ name: string; content: Buffer } | null> {
    const missionContent = pbo.getFileContent("mission.sqm");
    if (!missionContent) {
      return null;
    }

    const baseName = path.basename(originalName, ".pbo");
    const outputRoot = path.join(
      this.tempRoot,
      `${this.sanitizeFileName(baseName)}_${Date.now()}_${randomUUID()}_zip`,
    );

    try {
      await mkdir(outputRoot, { recursive: true });
      await writeFile(path.join(outputRoot, "mission.sqm"), missionContent);

      const result = await this.debinarizeMissionSqm(outputRoot);
      if (result.status !== "success" || !result.outputPath) {
        return null;
      }

      return {
        name: ZIP_DEBINARIZED_MISSION_NAME,
        content: await readFile(result.outputPath),
      };
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  }

  private sanitizeFileName(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  private sanitizeRelativePath(value: string): string {
    const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
    const segments = normalized
      .split("/")
      .filter(
        (segment) => segment !== "" && segment !== "." && segment !== "..",
      )
      .map((segment) => this.sanitizeFileName(segment));

    return segments.length > 0 ? path.join(...segments) : "unknown.bin";
  }

  private normalizeParse2JsonOutput(raw: string): string {
    return raw.replace(/\uFEFF/g, "").replace(/^\{\/{10,}/, "{");
  }

  private scheduleTempFolderCleanup(folderPath: string): void {
    if (!Number.isFinite(this.clearTimeoutMs) || this.clearTimeoutMs < 0) {
      return;
    }

    setTimeout(() => {
      rm(folderPath, { recursive: true, force: true }).catch(() => {
        // Ignore cleanup errors to avoid impacting requests.
      });
    }, this.clearTimeoutMs);
  }
}
