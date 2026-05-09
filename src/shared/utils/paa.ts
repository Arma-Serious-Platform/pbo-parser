import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Paa, PaaType } from "@bis-toolkit/paa";
import sharp from "sharp";

const PAA_MAGIC_NUMBERS = new Set<number>(
  (Object.values(PaaType) as Array<number | string>).filter(
    (v): v is number => typeof v === "number",
  ),
);

export type PaaWebpOptions = {
  /** WebP quality 1–100. Default 90. */
  quality?: number;
  /** Mipmap level to decode (0 = full size). Default 0. */
  mipLevel?: number;
};

export type PaaConversionResult = {
  paaPath: string;
  webpPath?: string;
  error?: string;
};

function peekUInt16LE(buffer: Buffer): number {
  if (buffer.length < 2) {
    return 0;
  }

  return buffer.readUInt16LE(0);
}

/** PAA pixel data from @bis-toolkit/paa is BGRA; sharp raw input expects RGBA. */
function bgraToRgbaInPlace(pixels: Buffer): void {
  for (let i = 0; i < pixels.length; i += 4) {
    const b = pixels[i]!;
    const r = pixels[i + 2]!;
    pixels[i] = r;
    pixels[i + 2] = b;
  }
}

async function walkFilesRecursive(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(rootDir, { withFileTypes: true });

  for (const ent of entries) {
    const full = path.join(rootDir, ent.name);
    if (ent.isDirectory()) {
      out.push(...(await walkFilesRecursive(full)));
    } else if (ent.isFile()) {
      out.push(full);
    }
  }

  return out;
}

export class PaaWebpConverter {
  constructor(private readonly defaults: PaaWebpOptions = {}) {}

  static isPaaFilePath(filePath: string): boolean {
    return filePath.toLowerCase().endsWith(".paa");
  }

  static isSupportedPaaBuffer(buffer: Buffer): boolean {
    return PAA_MAGIC_NUMBERS.has(peekUInt16LE(buffer));
  }

  /**
   * Decode PAA bytes to raw RGBA suitable for {@link sharp} `raw` input.
   */
  decodePaaToRgba(
    buffer: Buffer,
    options?: Pick<PaaWebpOptions, "mipLevel">,
  ): { width: number; height: number; data: Buffer } {
    if (!PaaWebpConverter.isSupportedPaaBuffer(buffer)) {
      const magic = peekUInt16LE(buffer);
      throw new Error(
        `Unsupported or invalid PAA (magic 0x${magic.toString(16)}).`,
      );
    }

    const mipLevel = options?.mipLevel ?? this.defaults.mipLevel ?? 0;
    const paa = new Paa();
    paa.read(buffer);

    if (paa.mipmaps.length === 0) {
      throw new Error("PAA contains no mipmaps.");
    }

    if (mipLevel < 0 || mipLevel >= paa.mipmaps.length) {
      throw new RangeError(
        `mipLevel ${mipLevel} out of range (0..${paa.mipmaps.length - 1}).`,
      );
    }

    const mip = paa.mipmaps[mipLevel]!;
    const pixels = Buffer.from(paa.getArgb32PixelData(buffer, mipLevel));
    bgraToRgbaInPlace(pixels);

    return { width: mip.width, height: mip.height, data: pixels };
  }

  /**
   * Encode PAA file contents as a WebP image buffer.
   */
  async toWebpBuffer(
    paaBuffer: Buffer,
    options?: PaaWebpOptions,
  ): Promise<Buffer> {
    const quality = options?.quality ?? this.defaults.quality ?? 90;
    const { width, height, data } = this.decodePaaToRgba(paaBuffer, options);

    return sharp(data, { raw: { width, height, channels: 4 } })
      .webp({ quality })
      .toBuffer();
  }

  /**
   * Write `<basename>.webp` next to the `.paa` path (same directory).
   * @returns Absolute path to the written WebP file.
   */
  async writeWebpBesidePaa(
    paaFilePath: string,
    paaBuffer: Buffer,
    options?: PaaWebpOptions,
  ): Promise<string> {
    const dir = path.dirname(paaFilePath);
    const base = path.basename(paaFilePath, path.extname(paaFilePath));
    const webpPath = path.join(dir, `${base}.webp`);
    const webp = await this.toWebpBuffer(paaBuffer, options);
    await writeFile(webpPath, webp);
    return webpPath;
  }

  /**
   * Same as {@link writeWebpBesidePaa} but reads the PAA from disk.
   */
  async convertFileOnDisk(
    paaFilePath: string,
    options?: PaaWebpOptions,
  ): Promise<string> {
    const buf = await readFile(paaFilePath);
    return this.writeWebpBesidePaa(paaFilePath, buf, options);
  }

  /**
   * Convert every `.paa` under `rootDir` to a sibling `.webp`.
   */
  async convertAllUnderDirectory(
    rootDir: string,
    options?: PaaWebpOptions,
  ): Promise<PaaConversionResult[]> {
    const files = await walkFilesRecursive(rootDir);
    const paaFiles = files.filter((f) => PaaWebpConverter.isPaaFilePath(f));
    const results: PaaConversionResult[] = [];

    for (const paaPath of paaFiles) {
      try {
        const webpPath = await this.convertFileOnDisk(paaPath, options);
        results.push({ paaPath, webpPath });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown conversion error.";
        results.push({ paaPath, error: message });
      }
    }

    return results;
  }

  /**
   * Best-effort conversion for extraction pipelines: failures are logged, not thrown.
   */
  async tryWriteWebpBesidePaa(
    paaFilePath: string,
    paaBuffer: Buffer,
    options?: PaaWebpOptions,
  ): Promise<void> {
    try {
      await this.writeWebpBesidePaa(paaFilePath, paaBuffer, options);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      console.warn(
        `[PaaWebpConverter] Skipped ${paaFilePath}: ${message}`,
      );
    }
  }
}
