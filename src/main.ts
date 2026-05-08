import express from "express";
import cors from "cors";
import multer from "multer";
import { PboArchive } from "./shared/utils/pbo.js";
import { PboService } from "./shared/utils/pbo-service.js";

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

type JsonObject = Record<string, unknown>;

type EntityMap = Record<string, JsonObject>;

type MissionUnit = {
  id: string | number | null;
  side: string | null;
  rank: string | null;
  type: string | null;
  description: string | null;
  isPlayable: boolean;
  inventory: unknown;
  position: {
    coordinates: {
      x: number;
      y: number;
      z: number;
    };
    angles: unknown;
  };
};

type MissionGroup = {
  id: string | number | null;
  side: string | null;
  units: MissionUnit[];
};

type MissionVehicle = {
  id: string | number | null;
  type: "air" | "crate" | "static" | "land" | "unknown";
  description: string | null;
  position: {
    coordinates: {
      x: number;
      y: number;
      z: number;
    };
    angle: number;
  };
};

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
    const parseResult = await parseMissionFromUpload(req.file.buffer, req.file.originalname);
    const groups = parseResult.missionJSON ? getGroupsFromMission(parseResult.missionJSON) : [];
    const vehicles = parseResult.missionJSON ? getVehiclesFromMission(parseResult.missionJSON) : [];

    res.json({
      message: "PBO parsed successfully",
      fileName: req.file.originalname,
      fileSize: req.file.size,
      filesCount: parseResult.filesCount,
      groups,
      vehicles,
      debinarizedMission: parseResult.debinarizedMission,
      missionJSONError: parseResult.missionJSONError,
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
    const parseResult = await parseMissionFromUpload(req.file.buffer, req.file.originalname);
    const groups = parseResult.missionJSON ? getGroupsFromMission(parseResult.missionJSON) : [];
    const vehicles = parseResult.missionJSON ? getVehiclesFromMission(parseResult.missionJSON) : [];

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

async function parseMissionFromUpload(fileBuffer: Buffer, originalName: string): Promise<{
  filesCount: number;
  debinarizedMission: Awaited<ReturnType<PboService["debinarizeMissionSqm"]>>;
  missionJSON: JsonObject | null;
  missionJSONError: string | null;
}> {
  const pbo = PboArchive.fromBuffer(fileBuffer);
  if (!pbo.hasFile("mission.sqm")) {
    throw new Error("Invalid mission archive: mission.sqm was not found.");
  }

  const extractionFolder = await pboService.extractPboToTempFolder(pbo, originalName);
  const debinarizedMission = await pboService.debinarizeMissionSqm(extractionFolder);

  let missionJSON: JsonObject | null = null;
  let missionJSONError: string | null = null;

  if (debinarizedMission.status === "success") {
    const parsedMission = await pboService.parseMissionSqmToJson(extractionFolder);
    if (parsedMission.status === "success") {
      missionJSON = parsedMission.missionJSON ?? null;
    } else {
      missionJSONError = parsedMission.reason ?? "Failed to parse mission.sqm to JSON.";
    }
  } else {
    missionJSONError =
      debinarizedMission.reason ??
      "Mission was not debinarized, parse2json was not executed.";
  }

  return {
    filesCount: pbo.listFiles().length,
    debinarizedMission,
    missionJSON,
    missionJSONError,
  };
}

function getGroupsFromMission(missionJSON: JsonObject): MissionGroup[] {
  const entities = getMissionEntities(missionJSON);
  if (!entities) {
    return [];
  }

  const groups: MissionGroup[] = [];
  const entitiesKeys = Object.keys(entities);

  for (const [index, key] of entitiesKeys.entries()) {
    if (index === 0) {
      continue;
    }

    const entity = entities[key];
    if (!isRecord(entity) || entity.dataType !== "Group") {
      continue;
    }

    groups.push({
      id: toId(entity.id),
      side: toStringOrNull(entity.side),
      units: getUnitsFromGroupEntity(toEntityMap(entity.Entities)),
    });
  }

  return groups;
}

function getUnitsFromGroupEntity(entities: EntityMap): MissionUnit[] {
  const units: MissionUnit[] = [];
  const unitKeys = Object.keys(entities);

  for (const [index, key] of unitKeys.entries()) {
    if (index === 0) {
      continue;
    }

    const unit = entities[key];
    if (!isRecord(unit) || unit.dataType !== "Object") {
      continue;
    }

    const attributes = toRecord(unit.Attributes);
    const positionInfo = toRecord(unit.PositionInfo);
    const position = toNumberArray(positionInfo.position);
    const angles = positionInfo.angles ?? null;

    units.push({
      id: toId(unit.id),
      side: toStringOrNull(unit.side),
      rank: toStringOrNull(attributes.rank),
      type: toStringOrNull(unit.type),
      description: toStringOrNull(attributes.description),
      isPlayable: toBoolean(attributes.isPlayable),
      inventory: attributes.Inventory ?? null,
      position: {
        coordinates: {
          x: position[0] ?? 0,
          z: position[1] ?? 0,
          y: position[2] ?? 0,
        },
        angles,
      },
    });
  }

  return units;
}

function getVehiclesFromMission(missionJSON: JsonObject): MissionVehicle[] {
  return getVehiclesFromEntities(getMissionEntities(missionJSON));
}

function getVehiclesFromEntities(entities: EntityMap): MissionVehicle[] {
  const vehicles: MissionVehicle[] = [];
  const entitiesKeys = Object.keys(entities);

  for (const [index, key] of entitiesKeys.entries()) {
    if (index === 0) {
      continue;
    }

    const entity = entities[key];
    if (!isRecord(entity)) {
      continue;
    }

    const customAttributes = toRecord(entity.CustomAttributes);
    const attribute0 = toRecord(customAttributes.Attribute0);
    const attributes = toRecord(entity.Attributes);
    const isSpeaker = attribute0.property === "speaker";
    const isPlayable = toBoolean(attributes.isPlayable);
    if (isSpeaker || isPlayable) {
      continue;
    }

    if (entity.Entities) {
      vehicles.push(...getVehiclesFromEntities(toEntityMap(entity.Entities)));
    }

    if (entity.dataType !== "Object") {
      continue;
    }

    const positionInfo = toRecord(entity.PositionInfo);
    const position = toNumberArray(positionInfo.position);
    const angles = toNumberArray(positionInfo.angles);

    vehicles.push({
      id: toId(entity.id),
      type: getVehicleType(entity),
      description: toStringOrNull(entity.type),
      position: {
        coordinates: {
          x: position[0] ?? 0,
          z: position[1] ?? 0,
          y: position[2] ?? 0,
        },
        angle: angles[1] ?? 0,
      },
    });
  }

  return vehicles;
}

function getVehicleType(entity: JsonObject): "air" | "crate" | "static" | "land" | "unknown" {
  const attributes = toRecord(entity.Attributes);
  const customAttributes = toRecord(entity.CustomAttributes);
  const attribute0 = toRecord(customAttributes.Attribute0);
  const description = toStringOrNull(entity.type)?.toLowerCase() ?? "";
  const init = toStringOrNull(attributes.init)?.toLowerCase() ?? "";

  if (attributes.pylons) {
    return "air";
  }
  if (description.includes("ammo")) {
    return "crate";
  }
  if (description.includes("crate") && !description.includes("crater")) {
    return "crate";
  }
  if (description.includes("static") || description.includes("tripod")) {
    return "static";
  }
  if (
    attributes.fuel ||
    attributes.lock ||
    description.includes("fuel") ||
    init.includes("veh") ||
    attribute0.property === "VehicleCustomization"
  ) {
    return "land";
  }

  return "unknown";
}

function getMissionEntities(missionJSON: JsonObject): EntityMap {
  const mission = missionJSON.Mission;
  if (!isRecord(mission)) {
    return {};
  }

  return toEntityMap(mission.Entities);
}

function toEntityMap(value: unknown): EntityMap {
  return isRecord(value) ? (value as EntityMap) : {};
}

function toRecord(value: unknown): JsonObject {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value === 1;
  }
  if (typeof value === "string") {
    return value === "1" || value.toLowerCase() === "true";
  }

  return false;
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => toNumber(item))
    .filter((item): item is number => item !== null);
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  return null;
}

function toId(value: unknown): string | number | null {
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  return null;
}

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
