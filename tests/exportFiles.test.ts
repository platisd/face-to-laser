import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";
import { crc32, makeLaserFiles, trimToPiece, zipFiles } from "../src/exportFiles";
import { safeFileName } from "../src/fileNames";
import { BURN, type LaserJob, makeLaserJob } from "../src/laserJob";
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
    const names = (await makeLaserFiles(job, { settings, crop: null, fileName: "face" }, "face")).map((file) => file.name);
    expect(names.sort()).toEqual(
      ["face_combined.svg", "face_cut.dxf", "face_cut.svg", "face_engrave.png", "face_settings.json"].sort(),
    );
  });

  it("writes no cut files when the cut line is off", async () => {
    const { job, settings } = jobWith({ cut_line_on: false });
    const names = (await makeLaserFiles(job, { settings, crop: null, fileName: "face" }, "face")).map((file) => file.name);
    expect(names.sort()).toEqual(["face_combined.svg", "face_engrave.png", "face_settings.json"]);
  });

  it("writes a gray PNG with a clear background and the dots per inch inside", async () => {
    const { job, settings } = jobWith({});
    const piece = trimToPiece(job);
    const files = await makeLaserFiles(job, { settings, crop: null, fileName: "face" }, "face");
    const chunks = readPngChunks(files.find((file) => file.name.endsWith(".png"))!.content);
    expect(chunks.map((chunk) => chunk.type)).toEqual(["IHDR", "pHYs", "IDAT", "IEND"]);

    const header = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset);
    expect([header.getUint32(0), header.getUint32(4)]).toEqual([piece.engrave.width, piece.engrave.height]);
    expect([chunks[0].data[8], chunks[0].data[9]]).toEqual([8, 4]);

    const physicalSize = new DataView(chunks[1].data.buffer, chunks[1].data.byteOffset);
    const dotsPerInch = physicalSize.getUint32(0) * 0.0254;
    expect(Math.abs(dotsPerInch - 254)).toBeLessThan(0.1);
    expect(chunks[1].data[8]).toBe(1);

    const rows = await unzlib(chunks[2].data);
    const bytesPerRow = piece.engrave.width * 2 + 1;
    for (let y = 0; y < piece.engrave.height; y += 37) {
      for (let x = 0; x < piece.engrave.width; x += 13) {
        const gray = rows[y * bytesPerRow + 1 + x * 2];
        const alpha = rows[y * bytesPerRow + 2 + x * 2];
        const burns = piece.engrave.data[y * piece.engrave.width + x] === BURN;
        expect([gray, alpha]).toEqual(burns ? [0, 255] : [255, 0]);
      }
    }
  });

  it("trims the empty space around the piece, keeping everything in place", () => {
    const { job } = jobWith({ keychain_on: true });
    const piece = trimToPiece(job);
    expect(piece.engrave.width).toBeLessThan(job.engrave.width);
    expect(piece.engrave.height).toBeLessThan(job.engrave.height);
    const xs = piece.cutLineMm!.map(([x]) => x);
    const ys = piece.cutLineMm!.map(([, y]) => y);
    expect(Math.min(...xs)).toBeGreaterThan(0);
    expect(Math.min(...ys)).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThan(piece.widthMm);
    expect(Math.max(...ys)).toBeLessThan(piece.heightMm);
    expect(Math.min(...xs)).toBeLessThan(0.3);
    expect(Math.min(...ys)).toBeLessThan(0.3);

    const leftMm = job.cutLineMm![0][0] - piece.cutLineMm![0][0];
    const topMm = job.cutLineMm![0][1] - piece.cutLineMm![0][1];
    expect(job.holeMm!.x - piece.holeMm!.x).toBeCloseTo(leftMm, 6);
    expect(job.holeMm!.y - piece.holeMm!.y).toBeCloseTo(topMm, 6);
    const left = Math.round(leftMm * job.dotsPerMm);
    const top = Math.round(topMm * job.dotsPerMm);
    for (let y = 0; y < piece.engrave.height; y += 11) {
      for (let x = 0; x < piece.engrave.width; x += 7) {
        expect(piece.engrave.data[y * piece.engrave.width + x]).toBe(job.engrave.data[(y + top) * job.engrave.width + x + left]);
      }
    }
  });

  it("writes an SVG with the size in mm and each part in its own layer", async () => {
    const { job, settings } = jobWith({});
    const piece = trimToPiece(job);
    const files = await makeLaserFiles(job, { settings, crop: null, fileName: "face" }, "face");
    const svg = new TextDecoder().decode(files.find((file) => file.name === "face_combined.svg")!.content);
    expect(svg).toContain(`width="${piece.widthMm.toFixed(3)}mm"`);
    expect(svg).toMatch(/<g id="engrave" [^>]*>\n<image [^>]*href="data:image\/png;base64,/);
    expect(svg).toMatch(/<g id="cut-outline" [^>]*>\n<path d="M [\d.]+ [\d.]+ (L [\d.]+ [\d.]+ )+Z" fill="none" stroke="#ff0000"/);
    const cutSvg = new TextDecoder().decode(files.find((file) => file.name === "face_cut.svg")!.content);
    expect(cutSvg).not.toContain("<image");
  });

  it("writes a DXF with one closed polyline in mm, y flipped", async () => {
    const { job, settings } = jobWith({});
    const piece = trimToPiece(job);
    const files = await makeLaserFiles(job, { settings, crop: null, fileName: "face" }, "face");
    const pairs = dxfPairs(new TextDecoder().decode(files.find((file) => file.name.endsWith(".dxf"))!.content));
    expect(pairs.filter(([code, value]) => code === "0" && value === "POLYLINE")).toHaveLength(1);
    const polylineAt = pairs.findIndex(([, value]) => value === "POLYLINE");
    expect(pairs[polylineAt + 1]).toEqual(["8", "OUTLINE"]);
    expect(pairs.slice(polylineAt).find(([code]) => code === "70")![1]).toBe("1");
    const unitsAt = pairs.findIndex(([, value]) => value === "$INSUNITS");
    expect(pairs[unitsAt + 1]).toEqual(["70", "4"]);

    const ys = pairs.filter(([code]) => code === "20").map(([, value]) => Number(value)).slice(1);
    expect(ys).toHaveLength(piece.cutLineMm!.length);
    expect(ys[0]).toBeCloseTo(piece.heightMm - piece.cutLineMm![0][1], 3);
    expect(pairs.at(-1)).toEqual(["0", "EOF"]);
  });

  it("writes the keychain hole as a blue circle in its own layer, before the outer cut line", async () => {
    const { job, settings } = jobWith({ keychain_on: true });
    const piece = trimToPiece(job);
    const files = await makeLaserFiles(job, { settings, crop: null, fileName: "face" }, "face");
    const read = (end: string) => new TextDecoder().decode(files.find((file) => file.name.endsWith(end))!.content);
    for (const svg of [read("_cut.svg"), read("_combined.svg")]) {
      expect(svg).toMatch(/<g id="cut-hole" [^>]*>\n<circle cx="[\d.]+" cy="[\d.]+" r="2.500" fill="none" stroke="#0000ff"/);
      expect(svg.indexOf("<circle")).toBeLessThan(svg.indexOf("<path"));
    }
    const pairs = dxfPairs(read(".dxf"));
    const circleAt = pairs.findIndex(([code, value]) => code === "0" && value === "CIRCLE");
    expect(circleAt).toBeGreaterThan(0);
    expect(pairs[circleAt + 1]).toEqual(["8", "HOLE"]);
    expect(circleAt).toBeLessThan(pairs.findIndex(([, value]) => value === "POLYLINE"));
    expect(pairs.slice(circleAt).find(([code]) => code === "40")![1]).toBe("2.5000");
    expect(Number(pairs.slice(circleAt).find(([code]) => code === "20")![1])).toBeCloseTo(piece.heightMm - piece.holeMm!.y, 3);
  });

  it("puts all files in one zip, with settings that load again", async () => {
    const { job, settings } = jobWith({ look: "stencil" });
    const files = await makeLaserFiles(job, { settings, crop: null, fileName: "face" }, "face");
    const zip = await JSZip.loadAsync(await zipFiles(files));
    expect(Object.keys(zip.files).sort()).toEqual(files.map((file) => file.name).sort());
    const savedSettings = await zip.file("face_settings.json")!.async("string");
    expect(settingsFromJson(savedSettings)).toEqual(settings);
  });

  it("adds the photo unchanged when there is one", async () => {
    const { job, settings } = jobWith({});
    const photo = new Blob([new Uint8Array([4, 5, 6])], { type: "image/png" });
    const files = await makeLaserFiles(job, { settings, crop: null, fileName: "face" }, "face", photo);
    expect(files.find((file) => file.name === "face_photo.png")!.content).toEqual(new Uint8Array([4, 5, 6]));
  });

  it("makes a safe file name", () => {
    expect(safeFileName("my face/../x .png")).toBe("myfacexpng");
    expect(safeFileName("anna_2-b")).toBe("anna_2-b");
    expect(safeFileName("///")).toBe("portrait");
  });
});
