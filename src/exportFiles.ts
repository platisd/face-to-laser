import JSZip from "jszip";
import type { ByteImage, PointList } from "./images";
import type { LaserJob } from "./laserJob";
import { type Settings, settingsToJson } from "./settings";

export const CUT_LINE_COLOR = "#ff0000";
export const CUT_LINE_WIDTH_MM = 0.1;
const DXF_RED = 1;
const DXF_MILLIMETERS = 4;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export interface LaserFile {
  name: string;
  content: Uint8Array;
}

export async function makeLaserFiles(job: LaserJob, settings: Settings, name: string): Promise<LaserFile[]> {
  const text = (value: string) => new TextEncoder().encode(value);
  const engravePng = await engravePngBytes(job);
  const files: LaserFile[] = [
    { name: `${name}_engrave.png`, content: engravePng },
    { name: `${name}_combined.svg`, content: text(svgText(job, engravePng)) },
  ];
  if (job.cutLineMm !== null) {
    files.push({ name: `${name}_cut.svg`, content: text(svgText(job, null)) });
    files.push({ name: `${name}_cut.dxf`, content: text(dxfText(job)) });
  }
  files.push({ name: `${name}_settings.json`, content: text(settingsToJson(settings)) });
  return files;
}

export async function zipFiles(files: LaserFile[]): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.name, file.content);
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export async function engravePngBytes(job: LaserJob): Promise<Uint8Array> {
  return blackAndWhitePng(job.engrave, Math.round(job.dotsPerMm * 1000));
}

export async function blackAndWhitePng(image: ByteImage, dotsPerMeter: number): Promise<Uint8Array> {
  const bytesPerRow = Math.ceil(image.width / 8);
  const rows = new Uint8Array((bytesPerRow + 1) * image.height);
  for (let y = 0; y < image.height; y++) {
    const rowStart = y * (bytesPerRow + 1) + 1;
    for (let x = 0; x < image.width; x++) {
      if (image.data[y * image.width + x] >= 128) {
        rows[rowStart + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  const header = new DataView(new ArrayBuffer(13));
  header.setUint32(0, image.width);
  header.setUint32(4, image.height);
  header.setUint8(8, 1);
  const physicalSize = new DataView(new ArrayBuffer(9));
  physicalSize.setUint32(0, dotsPerMeter);
  physicalSize.setUint32(4, dotsPerMeter);
  physicalSize.setUint8(8, 1);
  return joinBytes([
    new Uint8Array(PNG_SIGNATURE),
    pngChunk("IHDR", new Uint8Array(header.buffer)),
    pngChunk("pHYs", new Uint8Array(physicalSize.buffer)),
    pngChunk("IDAT", await zlibCompress(rows)),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeAndData = joinBytes([new TextEncoder().encode(type), data]);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(typeAndData, 4);
  view.setUint32(8 + data.length, crc32(typeAndData));
  return chunk;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value;
});

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function zlibCompress(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function joinBytes(parts: Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

export function svgText(job: LaserJob, engravePng: Uint8Array | null): string {
  const width = job.widthMm.toFixed(3);
  const height = job.heightMm.toFixed(3);
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">`,
  ];
  if (engravePng !== null) {
    const data = "data:image/png;base64," + toBase64(engravePng);
    parts.push(
      `<image x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" ` +
        `style="image-rendering:pixelated" href="${data}" xlink:href="${data}"/>`,
    );
  }
  // The hole comes first: many laser programs cut in file order, and the piece
  // can move once its outer line is cut.
  if (job.holeMm !== null) {
    const { x, y, radius } = job.holeMm;
    parts.push(
      `<circle cx="${x.toFixed(3)}" cy="${y.toFixed(3)}" r="${radius.toFixed(3)}" fill="none" ` +
        `stroke="${CUT_LINE_COLOR}" stroke-width="${CUT_LINE_WIDTH_MM}"/>`,
    );
  }
  if (job.cutLineMm !== null) {
    parts.push(
      `<path d="${svgPath(job.cutLineMm)}" fill="none" ` +
        `stroke="${CUT_LINE_COLOR}" stroke-width="${CUT_LINE_WIDTH_MM}"/>`,
    );
  }
  parts.push("</svg>");
  return parts.join("\n");
}

function svgPath(pointsMm: PointList): string {
  const [first, ...rest] = pointsMm.map(([x, y]) => `${x.toFixed(3)} ${y.toFixed(3)}`);
  return `M ${first} ` + rest.map((point) => `L ${point}`).join(" ") + " Z";
}

function toBase64(bytes: Uint8Array): string {
  let letters = "";
  const pieceSize = 0x8000;
  for (let start = 0; start < bytes.length; start += pieceSize) {
    letters += String.fromCharCode(...bytes.subarray(start, start + pieceSize));
  }
  return btoa(letters);
}

export function dxfText(job: LaserJob): string {
  const pairs: [number, string | number][] = [
    [0, "SECTION"], [2, "HEADER"],
    [9, "$ACADVER"], [1, "AC1009"],
    [9, "$INSUNITS"], [70, DXF_MILLIMETERS],
    [0, "ENDSEC"],
    [0, "SECTION"], [2, "ENTITIES"],
  ];
  if (job.holeMm !== null) {
    const { x, y, radius } = job.holeMm;
    pairs.push(
      [0, "CIRCLE"], [8, "0"], [62, DXF_RED],
      [10, x.toFixed(4)], [20, (job.heightMm - y).toFixed(4)], [30, "0.0"], [40, radius.toFixed(4)],
    );
  }
  pairs.push(
    [0, "POLYLINE"], [8, "0"], [62, DXF_RED], [66, 1], [10, "0.0"], [20, "0.0"], [30, "0.0"], [70, 1],
  );
  for (const [x, y] of job.cutLineMm ?? []) {
    pairs.push([0, "VERTEX"], [8, "0"], [10, x.toFixed(4)], [20, (job.heightMm - y).toFixed(4)], [30, "0.0"]);
  }
  pairs.push([0, "SEQEND"], [8, "0"], [0, "ENDSEC"], [0, "EOF"]);
  return pairs.map(([code, value]) => `${code}\n${value}`).join("\n") + "\n";
}
