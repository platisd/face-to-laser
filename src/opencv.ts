import type cvModule from "@techstark/opencv-js";
import type { ByteImage, FloatImage, PointList, RgbaImage } from "./images";

export type OpenCv = typeof cvModule;
export type Mat = InstanceType<OpenCv["Mat"]>;

interface Deletable {
  delete(): void;
}

export let cv: OpenCv;
let loading: Promise<OpenCv> | undefined;

export function loadOpenCv(): Promise<OpenCv> {
  loading ??= waitUntilOpenCvIsReady().then((ready) => {
    cv = ready;
    return ready;
  });
  return loading;
}

async function waitUntilOpenCvIsReady(): Promise<OpenCv> {
  const { openCvModule } = await import("./opencvModule");
  let loaded = openCvModule() as OpenCv & { then?: unknown; onRuntimeInitialized?: () => void };
  if ((loaded as unknown) instanceof Promise) {
    loaded = await (loaded as unknown as Promise<typeof loaded>);
  } else if (!loaded.Mat) {
    await new Promise<void>((resolve) => {
      loaded.onRuntimeInitialized = resolve;
    });
  }
  delete loaded.then;
  return loaded;
}

export function withMats<T>(work: (keep: <M extends Deletable>(mat: M) => M) => T): T {
  const kept: Deletable[] = [];
  try {
    return work((mat) => {
      kept.push(mat);
      return mat;
    });
  } finally {
    for (const mat of kept) {
      mat.delete();
    }
  }
}

export function floatMat(image: FloatImage): Mat {
  const mat = new cv.Mat(image.height, image.width, cv.CV_32F);
  mat.data32F.set(image.data);
  return mat;
}

export function byteMat(image: ByteImage): Mat {
  const mat = new cv.Mat(image.height, image.width, cv.CV_8U);
  mat.data.set(image.data);
  return mat;
}

export function floatImageFromMat(mat: Mat): FloatImage {
  return { width: mat.cols, height: mat.rows, data: mat.data32F.slice() };
}

export function byteImageFromMat(mat: Mat): ByteImage {
  return { width: mat.cols, height: mat.rows, data: mat.data.slice() };
}

export function contourMat(points: PointList): Mat {
  return cv.matFromArray(points.length, 1, cv.CV_32SC2, points.flat());
}

export function pointsFromMat(mat: Mat): PointList {
  const flat = mat.data32S;
  const points: PointList = [];
  for (let i = 0; i < flat.length; i += 2) {
    points.push([flat[i], flat[i + 1]]);
  }
  return points;
}

export function gaussianBlur(image: FloatImage, sigma: number): FloatImage {
  return withMats((keep) => {
    const result = keep(new cv.Mat());
    cv.GaussianBlur(keep(floatMat(image)), result, new cv.Size(0, 0), sigma, 0, cv.BORDER_DEFAULT);
    return floatImageFromMat(result);
  });
}

export const WIDE_BLUR_SMALL_SIGMA = 4;

export function wideBlur(image: FloatImage, sigma: number): FloatImage {
  const shrinkFactor = sigma / WIDE_BLUR_SMALL_SIGMA;
  if (shrinkFactor < 2) {
    return gaussianBlur(image, sigma);
  }
  const smallWidth = Math.max(1, Math.round(image.width / shrinkFactor));
  const smallHeight = Math.max(1, Math.round(image.height / shrinkFactor));
  const small = resizeFloatImage(image, smallWidth, smallHeight);
  const blurredSmall = gaussianBlur(small, sigma * (smallWidth / image.width));
  return resizeFloatImage(blurredSmall, image.width, image.height, true);
}

export function resizeFloatImage(image: FloatImage, width: number, height: number, smoothUpscale = false): FloatImage {
  if (image.width === width && image.height === height) {
    return image;
  }
  return withMats((keep) => {
    const result = keep(new cv.Mat());
    const interpolation = smoothUpscale ? cv.INTER_LINEAR : cv.INTER_AREA;
    cv.resize(keep(floatMat(image)), result, new cv.Size(width, height), 0, 0, interpolation);
    return floatImageFromMat(result);
  });
}

export function addBorder(image: FloatImage, borderPx: number, value: number): FloatImage {
  return withMats((keep) => {
    const result = keep(new cv.Mat());
    const border = new cv.Scalar(value, value, value, value);
    cv.copyMakeBorder(keep(floatMat(image)), result, borderPx, borderPx, borderPx, borderPx, cv.BORDER_CONSTANT, border);
    return floatImageFromMat(result);
  });
}

export function rgbaMat(image: RgbaImage): Mat {
  const mat = new cv.Mat(image.height, image.width, cv.CV_8UC4);
  mat.data.set(image.data);
  return mat;
}

export function rgbaImageFromMat(mat: Mat): RgbaImage {
  return { width: mat.cols, height: mat.rows, data: new Uint8ClampedArray(mat.data) };
}

export function shrinkRgba(image: RgbaImage, maxSide: number): RgbaImage {
  const scale = maxSide / Math.max(image.width, image.height);
  if (scale >= 1) {
    return image;
  }
  return withMats((keep) => {
    const result = keep(new cv.Mat());
    cv.resize(keep(rgbaMat(image)), result, new cv.Size(0, 0), scale, scale, cv.INTER_AREA);
    return rgbaImageFromMat(result);
  });
}

export function resizeRgba(image: RgbaImage, width: number, height: number): RgbaImage {
  return withMats((keep) => {
    const result = keep(new cv.Mat());
    const isShrinking = width < image.width || height < image.height;
    const interpolation = isShrinking ? cv.INTER_AREA : cv.INTER_LINEAR;
    cv.resize(keep(rgbaMat(image)), result, new cv.Size(width, height), 0, 0, interpolation);
    return rgbaImageFromMat(result);
  });
}

export function shrinkFloatImage(image: FloatImage, maxSide: number): FloatImage {
  const scale = maxSide / Math.max(image.width, image.height);
  if (scale >= 1) {
    return image;
  }
  return withMats((keep) => {
    const result = keep(new cv.Mat());
    cv.resize(keep(floatMat(image)), result, new cv.Size(0, 0), scale, scale, cv.INTER_AREA);
    return floatImageFromMat(result);
  });
}

export function grayFromRgba(image: RgbaImage): ByteImage {
  return withMats((keep) => {
    const result = keep(new cv.Mat());
    cv.cvtColor(keep(rgbaMat(image)), result, cv.COLOR_RGBA2GRAY);
    return byteImageFromMat(result);
  });
}
