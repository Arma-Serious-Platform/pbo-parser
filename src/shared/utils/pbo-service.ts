import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import archiver, { type Archiver } from "archiver";
import { PboArchive } from "./pbo.js";

const execFileAsync = promisify(execFile);

export type DebinarizedMissionResult = {
  status: "success" | "skipped" | "failed";
  outputPath?: string;
  reason?: string;
};

export class PboService {
  async extractPboToTempFolder(pbo: PboArchive, originalName: string): Promise<string> {
    const baseName = path.basename(originalName, ".pbo");
    const folderName = `${this.sanitizeFileName(baseName)}_${Date.now()}`;
    const outputRoot = path.join("src", "temp", folderName);

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
    }

    return outputRoot;
  }

  createZipArchiveFromPbo(pbo: PboArchive): Archiver {
    const archive = archiver("zip", { zlib: { level: 9 } });

    for (const filePath of pbo.listFiles()) {
      const fileContent = pbo.getFileContent(filePath);

      if (!fileContent) {
        continue;
      }

      const safeRelativePath = this.sanitizeRelativePath(filePath);
      archive.append(fileContent, { name: safeRelativePath });
    }

    archive.finalize().catch(() => {
      // Errors are surfaced via the archive's "error" event to consumers.
    });

    return archive;
  }

  buildZipFileName(originalName: string): string {
    const baseName = path.basename(originalName, ".pbo");
    return `${this.sanitizeFileName(baseName)}.zip`;
  }

  async debinarizeMissionSqm(extractionFolder: string): Promise<DebinarizedMissionResult> {
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
        reason: "Debinarization requires Linux derap binary. Run API in Docker/Linux.",
      };
    }

    const derapPath = path.resolve("src/shared/linux/bin/derap");
    const libsPath = path.resolve("src/shared/linux/lib");
    const outputPath = path.join(extractionFolder, "mission.debinarized.sqm");

    try {
      await chmod(derapPath, 0o755);
      await execFileAsync(derapPath, [missionPath, outputPath], {
        env: {
          ...process.env,
          LD_LIBRARY_PATH: libsPath,
        },
      });

      await access(outputPath);
      return {
        status: "success",
        outputPath,
      };
    } catch (error) {
      return {
        status: "failed",
        reason: error instanceof Error ? error.message : "Failed to execute derap.",
      };
    }
  }

  private sanitizeFileName(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  private sanitizeRelativePath(value: string): string {
    const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
    const segments = normalized
      .split("/")
      .filter((segment) => segment !== "" && segment !== "." && segment !== "..")
      .map((segment) => this.sanitizeFileName(segment));

    return segments.length > 0 ? path.join(...segments) : "unknown.bin";
  }
}
