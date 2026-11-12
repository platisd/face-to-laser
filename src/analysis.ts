import { FACE_FEATURE_POINT_GROUPS, FACE_OVAL_LINES, FACE_OVAL_POINTS } from "./facePoints";
import { type FloatImage, type RgbaImage, clamp, newFloatImage, roundLikePython } from "./images";
import type { AreaMaps, PhotoAnalysis } from "./laserJob";
import {
  contourMat,
  cv,
  floatImageFromMat,
  gaussianBlur,
  grayFromRgba,
  resizeFloatImage,
  shrinkFloatImage,
  shrinkRgba,
  withMats,
} from "./opencv";

export const PHOTO_MAX_SIDE = 3000;
export const AREA_MAP_MAX_SIDE = 1024;
export const PERSON_MAP_MAX_SIDE = 1024;

export const SEGMENTER_HAIR = 1;
export const SEGMENTER_BODY_SKIN = 2;
export const SEGMENTER_FACE_SKIN = 3;
export const SEGMENTER_CLOTHES = 4;
export const SEGMENTER_OTHER = 5;

export interface PartFinders {
  findPerson(image: RgbaImage): Promise<FloatImage>;
  findBodyParts(image: RgbaImage): FloatImage[];
  findFacePoints(image: RgbaImage): [number, number][] | null;
}

export async function analyzePhoto(photo: RgbaImage, finders: PartFinders): Promise<PhotoAnalysis> {
  const { onWhite, visible } = putOnWhite(photo);

  const forPersonMap = shrinkRgba(onWhite, PERSON_MAP_MAX_SIDE);
  const foundPerson = await finders.findPerson(forPersonMap);
  const person = resizeFloatImage(foundPerson, photo.width, photo.height, true);
  for (let i = 0; i < person.data.length; i++) {
    person.data[i] = clamp(person.data[i], 0, 1) * visible.data[i];
  }
  const messages = ["Removed the background."];

  const cropped = cropToPerson(onWhite, person);
  const rgba = shrinkRgba(cropped.rgba, PHOTO_MAX_SIDE);
  const croppedPerson = shrinkFloatImage(cropped.person, PHOTO_MAX_SIDE);

  const forAreaMap = shrinkRgba(rgba, AREA_MAP_MAX_SIDE);
  const { areas, faceFound } = findAreas(forAreaMap, finders);
  if (!faceFound) {
    messages.push("No face found: eyes, eyebrows, nose, mouth and face edge are not used.");
  }
  return { gray: grayFromRgba(rgba), person: croppedPerson, areas, message: messages.join(" ") };
}

export function putOnWhite(photo: RgbaImage): { onWhite: RgbaImage; visible: FloatImage } {
  const onWhite: RgbaImage = { width: photo.width, height: photo.height, data: new Uint8ClampedArray(photo.data.length) };
  const visible = newFloatImage(photo.width, photo.height);
  for (let i = 0; i < visible.data.length; i++) {
    const alpha = photo.data[i * 4 + 3] / 255;
    visible.data[i] = alpha;
    for (let channel = 0; channel < 3; channel++) {
      onWhite.data[i * 4 + channel] = photo.data[i * 4 + channel] * alpha + 255 * (1 - alpha);
    }
    onWhite.data[i * 4 + 3] = 255;
  }
  return { onWhite, visible };
}

function bodyPartsAtSize(finders: PartFinders, image: RgbaImage): FloatImage[] {
  return finders.findBodyParts(image).map((part) => resizeFloatImage(part, image.width, image.height, true));
}

export function cropToPerson(rgba: RgbaImage, person: FloatImage): { rgba: RgbaImage; person: FloatImage } {
  let top = Infinity;
  let bottom = -1;
  let left = Infinity;
  let right = -1;
  for (let y = 0; y < person.height; y++) {
    for (let x = 0; x < person.width; x++) {
      if (person.data[y * person.width + x] > 0.5) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
  }
  if (bottom < 0) {
    return { rgba, person: newFloatImage(person.width, person.height, 1) };
  }
  const width = right - left + 1;
  const height = bottom - top + 1;
  const croppedPerson = newFloatImage(width, height);
  for (let y = 0; y < height; y++) {
    const start = (top + y) * person.width + left;
    croppedPerson.data.set(person.data.subarray(start, start + width), y * width);
  }
  const croppedRgba: RgbaImage = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  for (let y = 0; y < height; y++) {
    const start = ((top + y) * rgba.width + left) * 4;
    croppedRgba.data.set(rgba.data.subarray(start, start + width * 4), y * width * 4);
  }
  return { rgba: croppedRgba, person: croppedPerson };
}

export function findAreas(image: RgbaImage, finders: PartFinders): { areas: AreaMaps; faceFound: boolean } {
  const { width, height } = image;
  const bodyParts = bodyPartsAtSize(finders, image);
  const facePoints = finders.findFacePoints(image);
  const features: AreaMaps = facePoints
    ? faceFeatureAreas(
        facePoints.map(([x, y]) => [x * width, y * height]),
        width,
        height,
      )
    : {};

  const rest = newFloatImage(width, height);
  for (let i = 0; i < rest.data.length; i++) {
    let featuresTotal = 0;
    for (const feature of Object.values(features)) {
      featuresTotal += feature.data[i];
    }
    rest.data[i] = 1 - clamp(featuresTotal, 0, 1);
  }

  const restOf = (...partIndices: number[]) => {
    const area = newFloatImage(width, height);
    for (let i = 0; i < area.data.length; i++) {
      let total = 0;
      for (const partIndex of partIndices) {
        total += bodyParts[partIndex].data[i];
      }
      area.data[i] = total * rest.data[i];
    }
    return area;
  };

  const areas: AreaMaps = {
    ...features,
    hair: restOf(SEGMENTER_HAIR),
    skin: restOf(SEGMENTER_FACE_SKIN, SEGMENTER_BODY_SKIN),
    clothes: restOf(SEGMENTER_CLOTHES, SEGMENTER_OTHER),
  };
  return { areas, faceFound: facePoints !== null };
}

export function faceFeatureAreas(points: [number, number][], width: number, height: number): AreaMaps {
  const ovalXs = FACE_OVAL_POINTS.map((index) => points[index][0]);
  const faceWidth = Math.max(...ovalXs) - Math.min(...ovalXs);
  const asPixel = (index: number): [number, number] => [Math.trunc(points[index][0]), Math.trunc(points[index][1])];

  const filled = (pointGroups: number[][], growFraction: number) => {
    const mask = withMats((keep) => {
      const canvas = keep(cv.Mat.zeros(height, width, cv.CV_32F));
      for (const group of pointGroups) {
        const hull = keep(new cv.Mat());
        cv.convexHull(keep(contourMat(group.map(asPixel))), hull, false, true);
        cv.fillConvexPoly(canvas, hull, new cv.Scalar(1));
      }
      return floatImageFromMat(canvas);
    });
    return growSoftly(mask, growFraction * faceWidth);
  };

  const faceEdge = withMats((keep) => {
    const canvas = keep(cv.Mat.zeros(height, width, cv.CV_32F));
    const thickness = Math.max(1, roundLikePython(0.04 * faceWidth));
    for (const [start, end] of FACE_OVAL_LINES) {
      const [startX, startY] = asPixel(start);
      const [endX, endY] = asPixel(end);
      cv.line(canvas, new cv.Point(startX, startY), new cv.Point(endX, endY), new cv.Scalar(1), thickness);
    }
    return floatImageFromMat(canvas);
  });

  const features = {
    eyes: filled(FACE_FEATURE_POINT_GROUPS.eyes, 0.04),
    eyebrows: filled(FACE_FEATURE_POINT_GROUPS.eyebrows, 0.025),
    nose: filled(FACE_FEATURE_POINT_GROUPS.nose, 0.02),
    mouth: filled(FACE_FEATURE_POINT_GROUPS.mouth, 0.03),
    face_edge: growSoftly(faceEdge, 0.02 * faceWidth),
  };
  const all = Object.values(features);
  for (let i = 0; i < width * height; i++) {
    let overlap = 0;
    for (const feature of all) {
      overlap += feature.data[i];
    }
    if (overlap > 1) {
      for (const feature of all) {
        feature.data[i] /= overlap;
      }
    }
  }
  return features;
}

export function growSoftly(mask: FloatImage, distancePx: number): FloatImage {
  if (distancePx < 0.5) {
    return mask;
  }
  const blurred = gaussianBlur(mask, distancePx);
  for (let i = 0; i < blurred.data.length; i++) {
    blurred.data[i] = clamp(blurred.data[i] * 2, 0, 1);
  }
  return blurred;
}
