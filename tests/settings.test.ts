import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultSettings, settingsFromJson, settingsToJson } from "../src/settings";

describe("settings", () => {
  it("survive save and load", () => {
    const settings = { ...defaultSettings(), width_mm: 123, look: "stencil" as const };
    settings.areas.eyes.contrast = 0.9;
    expect(settingsFromJson(settingsToJson(settings))).toEqual(settings);
  });

  it("fill in missing values when loading an old file", () => {
    const loaded = settingsFromJson('{"width_mm": 80, "unknown": 1, "areas": {"hair": {"contrast": 1.0}}}');
    expect(loaded.width_mm).toBe(80);
    expect(loaded.areas.hair.contrast).toBe(1.0);
    expect(loaded.areas.eyes).toEqual(defaultSettings().areas.eyes);
  });

  it("load a file saved by the Python version", () => {
    const loaded = settingsFromJson(readFileSync("tests/files/python_settings.json", "utf8"));
    expect(loaded.width_mm).toBe(123);
    expect(loaded.look).toBe("stencil");
    expect(loaded.dither_method).toBe("atkinson");
    expect(loaded.invert).toBe(true);
    expect(loaded.cut_gap_mm).toBe(2.5);
    expect(loaded.areas.eyes.contrast).toBe(0.9);
    expect(loaded.areas.skin).toEqual(defaultSettings().areas.skin);
  });

  it("save with the same keys as the Python version", () => {
    const pythonKeys = Object.keys(JSON.parse(readFileSync("tests/files/python_settings.json", "utf8")));
    expect(Object.keys(JSON.parse(settingsToJson(defaultSettings())))).toEqual(pythonKeys);
  });

  it("ignore values of the wrong kind", () => {
    const loaded = settingsFromJson('{"width_mm": "big", "look": "cartoon", "invert": 1, "areas": {"eyes": {"contrast": "x"}}}');
    expect(loaded).toEqual(defaultSettings());
  });

  it("refuse a file that is not settings", () => {
    expect(() => settingsFromJson("[1, 2]")).toThrow();
    expect(() => settingsFromJson("not json")).toThrow();
  });
});
