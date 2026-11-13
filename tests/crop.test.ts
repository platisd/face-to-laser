import { describe, expect, it } from "vitest";
import { boxForShape, circleShape, cropBoxInPixels, movedBox, resizedBox, startingBox } from "../src/crop";

describe("crop", () => {
  it("starts circles and squares with equal sides in the middle of the photo", () => {
    expect(startingBox("circle", 1000, 500)).toEqual({ left: 300, top: 50, width: 400, height: 400 });
    expect(startingBox("rectangle", 1000, 500)).toEqual({ left: 100, top: 50, width: 800, height: 400 });
  });

  it("makes the sides equal around the same middle when changing to a square", () => {
    const box = boxForShape({ left: 100, top: 100, width: 400, height: 200 }, "square", 1000, 1000);
    expect(box).toEqual({ left: 200, top: 100, width: 200, height: 200 });
  });

  it("keeps a moved frame inside the photo", () => {
    const box = { left: 10, top: 10, width: 100, height: 50 };
    expect(movedBox(box, -500, 500, 300, 200)).toEqual({ left: 0, top: 150, width: 100, height: 50 });
  });

  it("resizes from the fixed corner towards the pointer, inside the photo", () => {
    expect(resizedBox([100, 100], [40, 160], false, 10, 300, 300)).toEqual({ left: 40, top: 100, width: 60, height: 60 });
    expect(resizedBox([100, 100], [400, 130], false, 10, 300, 300)).toEqual({ left: 100, top: 100, width: 200, height: 30 });
    expect(resizedBox([100, 100], [180, 120], true, 10, 300, 300)).toEqual({ left: 100, top: 100, width: 80, height: 80 });
    expect(resizedBox([250, 100], [400, 400], true, 10, 300, 300)).toEqual({ left: 250, top: 100, width: 50, height: 50 });
    expect(resizedBox([100, 100], [101, 101], false, 10, 300, 300)).toEqual({ left: 100, top: 100, width: 10, height: 10 });
  });

  it("turns the crop into whole pixels with equal sides for circles", () => {
    const crop = { shape: "circle" as const, boxAsPartOfPhoto: { left: 0.25, top: 0.1, width: 0.5, height: 0.25 } };
    expect(cropBoxInPixels(crop, 400, 801)).toEqual({ left: 100, top: 80, width: 200, height: 200 });
  });

  it("keeps the inside of the circle and drops the corners", () => {
    const shape = circleShape(20, 20);
    const at = (x: number, y: number) => shape.data[y * 20 + x];
    expect(at(0, 0)).toBe(0);
    expect(at(19, 19)).toBe(0);
    expect(at(10, 10)).toBe(1);
    expect(at(10, 1)).toBe(1);
  });
});
