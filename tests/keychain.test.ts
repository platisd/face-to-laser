import { beforeAll, describe, expect, it } from "vitest";
import { newByteImage } from "../src/images";
import { angleTowards, holeDiameterMm, placeHolder } from "../src/keychain";
import { BURN, makeLaserJob } from "../src/laserJob";
import { loadOpenCv } from "../src/opencv";
import { type Settings, defaultSettings } from "../src/settings";
import { roundFacePhoto } from "./roundFacePhoto";

function jobWith(changes: Partial<Settings>) {
  return makeLaserJob(roundFacePhoto(), { ...defaultSettings(), width_mm: 50, keychain_on: true, ...changes });
}

function closestDistance(shape: { width: number; height: number; data: Uint8Array }, x: number, y: number): number {
  let closest = Infinity;
  for (let row = 0; row < shape.height; row++) {
    for (let column = 0; column < shape.width; column++) {
      if (shape.data[row * shape.width + column] === 1) {
        closest = Math.min(closest, Math.hypot(column - x, row - y));
      }
    }
  }
  return closest;
}

beforeAll(async () => {
  await loadOpenCv();
});

describe("keychain holder", () => {
  it("is off by default and changes nothing then", () => {
    const settings = { ...defaultSettings(), width_mm: 50 };
    const job = makeLaserJob(roundFacePhoto(), settings);
    expect(job.holeMm).toBeNull();
    expect(job.holderAimFromPx).toBeNull();
  });

  it("needs the cut line", () => {
    expect(jobWith({ cut_line_on: false }).holeMm).toBeNull();
  });

  it("sits at the top middle by default, inside the cut line", () => {
    const job = jobWith({});
    const hole = job.holeMm!;
    const xs = job.cutLineMm!.map(([x]) => x);
    const ys = job.cutLineMm!.map(([, y]) => y);
    const pieceMiddleX = (Math.min(...xs) + Math.max(...xs)) / 2;
    expect(hole.x).toBeCloseTo(pieceMiddleX, 0);
    expect(hole.radius).toBeCloseTo(2.5, 5);
    expect(Math.min(...ys)).toBeLessThan(hole.y - hole.radius - 1);
    expect(hole.y).toBeLessThan(job.heightMm / 2 - 20);
  });

  it("goes where the angle points", () => {
    const right = jobWith({ keychain_angle_deg: 90 }).holeMm!;
    const bottom = jobWith({ keychain_angle_deg: 180 }).holeMm!;
    const top = jobWith({}).holeMm!;
    expect(right.x).toBeGreaterThan(top.x + 15);
    expect(bottom.y).toBeGreaterThan(top.y + 30);
  });

  it("never burns inside the hole", () => {
    const job = jobWith({ burned_outline_on: true });
    const { x, y, radius } = job.holePx!;
    for (let row = Math.ceil(y - radius); row <= y + radius; row++) {
      for (let column = Math.ceil(x - radius); column <= x + radius; column++) {
        if (Math.hypot(column - x, row - y) <= radius) {
          expect(job.engrave.data[row * job.engrave.width + column]).not.toBe(BURN);
        }
      }
    }
  });

  it("keeps the hole away from the piece in a dip of the outline", () => {
    // Two shoulders with a dip between them, like a head seen from the back.
    const shape = newByteImage(300, 200);
    for (let y = 0; y < 200; y++) {
      for (let x = 0; x < 300; x++) {
        const inLeft = x >= 40 && x < 130 && y >= 40;
        const inRight = x >= 170 && x < 260 && y >= 40;
        const inBottom = x >= 40 && x < 260 && y >= 150;
        shape.data[y * 300 + x] = inLeft || inRight || inBottom ? 1 : 0;
      }
    }
    // The dip is 40 wide, too narrow for this hole, so the holder has to move up out of it.
    const holder = placeHolder(shape, 0, 40, 16)!;
    expect(holder.hole.x).toBeCloseTo(149.5, 5);
    expect(holder.hole.y).toBeLessThan(40);
    expect(closestDistance(shape, holder.hole.x, holder.hole.y)).toBeGreaterThanOrEqual((40 + 16) / 2 - 1);
  });

  it("keeps a ring wall around the hole", () => {
    expect(holeDiameterMm({ ...defaultSettings(), keychain_diameter_mm: 8, keychain_hole_diameter_mm: 7 })).toBe(5);
    expect(holeDiameterMm(defaultSettings())).toBe(5);
  });

  it("turns a click into an angle from the middle of the piece", () => {
    expect(angleTowards([100, 100], [100, 20])).toBe(0);
    expect(angleTowards([100, 100], [180, 100])).toBe(90);
    expect(angleTowards([100, 100], [100, 180])).toBe(180);
    expect(angleTowards([100, 100], [20, 100])).toBe(270);
  });
});
