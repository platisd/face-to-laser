import JSZip from "jszip";
import type { ByteImage, PointList } from "./images";
import type { Circle } from "./keychain";
import { BURN, type LaserJob } from "./laserJob";
import { type SavedWork, photoFileName, savedWorkToJson } from "./savedWork";

export const CUT_LINE_COLOR = "#ff0000";
export const HOLE_LINE_COLOR = "#0000ff";
export const CUT_LINE_WIDTH_MM = 0.1;
const DXF_RED = 1;
const DXF_BLUE = 5;
const DXF_MILLIMETERS = 4;
const DXF_OUTLINE_LAYER = "OUTLINE";
const DXF_HOLE_LAYER = "HOLE";
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const PNG_GRAY_WITH_ALPHA = 4;

export interface LaserFile {
  name: string;
  content: Uint8Array;
}

export interface LaserPiece {
  engrave: ByteImage;
  cutLineMm: PointList | null;
  holeMm: Circle | null;
  dotsPerMm: number;
  widthMm: number;
  heightMm: number;
}

export async function makeLaserFiles(
  job: LaserJob,
  work: SavedWork,
  name: string,
  photo: Blob | null = null,
): Promise<LaserFile[]> {
  const text = (value: string) => new TextEncoder().encode(value);
  const piece = trimToPiece(job);
  const engravePng = await engravePngBytes(piece);
  const files: LaserFile[] = [
    { name: `${name}_engrave.png`, content: engravePng },
    { name: `${name}_combined.svg`, content: text(svgText(piece, engravePng)) },
  ];
  if (piece.cutLineMm !== null) {
    files.push({ name: `${name}_cut.svg`, content: text(svgText(piece, null)) });
    files.push({ name: `${name}_cut.dxf`, content: text(dxfText(piece)) });
  }
  files.push({ name: `${name}_settings.json`, content: text(savedWorkToJson(work)) });
  if (photo !== null) {
    files.push({ name: photoFileName(name, photo), content: new Uint8Array(await photo.arrayBuffer()) });
  }
  return files;
}

export function trimToPiece(job: LaserPiece): LaserPiece {
  const { width, height, data } = job.engrave;
  const box = { left: width, top: height, right: -1, bottom: -1 };
  const addPoint = (x: number, y: number) => {
    box.left = Math.min(box.left, Math.floor(x));
    box.top = Math.min(box.top, Math.floor(y));
    box.right = Math.max(box.right, Math.ceil(x));
    box.bottom = Math.max(box.bottom, Math.ceil(y));
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] === BURN) {
        addPoint(x, y);
      }
    }
  }
  const lineReach = CUT_LINE_WIDTH_MM / 2;
  for (const [x, y] of job.cutLineMm ?? []) {
    addPoint((x - lineReach) * job.dotsPerMm, (y - lineReach) * job.dotsPerMm);
    addPoint((x + lineReach) * job.dotsPerMm, (y + lineReach) * job.dotsPerMm);
  }
  if (box.right < 0) {
    return job;
  }
  const left = Math.max(0, box.left - 1);
  const top = Math.max(0, box.top - 1);
  const right = Math.min(width - 1, box.right + 1);
  const bottom = Math.min(height - 1, box.bottom + 1);
  const engrave: ByteImage = { width: right - left + 1, height: bottom - top + 1, data: new Uint8Array(0) };
  engrave.data = new Uint8Array(engrave.width * engrave.height);
  for (let y = 0; y < engrave.height; y++) {
    const from = (y + top) * width + left;
    engrave.data.set(data.subarray(from, from + engrave.width), y * engrave.width);
  }
  const leftMm = left / job.dotsPerMm;
  const topMm = top / job.dotsPerMm;
  return {
    engrave,
    cutLineMm: job.cutLineMm?.map(([x, y]) => [x - leftMm, y - topMm]) ?? null,
    holeMm: job.holeMm === null ? null : { ...job.holeMm, x: job.holeMm.x - leftMm, y: job.holeMm.y - topMm },
    dotsPerMm: job.dotsPerMm,
    widthMm: engrave.width / job.dotsPerMm,
    heightMm: engrave.height / job.dotsPerMm,
  };
}

export async function zipFiles(files: LaserFile[]): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.name, file.content);
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export async function engravePngBytes(piece: LaserPiece): Promise<Uint8Array> {
  return grayPng(piece.engrave, Math.round(piece.dotsPerMm * 1000), true);
}

export async function grayPng(image: ByteImage, dotsPerMeter: number, whiteIsClear: boolean): Promise<Uint8Array> {
  const bytesPerRow = image.width * 2;
  const rows = new Uint8Array((bytesPerRow + 1) * image.height);
  for (let y = 0; y < image.height; y++) {
    const rowStart = y * (bytesPerRow + 1) + 1;
    for (let x = 0; x < image.width; x++) {
      const isWhite = image.data[y * image.width + x] >= 128;
      rows[rowStart + x * 2] = isWhite ? 255 : 0;
      rows[rowStart + x * 2 + 1] = isWhite && whiteIsClear ? 0 : 255;
    }
  }
  const header = new DataView(new ArrayBuffer(13));
  header.setUint32(0, image.width);
  header.setUint32(4, image.height);
  header.setUint8(8, 8);
  header.setUint8(9, PNG_GRAY_WITH_ALPHA);
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

export function svgText(piece: LaserPiece, engravePng: Uint8Array | null): string {
  const width = piece.widthMm.toFixed(3);
  const height = piece.heightMm.toFixed(3);
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ` +
      `width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">`,
  ];
  const layer = (id: string, label: string, content: string) =>
    parts.push(`<g id="${id}" inkscape:groupmode="layer" inkscape:label="${label}">`, content, "</g>");
  if (engravePng !== null) {
    const data = "data:image/png;base64," + toBase64(engravePng);
    layer(
      "engrave",
      "Engrave",
      `<image x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" ` +
        `style="image-rendering:pixelated" href="${data}" xlink:href="${data}"/>`,
    );
  }
  // The hole comes first: many laser programs cut in file order, and the piece
  // can move once its outer line is cut.
  if (piece.holeMm !== null) {
    const { x, y, radius } = piece.holeMm;
    layer(
      "cut-hole",
      "Cut hole",
      `<circle cx="${x.toFixed(3)}" cy="${y.toFixed(3)}" r="${radius.toFixed(3)}" fill="none" ` +
        `stroke="${HOLE_LINE_COLOR}" stroke-width="${CUT_LINE_WIDTH_MM}"/>`,
    );
  }
  if (piece.cutLineMm !== null) {
    layer(
      "cut-outline",
      "Cut outline",
      `<path d="${svgPath(piece.cutLineMm)}" fill="none" ` +
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

export function dxfText(piece: LaserPiece): string {
  const pairs: [number, string | number][] = [
    [0, "SECTION"], [2, "HEADER"],
    [9, "$ACADVER"], [1, "AC1009"],
    [9, "$INSUNITS"], [70, DXF_MILLIMETERS],
    [0, "ENDSEC"],
    [0, "SECTION"], [2, "TABLES"],
    [0, "TABLE"], [2, "LAYER"], [70, 2],
    [0, "LAYER"], [2, DXF_HOLE_LAYER], [70, 0], [62, DXF_BLUE], [6, "CONTINUOUS"],
    [0, "LAYER"], [2, DXF_OUTLINE_LAYER], [70, 0], [62, DXF_RED], [6, "CONTINUOUS"],
    [0, "ENDTAB"],
    [0, "ENDSEC"],
    [0, "SECTION"], [2, "ENTITIES"],
  ];
  if (piece.holeMm !== null) {
    const { x, y, radius } = piece.holeMm;
    pairs.push(
      [0, "CIRCLE"], [8, DXF_HOLE_LAYER], [62, DXF_BLUE],
      [10, x.toFixed(4)], [20, (piece.heightMm - y).toFixed(4)], [30, "0.0"], [40, radius.toFixed(4)],
    );
  }
  pairs.push(
    [0, "POLYLINE"], [8, DXF_OUTLINE_LAYER], [62, DXF_RED], [66, 1],
    [10, "0.0"], [20, "0.0"], [30, "0.0"], [70, 1],
  );
  for (const [x, y] of piece.cutLineMm ?? []) {
    pairs.push(
      [0, "VERTEX"], [8, DXF_OUTLINE_LAYER], [10, x.toFixed(4)], [20, (piece.heightMm - y).toFixed(4)], [30, "0.0"],
    );
  }
  pairs.push([0, "SEQEND"], [8, DXF_OUTLINE_LAYER], [0, "ENDSEC"], [0, "EOF"]);
  return pairs.map(([code, value]) => `${code}\n${value}`).join("\n") + "\n";
}
