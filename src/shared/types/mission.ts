export type JsonObject = Record<string, unknown>;

export type EntityMap = Record<string, JsonObject>;

export type MissionUnit = {
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

export type MissionGroup = {
  id: string | number | null;
  side: string | null;
  units: MissionUnit[];
};

export type MissionVehicle = {
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
