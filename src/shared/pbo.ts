const HEADER_ENTRY_END_OFFSET = 21;

export type PboHeaderEntry = {
  filename: string;
  packingMethod: number;
  originalSize: number;
  reserved: number;
  timestamp: number;
  dataSize: number;
  length: number;
  dataOffset: number;
};

export class PboArchive {
  private readonly headerEntries = new Map<string, PboHeaderEntry>();
  private readonly headerLength: number;
  private readonly source: Buffer;

  private constructor(source: Buffer, entries: PboHeaderEntry[], headerLength: number) {
    this.source = source;
    this.headerLength = headerLength;

    for (const entry of entries) {
      this.headerEntries.set(entry.filename, entry);
    }
  }

  static fromBuffer(source: Buffer): PboArchive {
    const entries: PboHeaderEntry[] = [];
    let headerLength = 0;
    let currentDataOffset = 0;

    while (true) {
      const parsed = readHeaderEntry(source, headerLength);

      if (parsed.kind === "skip-initial-empty-entry") {
        headerLength = HEADER_ENTRY_END_OFFSET + 1;
        continue;
      }

      if (parsed.kind === "end-of-header") {
        break;
      }

      const entry = parsed.entry;
      entry.dataOffset = currentDataOffset;
      currentDataOffset += entry.dataSize;
      headerLength += entry.length;
      entries.push(entry);
    }

    if (entries.length === 0) {
      throw new Error("Unreadable PBO file or unsupported format.");
    }

    return new PboArchive(source, entries, headerLength);
  }

  getFileContent(path: string): Buffer | null {
    const entry = this.headerEntries.get(path);
    if (!entry) {
      return null;
    }

    const offset = this.headerLength + HEADER_ENTRY_END_OFFSET + entry.dataOffset;
    return this.source.subarray(offset, offset + entry.dataSize);
  }

  hasFile(path: string): boolean {
    return this.headerEntries.has(path);
  }

  listFiles(): string[] {
    return [...this.headerEntries.keys()];
  }
}

type ReadHeaderEntryResult =
  | { kind: "skip-initial-empty-entry" }
  | { kind: "end-of-header" }
  | { kind: "entry"; entry: PboHeaderEntry };

function readHeaderEntry(buffer: Buffer, offset: number): ReadHeaderEntryResult {
  const filenameInfo = readNullTerminatedString(buffer, offset);

  if (!filenameInfo || filenameInfo.value.length === 0) {
    return offset === 0 ? { kind: "skip-initial-empty-entry" } : { kind: "end-of-header" };
  }

  const metadataOffset = filenameInfo.nextOffset;
  const entryParams = readEntryParams(buffer, metadataOffset);

  const entry: PboHeaderEntry = {
    filename: filenameInfo.value,
    packingMethod: entryParams[0],
    originalSize: entryParams[1],
    reserved: entryParams[2],
    timestamp: entryParams[3],
    dataSize: entryParams[4],
    length: filenameInfo.value.length + HEADER_ENTRY_END_OFFSET,
    dataOffset: 0,
  };

  return { kind: "entry", entry };
}

function readNullTerminatedString(
  buffer: Buffer,
  offset: number,
): { value: string; nextOffset: number } | null {
  if (offset >= buffer.length) {
    return null;
  }

  const end = buffer.indexOf(0, offset);
  if (end === -1) {
    return null;
  }

  return {
    value: buffer.toString("utf8", offset, end),
    nextOffset: end + 1,
  };
}

function readEntryParams(buffer: Buffer, offset: number): [number, number, number, number, number] {
  if (offset + 20 > buffer.length) {
    throw new Error("Invalid PBO header entry metadata.");
  }

  return [
    buffer.readUInt32LE(offset),
    buffer.readUInt32LE(offset + 4),
    buffer.readUInt32LE(offset + 8),
    buffer.readUInt32LE(offset + 12),
    buffer.readUInt32LE(offset + 16),
  ];
}
