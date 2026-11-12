import { describe, expect, it } from "vitest";
import { rulerStepsMm } from "../src/rulers";

describe("ruler", () => {
  it("uses wider steps for bigger pieces", () => {
    expect(rulerStepsMm(150)).toEqual({ labelStepMm: 10, tickStepMm: 5 });
    expect(rulerStepsMm(300)).toEqual({ labelStepMm: 20, tickStepMm: 10 });
    expect(rulerStepsMm(600)).toEqual({ labelStepMm: 50, tickStepMm: 10 });
  });
});
