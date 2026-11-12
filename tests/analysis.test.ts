import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { type PartFinders, analyzePhoto, findAreas } from "../src/analysis";
import { type FloatImage, type RgbaImage, newFloatImage } from "../src/images";
import { loadOpenCv } from "../src/opencv";

const FACE_POINTS: [number, number][] = JSON.parse(readFileSync("tests/files/face_points.json", "utf8"));

function photoWithPersonBox(width: number, height: number, box: { left: number; top: number; right: number; bottom: number }) {
  const photo: RgbaImage = { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
  const isPerson = (x: number, y: number) => x >= box.left && x < box.right && y >= box.top && y < box.bottom;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isPerson(x, y)) {
        photo.data.fill(60, (y * width + x) * 4, (y * width + x) * 4 + 3);
      }
    }
  }
  return photo;
}

function finderSeeingDarkPixelsAsPerson(facePoints: [number, number][] | null): PartFinders {
  return {
    async findPerson(image) {
      const person = newFloatImage(image.width, image.height);
      for (let i = 0; i < image.width * image.height; i++) {
        person.data[i] = image.data[i * 4] < 128 ? 1 : 0;
      }
      return person;
    },
    findBodyParts(image) {
      const parts: FloatImage[] = Array.from({ length: 6 }, () => newFloatImage(image.width, image.height));
      for (let i = 0; i < image.width * image.height; i++) {
        const isPerson = image.data[i * 4] < 128;
        parts[0].data[i] = isPerson ? 0.05 : 0.95;
        parts[3].data[i] = isPerson ? 0.95 : 0;
      }
      return parts;
    },
    findFacePoints: () => facePoints,
  };
}

beforeAll(async () => {
  await loadOpenCv();
});

describe("analysis", () => {
  it("crops to the person", async () => {
    const photo = photoWithPersonBox(300, 200, { left: 100, top: 50, right: 160, bottom: 150 });
    const analysis = await analyzePhoto(photo, finderSeeingDarkPixelsAsPerson(null));
    expect([analysis.gray.width, analysis.gray.height]).toEqual([60, 100]);
    expect([analysis.person.width, analysis.person.height]).toEqual([60, 100]);
    expect(analysis.person.data[50 * 60 + 30]).toBe(1);
  });

  it("keeps the photo content when cropping", async () => {
    const photo = photoWithPersonBox(300, 200, { left: 100, top: 50, right: 160, bottom: 150 });
    for (let y = 50; y < 150; y++) {
      for (let x = 100; x < 160; x++) {
        photo.data.fill(x - 100 + (y - 50), (y * 300 + x) * 4, (y * 300 + x) * 4 + 3);
      }
    }
    const analysis = await analyzePhoto(photo, finderSeeingDarkPixelsAsPerson(null));
    for (const [x, y] of [[0, 0], [59, 0], [0, 99], [17, 42]]) {
      expect(analysis.gray.data[y * 60 + x]).toBe(x + y);
    }
  });

  it("uses transparency as part of the person shape", async () => {
    const photo = photoWithPersonBox(100, 100, { left: 20, top: 20, right: 80, bottom: 80 });
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 50; x++) {
        photo.data[(y * 100 + x) * 4 + 3] = 0;
      }
    }
    const analysis = await analyzePhoto(photo, finderSeeingDarkPixelsAsPerson(null));
    expect(analysis.person.width).toBe(30);
    expect(analysis.gray.data[0]).toBe(60);
  });

  it("uses the whole photo when no person is found", async () => {
    const photo = photoWithPersonBox(80, 40, { left: 0, top: 0, right: 0, bottom: 0 });
    const analysis = await analyzePhoto(photo, finderSeeingDarkPixelsAsPerson(null));
    expect([analysis.person.width, analysis.person.height]).toEqual([80, 40]);
    expect(analysis.person.data.every((value) => value === 1)).toBe(true);
  });

  it("says when no face is found", async () => {
    const photo = photoWithPersonBox(100, 100, { left: 20, top: 20, right: 80, bottom: 80 });
    const analysis = await analyzePhoto(photo, finderSeeingDarkPixelsAsPerson(null));
    expect(analysis.message).toContain("No face found");
    expect(Object.keys(analysis.areas).sort()).toEqual(["clothes", "hair", "skin"]);
  });

  it("finds face areas that add up to at most 1, with features winning over skin", () => {
    const image = photoWithPersonBox(410, 512, { left: 0, top: 0, right: 410, bottom: 512 });
    const { areas, faceFound } = findAreas(image, finderSeeingDarkPixelsAsPerson(FACE_POINTS));
    expect(faceFound).toBe(true);
    expect(Object.keys(areas).sort()).toEqual(
      ["clothes", "eyebrows", "eyes", "face_edge", "hair", "mouth", "nose", "skin"].sort(),
    );
    const all = Object.values(areas);
    for (let i = 0; i < 410 * 512; i += 97) {
      expect(all.reduce((sum, area) => sum + area.data[i], 0)).toBeLessThanOrEqual(1.0001);
    }
    const [noseX, noseY] = FACE_POINTS[4];
    const nosePixel = Math.floor(noseY * 512) * 410 + Math.floor(noseX * 410);
    expect(areas.nose!.data[nosePixel]).toBeGreaterThan(0.5);
    expect(areas.skin!.data[nosePixel]).toBeLessThan(0.5);
  });
});
