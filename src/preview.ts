import { roundLikePython, toUint8 } from "./images";
import type { LaserJob } from "./laserJob";
import { contourMat, cv, withMats } from "./opencv";
import type { AreaName } from "./settings";

export const WOOD_COLOR = [228, 196, 150];
export const BURNED_WOOD_COLOR = [72, 46, 28];
export const CUT_LINE_COLOR = [255, 0, 0];
export const CUT_LINE_WIDTH_MM = 0.4;

export const AREA_COLORS: Record<AreaName, number[]> = {
  eyes: [0, 120, 255],
  eyebrows: [140, 0, 255],
  nose: [255, 140, 0],
  mouth: [255, 0, 90],
  face_edge: [255, 230, 0],
  skin: [255, 190, 170],
  hair: [0, 190, 90],
  clothes: [0, 200, 220],
};

export const PREVIEW_RESULT = "Result";
export const PREVIEW_GRAY = "Gray tones (before dots)";
export const PREVIEW_AREAS = "Face areas";
export const PREVIEW_MODES = [PREVIEW_RESULT, PREVIEW_GRAY, PREVIEW_AREAS] as const;
export type PreviewMode = (typeof PREVIEW_MODES)[number];

export interface RgbaPicture {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function makePreview(job: LaserJob, mode: PreviewMode, woodColors: boolean): RgbaPicture {
  const picture = mode === PREVIEW_AREAS ? coloredAreas(job) : paint(job, mode === PREVIEW_GRAY, woodColors);
  if (job.cutLinePx !== null || job.holePx !== null) {
    drawCutLines(picture, job);
  }
  return picture;
}

function paint(job: LaserJob, showTone: boolean, woodColors: boolean): RgbaPicture {
  const { width, height } = job.engrave;
  const picture = newPicture(width, height);
  const gray = showTone ? toUint8(job.tone).data : job.engrave.data;
  for (let i = 0; i < gray.length; i++) {
    for (let channel = 0; channel < 3; channel++) {
      picture.data[i * 4 + channel] = woodColors
        ? Math.floor(BURNED_WOOD_COLOR[channel] * (1 - gray[i] / 255) + WOOD_COLOR[channel] * (gray[i] / 255))
        : gray[i];
    }
  }
  return picture;
}

function coloredAreas(job: LaserJob): RgbaPicture {
  const { width, height } = job.tone;
  const picture = newPicture(width, height);
  const gray = toUint8(job.tone).data;
  const areas = Object.entries(job.areas) as [AreaName, { data: Float32Array }][];
  for (let i = 0; i < gray.length; i++) {
    const color = [0, 0, 0];
    let coverage = 0;
    for (const [name, area] of areas) {
      const weight = area.data[i];
      coverage += weight;
      for (let channel = 0; channel < 3; channel++) {
        color[channel] += weight * AREA_COLORS[name][channel];
      }
    }
    const shown = Math.min(Math.max(coverage, 0), 1) * 0.6;
    for (let channel = 0; channel < 3; channel++) {
      picture.data[i * 4 + channel] = Math.floor(gray[i] * (1 - shown) + color[channel] * 0.6);
    }
  }
  return picture;
}

function newPicture(width: number, height: number): RgbaPicture {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
}

function drawCutLines(picture: RgbaPicture, job: LaserJob): void {
  withMats((keep) => {
    const mat = keep(new cv.Mat(picture.height, picture.width, cv.CV_8UC4));
    mat.data.set(picture.data);
    const color = new cv.Scalar(...CUT_LINE_COLOR, 255);
    const thickness = Math.max(1, roundLikePython(CUT_LINE_WIDTH_MM * job.dotsPerMm));
    if (job.cutLinePx !== null) {
      const contours = keep(new cv.MatVector());
      contours.push_back(keep(contourMat(job.cutLinePx)));
      cv.drawContours(mat, contours, -1, color, thickness);
    }
    if (job.holePx !== null) {
      const center = new cv.Point(Math.round(job.holePx.x), Math.round(job.holePx.y));
      cv.circle(mat, center, Math.round(job.holePx.radius), color, thickness, cv.LINE_AA);
    }
    picture.data.set(mat.data);
  });
}
