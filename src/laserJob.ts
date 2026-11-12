import { type ByteImage, type FloatImage, type PointList, bytesToFloats, newFloatImage, roundLikePython } from "./images";
import { type ToneMaps, applyTone, edgeKeepingBlur, evenOutLighting, toDots, toStencil } from "./imageSteps";
import { addBorder, resizeFloatImage } from "./opencv";
import { contourToMm, grow, keepBiggestPiece, smoothShape, solidShape } from "./outlines";
import { AREA_NAMES, type AreaName, type Settings } from "./settings";

export const EMPTY_BORDER_MM = 2.0;
export const SMALLEST_PHOTO_WIDTH_MM = 10.0;
export const NO_BURN = 255;
export const BURN = 0;

export type AreaMaps = Partial<Record<AreaName, FloatImage>>;

export interface PhotoAnalysis {
  gray: ByteImage;
  person: FloatImage;
  areas: AreaMaps;
  message: string;
}

export interface LaserJob {
  engrave: ByteImage;
  cutLineMm: PointList | null;
  cutLinePx: PointList | null;
  tone: FloatImage;
  areas: AreaMaps;
  dotsPerMm: number;
  widthMm: number;
  heightMm: number;
}

interface Canvas {
  gray: FloatImage;
  person: FloatImage;
  areas: AreaMaps;
}

export interface LaserJobCache {
  canvasKey?: string;
  canvas?: Canvas;
  toneStartKey?: string;
  evenedGray?: FloatImage;
  smoothGray?: FloatImage;
}

export function prepareLaserJobCache(photo: PhotoAnalysis, settings: Settings, cache: LaserJobCache): void {
  const dotsPerMm = settings.dots_per_mm;
  const spaceAroundPhotoMm = spaceAroundPhotoMmFor(settings);
  const photoWidthMm = Math.max(SMALLEST_PHOTO_WIDTH_MM, settings.width_mm - 2 * spaceAroundPhotoMm);
  const scale = (photoWidthMm * dotsPerMm) / photo.gray.width;
  const photoWidth = roundLikePython(photo.gray.width * scale);
  const photoHeight = roundLikePython(photo.gray.height * scale);
  const borderPx = roundLikePython(spaceAroundPhotoMm * dotsPerMm);

  const canvasKey = JSON.stringify([photoWidth, photoHeight, borderPx]);
  if (cache.canvasKey !== canvasKey || cache.canvas === undefined) {
    cache.canvasKey = canvasKey;
    cache.canvas = fitToCanvas(photo, photoWidth, photoHeight, borderPx);
  }
  const toneStartKey = JSON.stringify([canvasKey, settings.even_lighting, dotsPerMm]);
  if (cache.toneStartKey !== toneStartKey || cache.evenedGray === undefined) {
    cache.toneStartKey = toneStartKey;
    cache.evenedGray = evenOutLighting(cache.canvas.gray, settings.even_lighting);
    cache.smoothGray = undefined;
  }
}

function burnedOutlineMmFor(settings: Settings): number {
  return settings.burned_outline_on ? settings.burned_outline_mm : 0;
}

function cutGapMmFor(settings: Settings): number {
  return settings.cut_line_on ? settings.cut_gap_mm : 0;
}

function spaceAroundPhotoMmFor(settings: Settings): number {
  return burnedOutlineMmFor(settings) + cutGapMmFor(settings) + EMPTY_BORDER_MM;
}

export function makeLaserJob(photo: PhotoAnalysis, settings: Settings, cache: LaserJobCache = {}): LaserJob {
  const dotsPerMm = settings.dots_per_mm;
  const burnedOutlineMm = burnedOutlineMmFor(settings);
  const cutGapMm = cutGapMmFor(settings);
  prepareLaserJobCache(photo, settings, cache);
  const { person, areas } = cache.canvas!;
  const gray = cache.evenedGray!;
  cache.smoothGray ??= edgeKeepingBlur(gray, dotsPerMm);

  const tone = applyTone(gray, toneMaps(settings, areas, gray.width, gray.height), dotsPerMm, cache.smoothGray);
  for (let i = 0; i < tone.data.length; i++) {
    const value = settings.invert ? 1 - tone.data[i] : tone.data[i];
    tone.data[i] = value * person.data[i] + (1 - person.data[i]);
  }

  const engrave =
    settings.look === "stencil"
      ? toStencil(tone, settings.stencil_level, settings.stencil_min_spot_mm * dotsPerMm)
      : toDots(tone, settings.dither_method);

  const smoothnessPx = settings.cut_smoothness_mm * dotsPerMm;
  const shape = solidShape(person, smoothnessPx);
  const withOutline = grow(shape, burnedOutlineMm * dotsPerMm);
  for (let i = 0; i < engrave.data.length; i++) {
    if (withOutline.data[i] === 1 && shape.data[i] === 0) {
      engrave.data[i] = BURN;
      tone.data[i] = 0;
    }
  }

  let cutLinePx: PointList | null = null;
  let cutLineMm: PointList | null = null;
  if (settings.cut_line_on) {
    const cutShape = smoothShape(grow(withOutline, cutGapMm * dotsPerMm), smoothnessPx);
    const insideCut = keepBiggestPiece(cutShape);
    for (let i = 0; i < engrave.data.length; i++) {
      if (insideCut.shape.data[i] === 0) {
        engrave.data[i] = NO_BURN;
        tone.data[i] = 1;
      }
    }
    cutLinePx = insideCut.contour;
    if (cutLinePx !== null) {
      cutLineMm = contourToMm(cutLinePx, dotsPerMm);
    }
  }

  return {
    engrave,
    cutLineMm,
    cutLinePx,
    tone,
    areas,
    dotsPerMm,
    widthMm: engrave.width / dotsPerMm,
    heightMm: engrave.height / dotsPerMm,
  };
}

function fitToCanvas(photo: PhotoAnalysis, photoWidth: number, photoHeight: number, borderPx: number): Canvas {
  const fit = (image: FloatImage, borderValue: number) =>
    addBorder(resizeFloatImage(image, photoWidth, photoHeight), borderPx, borderValue);
  const areas: AreaMaps = {};
  for (const [name, mask] of Object.entries(photo.areas) as [AreaName, FloatImage][]) {
    areas[name] = fit(mask, 0);
  }
  return { gray: fit(bytesToFloats(photo.gray), 1), person: fit(photo.person, 0), areas };
}

export function toneMaps(settings: Settings, areas: AreaMaps, width: number, height: number): ToneMaps {
  const maps: ToneMaps = {
    smoothing: newFloatImage(width, height, settings.smoothing),
    contrast: newFloatImage(width, height, settings.contrast),
    brightness: newFloatImage(width, height, settings.brightness),
  };
  if (!settings.use_face_areas) {
    return maps;
  }
  for (const name of AREA_NAMES) {
    const area = areas[name];
    if (area === undefined) {
      continue;
    }
    const tuning = settings.areas[name];
    for (let i = 0; i < area.data.length; i++) {
      maps.smoothing.data[i] += area.data[i] * tuning.smoothing;
      maps.contrast.data[i] += area.data[i] * tuning.contrast;
      maps.brightness.data[i] += area.data[i] * tuning.brightness;
    }
  }
  return maps;
}

export interface PieceSize {
  widthMm: number;
  heightMm: number;
}

export function pieceSize(job: LaserJob): PieceSize | null {
  if (job.cutLineMm !== null) {
    const xs = job.cutLineMm.map(([x]) => x);
    const ys = job.cutLineMm.map(([, y]) => y);
    return { widthMm: Math.max(...xs) - Math.min(...xs), heightMm: Math.max(...ys) - Math.min(...ys) };
  }
  const { width, height, data } = job.engrave;
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] === BURN) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  if (right < 0) {
    return null;
  }
  return { widthMm: (right - left + 1) / job.dotsPerMm, heightMm: (bottom - top + 1) / job.dotsPerMm };
}
