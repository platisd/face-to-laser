import { type ByteImage, type FloatImage, type PointList, newByteImage } from "./images";
import {
  byteImageFromMat,
  byteMat,
  contourMat,
  cv,
  floatImageFromMat,
  gaussianBlur,
  pointsFromMat,
  withMats,
} from "./opencv";

export function solidShape(person: FloatImage, smoothnessPx: number): ByteImage {
  if (smoothnessPx >= 0.5) {
    person = gaussianBlur(person, smoothnessPx);
  }
  return fillHoles(aboveHalf(person));
}

function aboveHalf(image: FloatImage): ByteImage {
  const shape = newByteImage(image.width, image.height);
  for (let i = 0; i < shape.data.length; i++) {
    shape.data[i] = image.data[i] > 0.5 ? 1 : 0;
  }
  return shape;
}

export function fillHoles(shape: ByteImage): ByteImage {
  return withMats((keep) => {
    const contours = keep(new cv.MatVector());
    const hierarchy = keep(new cv.Mat());
    cv.findContours(keep(byteMat(shape)), contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const filled = keep(cv.Mat.zeros(shape.height, shape.width, cv.CV_8U));
    cv.drawContours(filled, contours, -1, new cv.Scalar(1), cv.FILLED);
    return byteImageFromMat(filled);
  });
}

export function grow(shape: ByteImage, distancePx: number): ByteImage {
  if (distancePx <= 0) {
    return shape;
  }
  const distanceToShape = withMats((keep) => {
    const outside = newByteImage(shape.width, shape.height);
    for (let i = 0; i < outside.data.length; i++) {
      outside.data[i] = 1 - shape.data[i];
    }
    const distances = keep(new cv.Mat());
    cv.distanceTransform(keep(byteMat(outside)), distances, cv.DIST_L2, cv.DIST_MASK_PRECISE, cv.CV_32F);
    return floatImageFromMat(distances);
  });
  const grown = newByteImage(shape.width, shape.height);
  for (let i = 0; i < grown.data.length; i++) {
    grown.data[i] = distanceToShape.data[i] <= distancePx ? 1 : 0;
  }
  return grown;
}

export function smoothShape(shape: ByteImage, smoothnessPx: number): ByteImage {
  if (smoothnessPx < 0.5) {
    return shape;
  }
  const blurred = withMats((keep) => {
    const asFloats = keep(new cv.Mat());
    keep(byteMat(shape)).convertTo(asFloats, cv.CV_32F);
    return gaussianBlur(floatImageFromMat(asFloats), smoothnessPx);
  });
  return fillHoles(aboveHalf(blurred));
}

export function keepBiggestPiece(shape: ByteImage): { shape: ByteImage; contour: PointList | null } {
  return withMats((keep) => {
    const contours = keep(new cv.MatVector());
    const hierarchy = keep(new cv.Mat());
    cv.findContours(keep(byteMat(shape)), contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);
    if (contours.size() === 0) {
      return { shape: newByteImage(shape.width, shape.height), contour: null };
    }
    let biggestIndex = 0;
    let biggestArea = -1;
    for (let i = 0; i < contours.size(); i++) {
      const area = cv.contourArea(keep(contours.get(i)));
      if (area > biggestArea) {
        biggestArea = area;
        biggestIndex = i;
      }
    }
    const onlyBiggest = keep(cv.Mat.zeros(shape.height, shape.width, cv.CV_8U));
    cv.drawContours(onlyBiggest, contours, biggestIndex, new cv.Scalar(1), cv.FILLED);
    return { shape: byteImageFromMat(onlyBiggest), contour: pointsFromMat(keep(contours.get(biggestIndex))) };
  });
}

export function contourToMm(contour: PointList, dotsPerMm: number, maxErrorMm = 0.05): PointList {
  const simpler = withMats((keep) => {
    const result = keep(new cv.Mat());
    cv.approxPolyDP(keep(contourMat(contour)), result, maxErrorMm * dotsPerMm, true);
    return pointsFromMat(result);
  });
  return simpler.map(([x, y]) => [(x + 0.5) / dotsPerMm, (y + 0.5) / dotsPerMm]);
}
