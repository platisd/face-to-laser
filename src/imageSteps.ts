import { type ByteImage, type FloatImage, clamp, newByteImage, newFloatImage, roundLikePython, toUint8 } from "./images";
import { bilateralFilter } from "./bilateral";
import { byteImageFromMat, byteMat, cv, gaussianBlur, wideBlur, withMats } from "./opencv";
import type { DitherMethod } from "./settings";

export const SMOOTHING_REACH_MM = 0.4;
export const CONTRAST_REACH_MM = 3.0;
export const EVEN_LIGHTING_TILES = 8;

interface ErrorSpread {
  rows: number[][];
  centerColumn: number;
}

const ERROR_SPREADS: Record<Exclude<DitherMethod, "ordered">, ErrorSpread> = {
  floyd_steinberg: errorSpread([[0, 0, 7], [3, 5, 1]], 16, 1),
  jarvis: errorSpread([[0, 0, 0, 7, 5], [3, 5, 7, 5, 3], [1, 3, 5, 3, 1]], 48, 2),
  stucki: errorSpread([[0, 0, 0, 8, 4], [2, 4, 8, 4, 2], [1, 2, 4, 2, 1]], 42, 2),
  atkinson: errorSpread([[0, 0, 1, 1], [1, 1, 1, 0], [0, 1, 0, 0]], 8, 1),
};

function errorSpread(rows: number[][], divisor: number, centerColumn: number): ErrorSpread {
  return { rows: rows.map((row) => row.map((weight) => weight / divisor)), centerColumn };
}

export interface ToneMaps {
  smoothing: FloatImage;
  contrast: FloatImage;
  brightness: FloatImage;
}

export function evenOutLighting(gray: FloatImage, strength: number): FloatImage {
  if (strength <= 0) {
    return gray;
  }
  const evened = withMats((keep) => {
    const result = keep(new cv.Mat());
    const clahe = keep(new cv.CLAHE(1 + 3 * strength, new cv.Size(EVEN_LIGHTING_TILES, EVEN_LIGHTING_TILES)));
    clahe.apply(keep(byteMat(toUint8(gray))), result);
    return byteImageFromMat(result);
  });
  const result = newFloatImage(gray.width, gray.height);
  for (let i = 0; i < result.data.length; i++) {
    result.data[i] = gray.data[i] * (1 - strength) + (evened.data[i] / 255) * strength;
  }
  return result;
}

export const EDGE_KEEPING_COLOR_REACH = 0.1;
export const EDGE_KEEPING_PASSES = 2;

export function edgeKeepingBlur(gray: FloatImage, dotsPerMm: number): FloatImage {
  let current = gray;
  for (let pass = 0; pass < EDGE_KEEPING_PASSES; pass++) {
    current = bilateralFilter(current, EDGE_KEEPING_COLOR_REACH, SMOOTHING_REACH_MM * dotsPerMm);
  }
  return current;
}

export function applyTone(
  gray: FloatImage,
  maps: ToneMaps,
  dotsPerMm: number,
  smooth: FloatImage = edgeKeepingBlur(gray, dotsPerMm),
): FloatImage {
  const withDetails = newFloatImage(gray.width, gray.height);
  for (let i = 0; i < withDetails.data.length; i++) {
    const details = gray.data[i] - smooth.data[i];
    withDetails.data[i] = smooth.data[i] + details * (1 - clamp(maps.smoothing.data[i], -1, 1));
  }

  const localAverage = wideBlur(withDetails, CONTRAST_REACH_MM * dotsPerMm);
  const result = newFloatImage(gray.width, gray.height);
  for (let i = 0; i < result.data.length; i++) {
    const average = localAverage.data[i];
    const contrasted = average + (withDetails.data[i] - average) * (1 + clamp(maps.contrast.data[i], -0.9, 3));
    const gamma = 2 ** -clamp(maps.brightness.data[i], -2, 2);
    result.data[i] = clamp(contrasted, 0, 1) ** gamma;
  }
  return result;
}

export function toDots(gray: FloatImage, method: DitherMethod): ByteImage {
  if (method === "ordered") {
    return orderedDots(gray);
  }
  return spreadErrors(gray, ERROR_SPREADS[method]);
}

function spreadErrors(gray: FloatImage, spread: ErrorSpread): ByteImage {
  const { width, height } = gray;
  const work = Float64Array.from(gray.data);
  const result = newByteImage(width, height);
  const targets: { rowOffset: number; columnOffset: number; weight: number }[] = [];
  spread.rows.forEach((row, rowOffset) =>
    row.forEach((weight, column) => {
      if (weight !== 0) {
        targets.push({ rowOffset, columnOffset: column - spread.centerColumn, weight });
      }
    }),
  );
  const rowOffsets = Int32Array.from(targets, (target) => target.rowOffset);
  const columnOffsets = Int32Array.from(targets, (target) => target.columnOffset);
  const weights = Float64Array.from(targets, (target) => target.weight);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const oldValue = work[index];
      const isWhite = oldValue >= 0.5;
      result.data[index] = isWhite ? 255 : 0;
      const error = oldValue - (isWhite ? 1 : 0);
      for (let t = 0; t < weights.length; t++) {
        const targetY = y + rowOffsets[t];
        const targetX = x + columnOffsets[t];
        if (targetY < height && targetX >= 0 && targetX < width) {
          work[targetY * width + targetX] += error * weights[t];
        }
      }
    }
  }
  return result;
}

function orderedDots(gray: FloatImage): ByteImage {
  let pattern = [[0]];
  for (let step = 0; step < 3; step++) {
    const top = pattern.map((row) => [...row.map((v) => 4 * v), ...row.map((v) => 4 * v + 2)]);
    const bottom = pattern.map((row) => [...row.map((v) => 4 * v + 3), ...row.map((v) => 4 * v + 1)]);
    pattern = [...top, ...bottom];
  }
  const size = pattern.length;
  const result = newByteImage(gray.width, gray.height);
  for (let y = 0; y < gray.height; y++) {
    for (let x = 0; x < gray.width; x++) {
      const threshold = (pattern[y % size][x % size] + 0.5) / (size * size);
      const index = y * gray.width + x;
      result.data[index] = gray.data[index] >= threshold ? 255 : 0;
    }
  }
  return result;
}

export function toStencil(gray: FloatImage, level: number, minSpotPx: number): ByteImage {
  if (minSpotPx >= 1) {
    gray = gaussianBlur(gray, minSpotPx / 3);
  }
  let black = newByteImage(gray.width, gray.height);
  for (let i = 0; i < black.data.length; i++) {
    black.data[i] = gray.data[i] < level ? 1 : 0;
  }
  if (minSpotPx >= 2) {
    black = withMats((keep) => {
      const spotSize = roundLikePython(minSpotPx);
      const kernel = keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(spotSize, spotSize)));
      const opened = keep(new cv.Mat());
      const closed = keep(new cv.Mat());
      cv.morphologyEx(keep(byteMat(black)), opened, cv.MORPH_OPEN, kernel);
      cv.morphologyEx(opened, closed, cv.MORPH_CLOSE, kernel);
      return byteImageFromMat(closed);
    });
  }
  const result = newByteImage(gray.width, gray.height);
  for (let i = 0; i < result.data.length; i++) {
    result.data[i] = black.data[i] === 1 ? 0 : 255;
  }
  return result;
}
