import { type FloatImage, clamp, newFloatImage } from "./images";

export const CROP_CHOICES = ["none", "circle", "rectangle", "square"] as const;
export type CropChoice = (typeof CROP_CHOICES)[number];
export type CropShape = Exclude<CropChoice, "none">;

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Crop {
  shape: CropShape;
  boxAsPartOfPhoto: Box;
}

export type Point = [number, number];

export function keepsEqualSides(shape: CropShape): boolean {
  return shape === "circle" || shape === "square";
}

export function startingBox(shape: CropShape, photoWidth: number, photoHeight: number): Box {
  const width = keepsEqualSides(shape) ? Math.min(photoWidth, photoHeight) * 0.8 : photoWidth * 0.8;
  const height = keepsEqualSides(shape) ? width : photoHeight * 0.8;
  return { left: (photoWidth - width) / 2, top: (photoHeight - height) / 2, width, height };
}

export function boxForShape(box: Box | null, shape: CropShape, photoWidth: number, photoHeight: number): Box {
  if (box === null) {
    return startingBox(shape, photoWidth, photoHeight);
  }
  if (!keepsEqualSides(shape)) {
    return box;
  }
  const side = Math.min(box.width, box.height);
  const centerX = box.left + box.width / 2;
  const centerY = box.top + box.height / 2;
  return movedBox({ left: centerX - side / 2, top: centerY - side / 2, width: side, height: side }, 0, 0, photoWidth, photoHeight);
}

export function movedBox(box: Box, byX: number, byY: number, photoWidth: number, photoHeight: number): Box {
  return {
    ...box,
    left: clamp(box.left + byX, 0, photoWidth - box.width),
    top: clamp(box.top + byY, 0, photoHeight - box.height),
  };
}

export function resizedBox(
  fixedCorner: Point,
  pointer: Point,
  equalSides: boolean,
  smallestSide: number,
  photoWidth: number,
  photoHeight: number,
): Box {
  const [fixedX, fixedY] = fixedCorner;
  const growsRight = pointer[0] >= fixedX;
  const growsDown = pointer[1] >= fixedY;
  const roomX = growsRight ? photoWidth - fixedX : fixedX;
  const roomY = growsDown ? photoHeight - fixedY : fixedY;
  let width = Math.min(Math.max(Math.abs(pointer[0] - fixedX), smallestSide), roomX);
  let height = Math.min(Math.max(Math.abs(pointer[1] - fixedY), smallestSide), roomY);
  if (equalSides) {
    width = Math.min(Math.max(width, height), roomX, roomY);
    height = width;
  }
  return {
    left: growsRight ? fixedX : fixedX - width,
    top: growsDown ? fixedY : fixedY - height,
    width,
    height,
  };
}

export function asPartOfPhoto(box: Box, photoWidth: number, photoHeight: number): Box {
  return {
    left: box.left / photoWidth,
    top: box.top / photoHeight,
    width: box.width / photoWidth,
    height: box.height / photoHeight,
  };
}

export function cropBoxInPixels(crop: Crop, photoWidth: number, photoHeight: number): Box {
  const part = crop.boxAsPartOfPhoto;
  const left = clamp(Math.round(part.left * photoWidth), 0, photoWidth - 1);
  const top = clamp(Math.round(part.top * photoHeight), 0, photoHeight - 1);
  let width = clamp(Math.round((part.left + part.width) * photoWidth) - left, 1, photoWidth - left);
  let height = clamp(Math.round((part.top + part.height) * photoHeight) - top, 1, photoHeight - top);
  if (keepsEqualSides(crop.shape)) {
    width = Math.min(width, height);
    height = width;
  }
  return { left, top, width, height };
}

export function circleShape(width: number, height: number): FloatImage {
  const shape = newFloatImage(width, height);
  const radius = Math.min(width, height) / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const distance = Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2);
      shape.data[y * width + x] = clamp(radius - distance + 0.5, 0, 1);
    }
  }
  return shape;
}
