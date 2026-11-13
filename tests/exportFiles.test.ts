import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";
import { crc32, makeLaserFiles, zipFiles } from "../src/exportFiles";
import { safeFileName } from "../src/fileNames";
import { type LaserJob, makeLaserJob } from "../src/laserJob";
import { loadOpenCv } from "../src/opencv";
import { type Settings, defaultSettings, settingsFromJson } from "../src/settings";
import { roundFacePhoto } from "./roundFacePhoto";

function jobWith(changes: Partial<Settings>): { job: LaserJob; settings: Settings } {
  const settings = { ...defaultSettings(), width_mm: 50, ...changes };
  return { job: makeLaserJob(roundFacePhoto(), settings), settings };
}

interface PngChunk {
  type: string;
  data: Uint8Array;
}

function readPngChunks(png: Uint8Array): PngChunk[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: PngChunk[] = [];
  for (let offset = 8; offset < png.length; ) {
    const length = view.getUint32(offset);
    const typeAndData = png.subarray(offset + 4, offset + 8 + length);
    expect(view.getUint32(offset + 8 + length)).toBe(crc32(typeAndData));
    chunks.push({ type: new TextDecoder().decode(typeAndData.subarray(0, 4)), data: typeAndData.subarray(4) });
    offset += 12 + length;
  }
  return chunks;
}

async function unzlib(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function dxfPairs(text: string): [string, string][] {
  const lines = text.trimEnd().split("\n");
  const pairs: [string, string][] = [];
  for (let i = 0; i < lines.length; i += 2) {
    pairs.push([lines[i].trim(), lines[i + 1].trim()]);
  }
  return pairs;
}

beforeAll(async () => {
  await loadOpenCv();
});

describe("export files", () => {
  it("writes all files with the right names", async () => {
    const { job, settings } = jobWith({});
    const names = (await makeLaserFiles(job, settings, "face")).map((file) => file.name);
    expect(names.sort()).toEqual(
      ["face_combined.svg", "face_cut.dxf", "face_cut.svg", "face_engrave.png", "face_settings.json"].sort(),
    );
  });

  it("writes no cut files when the cut line is off", async () => {
    const { job, settings } = jobWith({ cut_line_on: false });
    const names = (await makeLaserFiles(job, settings, "face")).map((file) => file.name);
    expect(names.sort()).toEqual(["face_combined.svg", "face_engrave.png", "face_settings.json"]);
  });

  it("writes a black and white PNG with the dots per inch inside", async () => {
    const { job, settings } = jobWith({});
    const files = await makeLaserFiles(job, settings, "face");
    const chunks = readPngChunks(files.find((file) => file.name.endsWith(".png"))!.content);
    expect(chunks.map((chunk) => chunk.type)).toEqual(["IHDR", "pHYs", "IDAT", "IEND"]);

    const header = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset);
    expect([header.getUint32(0), header.getUint32(4)]).toEqual([job.engrave.width, job.engrave.height]);
    expect([chunks[0].data[8], chunks[0].data[9]]).toEqual([1, 0]);

    const physicalSize = new DataView(chunks[1].data.buffer, chunks[1].data.byteOffset);
    const dotsPerInch = physicalSize.getUint32(0) * 0.0254;
    expect(Math.abs(dotsPerInch - 254)).toBeLessThan(0.1);
    expect(chunks[1].data[8]).toBe(1);

    const rows = await unzlib(chunks[2].data);
    const bytesPerRow = Math.ceil(job.engrave.width / 8) + 1;
    for (let y = 0; y < job.engrave.height; y += 37) {
      for (let x = 0; x < job.engrave.width; x += 13) {
        const isWhite = (rows[y * bytesPerRow + 1 + (x >> 3)] >> (7 - (x & 7))) & 1;
        expect(isWhite * 255).toBe(job.engrave.data[y * job.engrave.width + x]);
      }
    }
  });

  it("writes an SVG with the size in mm", async () => {
    const { job, settings } = jobWith({});
    const files = await makeLaserFiles(job, settings, "face");
    const svg = new TextDecoder().decode(files.find((file) => file.name === "face_combined.svg")!.content);
    expect(svg).toContain(`width="${job.widthMm.toFixed(3)}mm"`);
    expect(svg).toContain('href="data:image/png;base64,');
    expect(svg).toMatch(/<path d="M [\d.]+ [\d.]+ (L [\d.]+ [\d.]+ )+Z" fill="none" stroke="#ff0000"/);
    const cutSvg = new TextDecoder().decode(files.find((file) => file.name === "face_cut.svg")!.content);
    expect(cutSvg).not.toContain("<image");
  });

  it("writes a DXF with one closed polyline in mm, y flipped", async () => {
    const { job, settings } = jobWith({});
    const files = await makeLaserFiles(job, settings, "face");
    const pairs = dxfPairs(new TextDecoder().decode(files.find((file) => file.name.endsWith(".dxf"))!.content));
    expect(pairs.filter(([code, value]) => code === "0" && value === "POLYLINE")).toHaveLength(1);
    const polylineAt = pairs.findIndex(([, value]) => value === "POLYLINE");
    expect(pairs.slice(polylineAt).find(([code]) => code === "70")![1]).toBe("1");
    const unitsAt = pairs.findIndex(([, value]) => value === "$INSUNITS");
    expect(pairs[unitsAt + 1]).toEqual(["70", "4"]);

    const ys = pairs.filter(([code]) => code === "20").map(([, value]) => Number(value)).slice(1);
    expect(ys).toHaveLength(job.cutLineMm!.length);
    expect(ys[0]).toBeCloseTo(job.heightMm - job.cutLineMm![0][1], 3);
    expect(pairs.at(-1)).toEqual(["0", "EOF"]);
  });

  it("writes the keychain hole as a circle, before the outer cut line", async () => {
    const { job, settings } = jobWith({ keychain_on: true });
    const files = await makeLaserFiles(job, settings, "face");
    const read = (end: string) => new TextDecoder().decode(files.find((file) => file.name.endsWith(end))!.content);
    for (const svg of [read("_cut.svg"), read("_combined.svg")]) {
      expect(svg).toMatch(/<circle cx="[\d.]+" cy="[\d.]+" r="2.500" fill="none" stroke="#ff0000"/);
      expect(svg.indexOf("<circle")).toBeLessThan(svg.indexOf("<path"));
    }
    const pairs = dxfPairs(read(".dxf"));
    const circleAt = pairs.findIndex(([code, value]) => code === "0" && value === "CIRCLE");
    expect(circleAt).toBeGreaterThan(0);
    expect(circleAt).toBeLessThan(pairs.findIndex(([, value]) => value === "POLYLINE"));
    expect(pairs.slice(circleAt).find(([code]) => code === "40")![1]).toBe("2.5000");
    expect(Number(pairs.slice(circleAt).find(([code]) => code === "20")![1])).toBeCloseTo(job.heightMm - job.holeMm!.y, 3);
  });

  it("puts all files in one zip, with settings that load again", async () => {
    const { job, settings } = jobWith({ look: "stencil" });
    const files = await makeLaserFiles(job, settings, "face");
    const zip = await JSZip.loadAsync(await zipFiles(files));
    expect(Object.keys(zip.files).sort()).toEqual(files.map((file) => file.name).sort());
    const savedSettings = await zip.file("face_settings.json")!.async("string");
    expect(settingsFromJson(savedSettings)).toEqual(settings);
  });

  it("makes a safe file name", () => {
    expect(safeFileName("my face/../x .png")).toBe("myfacexpng");
    expect(safeFileName("anna_2-b")).toBe("anna_2-b");
    expect(safeFileName("///")).toBe("portrait");
  });
});
