import express from "express";
import cors from "cors";
import multer from "multer";
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { PboArchive } from "./shared/pbo.js";
import { extractSlotGroupsFromMissionSqm } from "./shared/sqm.js";

const PORT = process.env.PORT || 3000;
const execFileAsync = promisify(execFile);

const app = express();

app.use(express.json());

app.use(express.urlencoded({ extended: true }));

app.use(cors());

const uploadPbo = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith(".pbo")) {
      return cb(new Error("Only .pbo files are allowed"));
    }

    cb(null, true);
  },
});

app.post("/pbo/slots", uploadPbo.single("pbo"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: 'Missing file. Please send form-data with file field "pbo".',
    });
  }

  try {
    const pbo = PboArchive.fromBuffer(req.file.buffer);
    const mission = pbo.getFileContent("mission.sqm");

    if (!mission) {
      return res.status(400).json({
        error: "Invalid mission archive: mission.sqm was not found.",
      });
    }

    const slots = extractSlotGroupsFromMissionSqm(mission);
    const extractionFolder = await extractPboToTempFolder(pbo, req.file.originalname);
    const debinarizedMission = await debinarizeMissionSqm(extractionFolder);

    res.json({
      message: "PBO parsed successfully",
      fileName: req.file.originalname,
      fileSize: req.file.size,
      filesCount: pbo.listFiles().length,
      extractionFolder,
      missionSqmSize: mission.length,
      slotsCount: slots.slotsCount,
      slots: slots.slots,
      parsingMode: slots.mode,
      debinarizedMission,
    });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to parse PBO archive.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

async function extractPboToTempFolder(pbo: PboArchive, originalName: string): Promise<string> {
  const baseName = path.basename(originalName, ".pbo");
  const folderName = `${sanitizeFileName(baseName)}_${Date.now()}`;
  const outputRoot = path.join("src", "temp", folderName);

  await mkdir(outputRoot, { recursive: true });

  for (const filePath of pbo.listFiles()) {
    const fileContent = pbo.getFileContent(filePath);

    if (!fileContent) {
      continue;
    }

    const safeRelativePath = sanitizeRelativePath(filePath);
    const outputPath = path.join(outputRoot, safeRelativePath);
    const parentDir = path.dirname(outputPath);

    await mkdir(parentDir, { recursive: true });
    await writeFile(outputPath, fileContent);
  }

  return outputRoot;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function sanitizeRelativePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  const segments = normalized
    .split("/")
    .filter((segment) => segment !== "" && segment !== "." && segment !== "..")
    .map((segment) => sanitizeFileName(segment));

  return segments.length > 0 ? path.join(...segments) : "unknown.bin";
}

async function debinarizeMissionSqm(extractionFolder: string): Promise<{
  status: "success" | "skipped" | "failed";
  outputPath?: string;
  reason?: string;
}> {
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