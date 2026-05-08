import express from "express";
import cors from "cors";
import multer from "multer";
import { PboArchive } from "./shared/utils/pbo.js";
import { extractSlotGroupsFromMissionSqm } from "./shared/utils/sqm.js";
import { PboService } from "./shared/utils/pbo-service.js";

const PORT = process.env.PORT || 3000;
const pboService = new PboService();

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
    const pbo = PboArchive.fromBuffer(req.file.buffer);
    const mission = pbo.getFileContent("mission.sqm");

    if (!mission) {
      return res.status(400).json({
        error: "Invalid mission archive: mission.sqm was not found.",
      });
    }

    const slots = extractSlotGroupsFromMissionSqm(mission);
    const extractionFolder = await pboService.extractPboToTempFolder(
      pbo,
      req.file.originalname,
    );
    const debinarizedMission =
      await pboService.debinarizeMissionSqm(extractionFolder);

    res.json({
      message: "PBO parsed successfully",
      fileName: req.file.originalname,
      fileSize: req.file.size,
      filesCount: pbo.listFiles().length,
      missionSqmSize: mission.length,
      slotsCount: slots.slotsCount,
      slots: slots.slots,
      parsingMode: slots.mode,
      debinarizedMission,
    });
  } catch (error) {
    res.status(400).json({
      error:
        error instanceof Error ? error.message : "Failed to parse PBO archive.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
