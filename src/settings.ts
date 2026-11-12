export const AREA_NAMES = ["eyes", "eyebrows", "nose", "mouth", "face_edge", "skin", "hair", "clothes"] as const;
export const DITHER_METHODS = ["atkinson", "jarvis", "stucki", "floyd_steinberg", "ordered"] as const;
export const LOOKS = ["photo", "stencil"] as const;
export const AREA_TUNING_NAMES = ["contrast", "brightness", "smoothing"] as const;

export type AreaName = (typeof AREA_NAMES)[number];
export type DitherMethod = (typeof DITHER_METHODS)[number];
export type Look = (typeof LOOKS)[number];
export type AreaTuningName = (typeof AREA_TUNING_NAMES)[number];
export type AreaTuning = Record<AreaTuningName, number>;

export interface Settings {
  width_mm: number;
  dots_per_mm: number;

  look: Look;
  dither_method: DitherMethod;
  stencil_level: number;
  stencil_min_spot_mm: number;

  even_lighting: number;
  contrast: number;
  brightness: number;
  smoothing: number;
  invert: boolean;

  use_face_areas: boolean;
  areas: Record<AreaName, AreaTuning>;

  burned_outline_on: boolean;
  burned_outline_mm: number;

  cut_line_on: boolean;
  cut_gap_mm: number;
  cut_smoothness_mm: number;
}

export type SimpleSettingName = Exclude<keyof Settings, "areas">;

export function defaultAreaTunings(): Record<AreaName, AreaTuning> {
  return {
    eyes: { contrast: 0.6, brightness: 0.0, smoothing: -0.4 },
    eyebrows: { contrast: 0.4, brightness: 0.0, smoothing: -0.2 },
    nose: { contrast: 0.2, brightness: 0.0, smoothing: 0.0 },
    mouth: { contrast: 0.3, brightness: 0.0, smoothing: -0.2 },
    face_edge: { contrast: 0.4, brightness: 0.0, smoothing: 0.0 },
    skin: { contrast: -0.2, brightness: 0.2, smoothing: 0.4 },
    hair: { contrast: 0.6, brightness: 0.0, smoothing: -0.2 },
    clothes: { contrast: -0.3, brightness: 0.3, smoothing: 0.5 },
  };
}

export function defaultSettings(): Settings {
  return {
    width_mm: 100.0,
    dots_per_mm: 10.0,

    look: "photo",
    dither_method: "atkinson",
    stencil_level: 0.5,
    stencil_min_spot_mm: 0.4,

    even_lighting: 0.3,
    contrast: 0.3,
    brightness: 0.3,
    smoothing: 0.2,
    invert: false,

    use_face_areas: true,
    areas: defaultAreaTunings(),

    burned_outline_on: false,
    burned_outline_mm: 3.0,

    cut_line_on: true,
    cut_gap_mm: 0.0,
    cut_smoothness_mm: 1.0,
  };
}

const ALLOWED_CHOICES: Partial<Record<SimpleSettingName, readonly string[]>> = {
  look: LOOKS,
  dither_method: DITHER_METHODS,
};

export function settingsToJson(settings: Settings): string {
  return JSON.stringify(settings, null, 2);
}

export function settingsFromJson(text: string): Settings {
  const loaded: unknown = JSON.parse(text);
  if (!isPlainObject(loaded)) {
    throw new Error("the file does not hold settings");
  }
  const settings = defaultSettings();
  const writable = settings as unknown as Record<string, unknown>;
  for (const name of Object.keys(settings) as (keyof Settings)[]) {
    if (name === "areas" || !(name in loaded)) {
      continue;
    }
    const value = loaded[name];
    if (fitsSetting(name, settings[name], value)) {
      writable[name] = value;
    }
  }
  if (isPlainObject(loaded.areas)) {
    for (const [areaName, tuning] of Object.entries(loaded.areas)) {
      if (!isAreaName(areaName) || !isPlainObject(tuning)) {
        continue;
      }
      for (const tuningName of AREA_TUNING_NAMES) {
        const value = tuning[tuningName];
        if (typeof value === "number" && Number.isFinite(value)) {
          settings.areas[areaName][tuningName] = value;
        }
      }
    }
  }
  return settings;
}

function fitsSetting(name: SimpleSettingName, defaultValue: unknown, value: unknown): boolean {
  if (typeof value !== typeof defaultValue) {
    return false;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  const choices = ALLOWED_CHOICES[name];
  return choices === undefined || choices.includes(value as string);
}

export function isAreaName(name: string): name is AreaName {
  return (AREA_NAMES as readonly string[]).includes(name);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
