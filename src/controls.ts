import {
  AREA_NAMES,
  AREA_TUNING_NAMES,
  type AreaName,
  type AreaTuningName,
  DITHER_METHODS,
  LOOKS,
  type Settings,
  type SimpleSettingName,
} from "./settings";

export type AreaSettingPath = `areas.${AreaName}.${AreaTuningName}`;
export type SettingPath = SimpleSettingName | AreaSettingPath;
export type SettingValue = number | string | boolean;

interface ControlBase {
  path: SettingPath;
  label: string;
  info?: string;
  row?: string;
}

export interface SliderControl extends ControlBase {
  kind: "slider";
  min: number;
  max: number;
  step: number;
}

export interface ChoiceControl extends ControlBase {
  kind: "radio" | "dropdown";
  choices: readonly string[];
}

export interface CheckboxControl extends ControlBase {
  kind: "checkbox";
}

export type Control = SliderControl | ChoiceControl | CheckboxControl;

export interface ControlGroup {
  title: string;
  open: boolean;
  note?: string;
  controls: Control[];
}

function slider(path: SettingPath, label: string, min: number, max: number, step: number, info?: string): SliderControl {
  return { kind: "slider", path, label, min, max, step, info };
}

export function readableAreaName(name: AreaName): string {
  const words = name.replace("_", " ");
  return words[0].toUpperCase() + words.slice(1);
}

export const CONTROL_GROUPS: ControlGroup[] = [
  {
    title: "Size",
    open: true,
    controls: [
      slider(
        "width_mm",
        "Width of the whole area (mm)",
        20,
        600,
        1,
        "The light area in the preview. The cut piece is a bit smaller: see the ruler and the sizes above the preview.",
      ),
      slider("dots_per_mm", "Dots per mm", 4, 20, 0.5, "10 = 254 DPI. Higher means finer, but slower to burn."),
    ],
  },
  {
    title: "Look",
    open: true,
    controls: [
      { kind: "radio", path: "look", label: "Look", choices: LOOKS },
      { kind: "dropdown", path: "dither_method", label: "Dot pattern (photo look)", choices: DITHER_METHODS },
      slider("stencil_level", "Black level (stencil look)", 0.05, 0.95, 0.01, "Higher means more black."),
      slider("stencil_min_spot_mm", "Smallest spot (stencil look, mm)", 0, 3, 0.1),
    ],
  },
  {
    title: "Image",
    open: true,
    controls: [
      slider("even_lighting", "Even out lighting", 0, 1, 0.05),
      slider("contrast", "Contrast", -1, 2, 0.05),
      slider("brightness", "Brightness", -1, 1.5, 0.05, "Wood burns dark, so a bit brighter is usually better."),
      slider("smoothing", "Smoothing", 0, 1, 0.05, "Removes small details like skin texture."),
      { kind: "checkbox", path: "invert", label: "Invert (for dark materials)" },
    ],
  },
  {
    title: "Face areas",
    open: false,
    note: "Each value is added on top of the Image values. 0 = no change.",
    controls: [
      { kind: "checkbox", path: "use_face_areas", label: "Use face areas" },
      ...AREA_NAMES.flatMap((area) =>
        AREA_TUNING_NAMES.map((tuning) => ({
          ...slider(`areas.${area}.${tuning}`, tuning[0].toUpperCase() + tuning.slice(1), -1, 1, 0.05),
          row: readableAreaName(area),
        })),
      ),
    ],
  },
  {
    title: "Outlines",
    open: true,
    controls: [
      { kind: "checkbox", path: "burned_outline_on", label: "Burned outline" },
      slider("burned_outline_mm", "Burned outline thickness (mm)", 0.5, 20, 0.5),
      { kind: "checkbox", path: "cut_line_on", label: "Cut line" },
      slider("cut_gap_mm", "Space between picture and cut line (mm)", 0, 30, 0.5),
      slider("cut_smoothness_mm", "Outline and cut line smoothness (mm)", 0, 5, 0.1),
    ],
  },
];

export const ALL_CONTROLS: Control[] = CONTROL_GROUPS.flatMap((group) => group.controls);

export function getSettingValue(settings: Settings, path: SettingPath): SettingValue {
  if (isAreaPath(path)) {
    const [, area, tuning] = path.split(".") as [string, AreaName, AreaTuningName];
    return settings.areas[area][tuning];
  }
  return settings[path as SimpleSettingName];
}

export function withSettingValue(settings: Settings, path: SettingPath, value: SettingValue): Settings {
  const changed: Settings = structuredClone(settings);
  if (isAreaPath(path)) {
    const [, area, tuning] = path.split(".") as [string, AreaName, AreaTuningName];
    changed.areas[area][tuning] = value as number;
  } else {
    (changed as unknown as Record<string, SettingValue>)[path] = value;
  }
  return changed;
}

function isAreaPath(path: SettingPath): path is AreaSettingPath {
  return path.startsWith("areas.");
}

export function controlsInUse(settings: Settings): Record<SettingPath, boolean> {
  const inUse = Object.fromEntries(ALL_CONTROLS.map((control) => [control.path, true])) as Record<SettingPath, boolean>;
  inUse.dither_method = settings.look === "photo";
  inUse.stencil_level = settings.look === "stencil";
  inUse.stencil_min_spot_mm = settings.look === "stencil";
  inUse.burned_outline_mm = settings.burned_outline_on;
  inUse.cut_gap_mm = settings.cut_line_on;
  inUse.cut_smoothness_mm = settings.burned_outline_on || settings.cut_line_on;
  for (const control of ALL_CONTROLS) {
    if (isAreaPath(control.path)) {
      inUse[control.path] = settings.use_face_areas;
    }
  }
  return inUse;
}
