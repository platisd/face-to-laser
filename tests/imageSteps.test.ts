import { beforeAll, describe, expect, it } from "vitest";
import { bilateralFilter, bilateralOnPaddedRows, bilateralSetup, paddedRows, valueRange } from "../src/bilateral";
import { newByteImage, newFloatImage } from "../src/images";
import { toDots, toStencil } from "../src/imageSteps";
import { EMPTY_BORDER_MM, makeLaserJob, pieceSize } from "../src/laserJob";
import { cv, floatImageFromMat, floatMat, loadOpenCv, withMats } from "../src/opencv";
import { grow } from "../src/outlines";
import { DITHER_METHODS, type Settings, defaultSettings } from "../src/settings";
import { roundFacePhoto } from "./roundFacePhoto";

function settingsWith(changes: Partial<Settings>): Settings {
  return { ...defaultSettings(), ...changes };
}

function row(image: { width: number; data: Uint8Array }, y: number): Uint8Array {
  return image.data.subarray(y * image.width, (y + 1) * image.width);
}

beforeAll(async () => {
  await loadOpenCv();
});

describe("image steps", () => {
  it.each(DITHER_METHODS)("%s dots keep the average brightness", (method) => {
    const dots = toDots(newFloatImage(64, 64, 0.3), method);
    expect(new Set(dots.data)).toEqual(new Set([0, 255]));
    const average = dots.data.reduce((sum, value) => sum + value, 0) / dots.data.length / 255;
    const allowedDifference = method === "atkinson" ? 0.1 : 0.05;
    expect(Math.abs(average - 0.3)).toBeLessThan(allowedDifference);
  });

  it("stencil removes tiny spots", () => {
    const gray = newFloatImage(50, 50, 1);
    gray.data[25 * 50 + 25] = 0;
    for (let y = 5; y < 20; y++) {
      for (let x = 5; x < 20; x++) {
        gray.data[y * 50 + x] = 0;
      }
    }
    const stencil = toStencil(gray, 0.5, 4);
    expect(stencil.data[25 * 50 + 25]).toBe(255);
    expect(stencil.data[12 * 50 + 12]).toBe(0);
  });

  it("grow adds the right distance", () => {
    const shape = newByteImage(50, 50);
    for (let y = 20; y < 30; y++) {
      for (let x = 20; x < 30; x++) {
        shape.data[y * 50 + x] = 1;
      }
    }
    const grown = grow(shape, 5);
    expect(grown.data[25 * 50 + 15]).toBe(1);
    expect(grown.data[25 * 50 + 14]).toBe(0);
  });
});

describe("laser job", () => {
  it("has the chosen width", () => {
    const job = makeLaserJob(roundFacePhoto(), settingsWith({ width_mm: 50, dots_per_mm: 10 }));
    expect(Math.abs(job.widthMm - 50)).toBeLessThan(0.2);
  });

  it("moves the cut line out with the gap and the burned outline", () => {
    const settings = settingsWith({
      width_mm: 50,
      cut_smoothness_mm: 0,
      cut_gap_mm: 2,
      burned_outline_on: true,
      burned_outline_mm: 3,
    });
    const job = makeLaserJob(roundFacePhoto(), settings);
    const photoWidthMm = 50 - 2 * (2 + 3 + EMPTY_BORDER_MM);
    const faceWidthMm = 0.9 * photoWidthMm;
    const xs = job.cutLineMm!.map(([x]) => x);
    expect(Math.abs(Math.max(...xs) - Math.min(...xs) - (faceWidthMm + 2 * (2 + 3)))).toBeLessThan(0.3);
  });

  it("burns nothing outside the cut line", () => {
    const job = makeLaserJob(roundFacePhoto(), settingsWith({ width_mm: 50, brightness: -2 }));
    expect(row(job.engrave, 0).every((value) => value === 255)).toBe(true);
    expect(row(job.engrave, Math.floor(job.engrave.height / 2)).subarray(2, -2).includes(0)).toBe(true);
  });

  it("makes the burned outline black", () => {
    const settings = settingsWith({ width_mm: 50, burned_outline_on: true, burned_outline_mm: 3 });
    const job = makeLaserJob(roundFacePhoto(), settings);
    const middleRow = row(job.engrave, Math.floor(job.engrave.height / 2));
    const firstBurned = middleRow.indexOf(0);
    expect(middleRow.subarray(firstBurned, firstBurned + 25).every((value) => value === 0)).toBe(true);
  });

  it("has no cut line when it is off", () => {
    const job = makeLaserJob(roundFacePhoto(), settingsWith({ width_mm: 50, cut_line_on: false }));
    expect(job.cutLineMm).toBeNull();
    expect(job.cutLinePx).toBeNull();
  });

  it("gives the same result with a cache as without", () => {
    const photo = roundFacePhoto();
    const cache = {};
    const changes: Partial<Settings>[] = [
      { width_mm: 50 },
      { width_mm: 50, contrast: 1 },
      { width_mm: 60, contrast: 1 },
      { width_mm: 60, contrast: 1, even_lighting: 0.9 },
    ];
    for (const change of changes) {
      const withCache = makeLaserJob(photo, settingsWith(change), cache);
      const withoutCache = makeLaserJob(photo, settingsWith(change));
      expect(withCache.tone.data).toEqual(withoutCache.tone.data);
      expect(withCache.engrave.data).toEqual(withoutCache.engrave.data);
    }
  });

  it.each(["photo", "stencil"] as const)("works with the %s look", (look) => {
    const job = makeLaserJob(roundFacePhoto(), settingsWith({ width_mm: 50, look }));
    expect(new Set(job.engrave.data)).toEqual(new Set([0, 255]));
  });
});

describe("edge-keeping blur", () => {
  it("gives the same result as OpenCV", () => {
    const gray = newFloatImage(120, 90);
    for (let i = 0; i < gray.data.length; i++) {
      gray.data[i] = (Math.sin(i / 37) + 1) / 2 * 0.7 + ((i * 7919) % 101) / 101 * 0.3;
    }
    for (const sigmaSpace of [4, 5, 3.2]) {
      const fromOpenCv = withMats((keep) => {
        const result = keep(new cv.Mat());
        cv.bilateralFilter(keep(floatMat(gray)), result, -1, 0.1, sigmaSpace, cv.BORDER_DEFAULT);
        return floatImageFromMat(result);
      });
      const ours = bilateralFilter(gray, 0.1, sigmaSpace);
      const largestDifference = Math.max(...ours.data.map((value, i) => Math.abs(value - fromOpenCv.data[i])));
      expect(largestDifference).toBeLessThan(1e-5);
    }
  });

  it("gives the same result when split into row strips", () => {
    const gray = newFloatImage(50, 40);
    for (let i = 0; i < gray.data.length; i++) {
      gray.data[i] = ((i * 7919) % 101) / 101;
    }
    const whole = bilateralFilter(gray, 0.1, 4);
    const setup = bilateralSetup(...valueRange(gray), 0.1, 4)!;
    const top = bilateralOnPaddedRows(paddedRows(gray, 0, 13, setup.radius), 50, 13, setup);
    const bottom = bilateralOnPaddedRows(paddedRows(gray, 13, 40, setup.radius), 50, 27, setup);
    expect(Array.from(top)).toEqual(Array.from(whole.data.subarray(0, 13 * 50)));
    expect(Array.from(bottom)).toEqual(Array.from(whole.data.subarray(13 * 50)));
  });
});

describe("piece size", () => {
  it("is the size of the cut line, smaller than the whole area by the empty border", () => {
    const job = makeLaserJob(roundFacePhoto(), settingsWith({ width_mm: 50, cut_smoothness_mm: 0 }));
    const size = pieceSize(job)!;
    const photoWidthMm = 50 - 2 * EMPTY_BORDER_MM;
    expect(Math.abs(size.widthMm - 0.9 * photoWidthMm)).toBeLessThan(0.3);
    expect(size.widthMm).toBeLessThan(job.widthMm - 2 * EMPTY_BORDER_MM + 0.01);
  });

  it("is the size of the burned area when there is no cut line", () => {
    const job = makeLaserJob(roundFacePhoto(), settingsWith({ width_mm: 50, cut_line_on: false, brightness: -2 }));
    const size = pieceSize(job)!;
    expect(size.widthMm).toBeGreaterThan(30);
    expect(size.widthMm).toBeLessThan(job.widthMm - 2 * EMPTY_BORDER_MM + 0.01);
  });
});
