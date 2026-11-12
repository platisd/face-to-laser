export interface FloatImage {
  width: number;
  height: number;
  data: Float32Array;
}

export interface ByteImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export type PointList = [number, number][];

export function newFloatImage(width: number, height: number, fill = 0): FloatImage {
  return { width, height, data: new Float32Array(width * height).fill(fill) };
}

export function newByteImage(width: number, height: number, fill = 0): ByteImage {
  return { width, height, data: new Uint8Array(width * height).fill(fill) };
}

export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

export function roundLikePython(value: number): number {
  const below = Math.floor(value);
  const fraction = value - below;
  if (fraction !== 0.5) {
    return Math.round(value);
  }
  return below % 2 === 0 ? below : below + 1;
}

export function toUint8(gray: FloatImage): ByteImage {
  const result = newByteImage(gray.width, gray.height);
  for (let i = 0; i < gray.data.length; i++) {
    result.data[i] = clamp(Math.floor(gray.data[i] * 255 + 0.5), 0, 255);
  }
  return result;
}

export function bytesToFloats(image: ByteImage): FloatImage {
  const result = newFloatImage(image.width, image.height);
  for (let i = 0; i < image.data.length; i++) {
    result.data[i] = image.data[i] / 255;
  }
  return result;
}

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
