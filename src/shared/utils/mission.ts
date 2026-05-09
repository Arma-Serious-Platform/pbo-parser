import { PboArchive } from "./pbo.js";
import type { PboService } from "./pbo-service.js";
import type {
  EntityMap,
  JsonObject,
  MissionGroup,
  MissionUnit,
  MissionVehicle,
} from "../types/mission.js";

export type ParseMissionResult = {
  filesCount: number;
  debinarizedMission: Awaited<ReturnType<PboService["debinarizeMissionSqm"]>>;
  missionJSON: JsonObject | null;
  missionJSONError: string | null;
};

type Side =
  | "West"
  | "East"
  | "Independent"
  | "Civilian"
  | "Empty"
  | "BLUFOR"
  | "OPFOR"
  | "Logic"
  | "Unknown";

export async function parseMissionFromUpload(
  pboService: PboService,
  fileBuffer: Buffer,
  originalName: string,
): Promise<ParseMissionResult> {
  const pbo = PboArchive.fromBuffer(fileBuffer);
  if (!pbo.hasFile("mission.sqm")) {
    throw new Error("Invalid mission archive: mission.sqm was not found.");
  }

  const extractionFolder = await pboService.extractPboToTempFolder(
    pbo,
    originalName,
  );
  const debinarizedMission =
    await pboService.debinarizeMissionSqm(extractionFolder);

  let missionJSON: JsonObject | null = null;
  let missionJSONError: string | null = null;

  if (debinarizedMission.status === "success") {
    const parsedMission =
      await pboService.parseMissionSqmToJson(extractionFolder);
    if (parsedMission.status === "success") {
      missionJSON = parsedMission.missionJSON ?? null;
    } else {
      missionJSONError =
        parsedMission.reason ?? "Failed to parse mission.sqm to JSON.";
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

export function getGroupsFromMission(missionJSON: JsonObject): MissionGroup[] {
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
      side: toStringOrNull(entity.side) as Side,
      units: getUnitsFromGroupEntity(toEntityMap(entity.Entities)),
    });
  }

  return groups;
}

export function getSlotsFromMission(missionGroups: MissionGroup[]) {}

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

export function getVehiclesFromMission(
  missionJSON: JsonObject,
): MissionVehicle[] {
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

function getVehicleType(
  entity: JsonObject,
): "air" | "crate" | "static" | "land" | "unknown" {
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
