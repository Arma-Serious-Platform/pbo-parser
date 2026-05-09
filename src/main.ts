import express from "express";
import cors from "cors";
import multer from "multer";
import { PboArchive } from "./shared/utils/pbo.js";
import { PboService } from "./shared/utils/pbo-service.js";
import {
  getGroupsFromMission,
  getVehiclesFromMission,
  parseMissionFromUpload,
} from "./shared/utils/mission.js";

const PORT = process.env.PORT || 3000;
const clearTimeoutMs = parseClearTimeoutMs(process.env.CLEAR_TIMEOUT_MS);
const pboService = new PboService(clearTimeoutMs);

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

app.post("/zip", uploadPbo.single("pbo"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: 'Missing file. Please send form-data with file field "pbo".',
    });
  }

  try {
    const pbo = PboArchive.fromBuffer(req.file.buffer);
    const zipFileName = pboService.buildZipFileName(req.file.originalname);
    const archive = pboService.createZipArchiveFromPbo(pbo);

    archive.on("error", (error) => {
      if (!res.headersSent) {
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to build zip archive.",
        });
        return;
      }

      res.destroy(error);
    });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${zipFileName}"`,
    );

    archive.pipe(res);
  } catch (error) {
    res.status(400).json({
      error:
        error instanceof Error ? error.message : "Failed to parse PBO archive.",
    });
  }
});

app.post("/slots", uploadPbo.single("pbo"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: 'Missing file. Please send form-data with file field "pbo".',
    });
  }

  try {
    const parseResult = await parseMissionFromUpload(
      pboService,
      req.file.buffer,
      req.file.originalname,
    );
    const groups = parseResult.missionJSON
      ? getGroupsFromMission(parseResult.missionJSON)
      : [];
    const vehicles = parseResult.missionJSON
      ? getVehiclesFromMission(parseResult.missionJSON)
      : [];

    res.json({
      message: "PBO parsed successfully",
      fileName: req.file.originalname,
      fileSize: req.file.size,
      filesCount: parseResult.filesCount,
      groups,
      vehicles,
    });
  } catch (error) {
    res.status(400).json({
      error:
        error instanceof Error ? error.message : "Failed to parse PBO archive.",
    });
  }
});

app.post("/full", uploadPbo.single("pbo"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: 'Missing file. Please send form-data with file field "pbo".',
    });
  }

  try {
    const parseResult = await parseMissionFromUpload(
      pboService,
      req.file.buffer,
      req.file.originalname,
    );
    const groups = parseResult.missionJSON
      ? getGroupsFromMission(parseResult.missionJSON)
      : [];
    const vehicles = parseResult.missionJSON
      ? getVehiclesFromMission(parseResult.missionJSON)
      : [];

    res.json({
      message: "PBO parsed successfully",
      fileName: req.file.originalname,
      fileSize: req.file.size,
      filesCount: parseResult.filesCount,
      debinarizedMission: parseResult.debinarizedMission,
      missionJSON: parseResult.missionJSON,
      groups,
      vehicles,
      missionJSONError: parseResult.missionJSONError,
    });
  } catch (error) {
    res.status(400).json({
      error:
        error instanceof Error ? error.message : "Failed to parse PBO archive.",
    });
  }
});

bootstrap().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

async function bootstrap(): Promise<void> {
  await pboService.clearTempFolderOnStartup();
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

function parseClearTimeoutMs(value: string | undefined): number {
  if (!value || value.trim() === "") {
    return -1;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return -1;
  }

  return parsed;
}
