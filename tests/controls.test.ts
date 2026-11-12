import { describe, expect, it } from "vitest";
import { ALL_CONTROLS, controlsInUse, getSettingValue, withSettingValue } from "../src/controls";
import { AREA_NAMES, AREA_TUNING_NAMES, defaultSettings } from "../src/settings";

describe("controls", () => {
  it("cover every setting exactly once", () => {
    const simpleNames = Object.keys(defaultSettings()).filter((name) => name !== "areas");
    const areaPaths = AREA_NAMES.flatMap((area) => AREA_TUNING_NAMES.map((tuning) => `areas.${area}.${tuning}`));
    expect(ALL_CONTROLS.map((control) => control.path).sort()).toEqual([...simpleNames, ...areaPaths].sort());
  });

  it("read and write the same values as the settings", () => {
    let settings = defaultSettings();
    settings = withSettingValue(settings, "width_mm", 77);
    settings = withSettingValue(settings, "look", "stencil");
    settings = withSettingValue(settings, "areas.hair.brightness", 0.35);
    expect(settings.width_mm).toBe(77);
    expect(settings.look).toBe("stencil");
    expect(settings.areas.hair.brightness).toBe(0.35);
    for (const control of ALL_CONTROLS) {
      expect(withSettingValue(settings, control.path, getSettingValue(settings, control.path))).toEqual(settings);
    }
  });

  it("do not change the settings they were given", () => {
    const settings = defaultSettings();
    withSettingValue(settings, "areas.eyes.contrast", 1);
    expect(settings).toEqual(defaultSettings());
  });

  it("start with default values inside their slider range", () => {
    const settings = defaultSettings();
    for (const control of ALL_CONTROLS) {
      if (control.kind === "slider") {
        const value = getSettingValue(settings, control.path) as number;
        expect(value).toBeGreaterThanOrEqual(control.min);
        expect(value).toBeLessThanOrEqual(control.max);
      }
    }
  });

  it("are only in use for the chosen options", () => {
    const settings = {
      ...defaultSettings(),
      look: "stencil" as const,
      burned_outline_on: false,
      cut_line_on: false,
      use_face_areas: false,
    };
    const inUse = controlsInUse(settings);
    expect(inUse.dither_method).toBe(false);
    expect(inUse.stencil_level).toBe(true);
    expect(inUse.burned_outline_mm).toBe(false);
    expect(inUse.cut_gap_mm).toBe(false);
    expect(inUse.cut_smoothness_mm).toBe(false);
    expect(inUse["areas.eyes.contrast"]).toBe(false);
    expect(inUse.width_mm).toBe(true);
  });
});
