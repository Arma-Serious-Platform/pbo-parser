import { parse as parseArmaClass } from "arma-class-parser";

export type SlotGroup = {
  name: string;
  title: string;
  count: number;
};

export type SlotExtractionResult = {
  slots: SlotGroup[];
  slotsCount: number;
  mode: "text" | "binarized-fallback";
};

export function extractSlotGroupsFromMissionSqm(missionSqm: Buffer): SlotExtractionResult {
  if (isLikelyTextSqm(missionSqm)) {
    return extractFromTextSqm(missionSqm.toString("utf8"));
  }

  return extractFromBinarizedSqmFallback(missionSqm);
}

function extractFromTextSqm(raw: string): SlotExtractionResult {
  const parsed = parseArmaClass(raw) as Record<string, unknown>;
  const groups = collectGroupObjects(parsed);

  const slots = groups
    .map((group, index) => {
      const playableUnits = getPlayableUnitCount(group);
      if (playableUnits === 0) {
        return null;
      }

      const name = pickFirstString(group, ["callsign", "groupId", "name"]) ?? `Group-${index + 1}`;
      const title = pickFirstString(group, ["name", "description", "text"]) ?? name;

      return {
        name,
        title,
        count: playableUnits,
      };
    })
    .filter((slot): slot is SlotGroup => slot !== null);

  return {
    slots,
    slotsCount: slots.reduce((sum, slot) => sum + slot.count, 0),
    mode: "text",
  };
}

function collectGroupObjects(root: unknown): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  walkObject(root, (node) => {
    if (!isRecord(node)) {
      return;
    }

    if (node.dataType === "Group") {
      result.push(node);
    }
  });
  return result;
}

function getPlayableUnitCount(group: Record<string, unknown>): number {
  let count = 0;

  walkObject(group.Entities, (node) => {
    if (!isRecord(node) || node.dataType !== "Object") {
      return;
    }

    if (toNumber(node.isPlayable) === 1) {
      count += 1;
    }
  });

  return count;
}

function walkObject(node: unknown, visitor: (node: unknown) => void): void {
  visitor(node);

  if (Array.isArray(node)) {
    for (const item of node) {
      walkObject(item, visitor);
    }
    return;
  }

  if (!isRecord(node)) {
    return;
  }

  for (const value of Object.values(node)) {
    walkObject(value, visitor);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function pickFirstString(node: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = node[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }

  return null;
}

function isLikelyTextSqm(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 256)).toString("utf8");
  return sample.includes("version=") || sample.includes("class Mission");
}

function extractFromBinarizedSqmFallback(buffer: Buffer): SlotExtractionResult {
  const strings = extractPrintableStrings(buffer);
  const slots: SlotGroup[] = [];

  let groupIndex = 1;
  for (let i = 0; i < strings.length; i++) {
    if (strings[i] !== "Group") {
      continue;
    }

    let playableCount = 0;
    let name: string | null = null;
    let title: string | null = null;

    for (let cursor = i + 1; cursor < strings.length; cursor++) {
      const token = strings[cursor];
      if (token === "Group") {
        break;
      }

      if (token === "isPlayable") {
        playableCount += 1;
      }

      if (!name && token === "callsign") {
        name = cleanupToken(strings[cursor + 1]);
      }

      if (!title && token === "name") {
        title = cleanupToken(strings[cursor + 1]);
      }
    }

    if (playableCount > 0) {
      const normalizedName = name ?? `Group-${groupIndex}`;
      slots.push({
        name: normalizedName,
        title: title ?? normalizedName,
        count: playableCount,
      });
      groupIndex += 1;
    }
  }

  return {
    slots,
    slotsCount: slots.reduce((sum, slot) => sum + slot.count, 0),
    mode: "binarized-fallback",
  };
}

function cleanupToken(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed === "" || /^Item\d+$/i.test(trimmed) || trimmed === "Entities") {
    return null;
  }

  return trimmed;
}

function extractPrintableStrings(buffer: Buffer, minLength = 3): string[] {
  const result: string[] = [];
  let current = "";

  for (const byte of buffer) {
    if (byte >= 32 && byte <= 126) {
      current += String.fromCharCode(byte);
      continue;
    }

    if (current.length >= minLength) {
      result.push(current);
    }
    current = "";
  }

  if (current.length >= minLength) {
    result.push(current);
  }

  return result;
}
