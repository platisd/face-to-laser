import { type ByteImage, type FloatImage } from "./images";
import { distanceOutside } from "./outlines";
import type { Settings } from "./settings";

export const SMALLEST_RING_WALL_MM = 1.5;
const STEP_PX = 0.5;

// Positions are in pixels, with the middle of pixel (x, y) at exactly (x, y).
export interface Circle {
  x: number;
  y: number;
  radius: number;
}

export interface Holder {
  disc: Circle;
  hole: Circle;
  aimFrom: [number, number];
}

export function keychainIsOn(settings: Settings): boolean {
  return settings.keychain_on && settings.cut_line_on;
}

export function holeDiameterMm(settings: Settings): number {
  const largestHoleMm = settings.keychain_diameter_mm - 2 * SMALLEST_RING_WALL_MM;
  return Math.max(0, Math.min(settings.keychain_hole_diameter_mm, largestHoleMm));
}

export function holderReachMm(settings: Settings): number {
  return keychainIsOn(settings) ? settings.keychain_diameter_mm : 0;
}

// Looks from the middle of the piece in the given direction (0 = up, clockwise)
// and puts the holder just outside the piece there. The disc overlaps the piece
// by half the ring wall, so they join well. If the hole would come too close to
// the piece somewhere else (for example in the dip between head and shoulder),
// the holder moves further out.
export function placeHolder(piece: ByteImage, angleDeg: number, discRadiusPx: number, holeRadiusPx: number): Holder | null {
  const box = boundingBox(piece);
  if (box === null) {
    return null;
  }
  const aimFrom: [number, number] = [(box.left + box.right) / 2, (box.top + box.bottom) / 2];
  const radians = (angleDeg * Math.PI) / 180;
  const stepX = Math.sin(radians);
  const stepY = -Math.cos(radians);
  const pointAt = (distance: number): [number, number] => [aimFrom[0] + stepX * distance, aimFrom[1] + stepY * distance];

  let lastPieceDistance = 0;
  for (let distance = 0; ; distance += STEP_PX) {
    const value = valueAt(piece, ...pointAt(distance));
    if (value === null) {
      break;
    }
    if (value === 1) {
      lastPieceDistance = distance;
    }
  }

  const spaceFromPiece = (discRadiusPx + holeRadiusPx) / 2;
  const distanceToPiece = distanceOutside(piece);
  let distance = lastPieceDistance + spaceFromPiece;
  for (;;) {
    const space = valueAt(distanceToPiece, ...pointAt(distance));
    if (space === null || space >= spaceFromPiece - 1) {
      break;
    }
    distance += STEP_PX;
  }
  const [x, y] = pointAt(distance);
  return { disc: { x, y, radius: discRadiusPx }, hole: { x, y, radius: holeRadiusPx }, aimFrom };
}

export function withCircle(shape: ByteImage, circle: Circle): ByteImage {
  const result = { ...shape, data: shape.data.slice() };
  forEachPixelInCircle(shape, circle, (index) => {
    result.data[index] = 1;
  });
  return result;
}

export function forEachPixelInCircle(image: { width: number; height: number }, circle: Circle, use: (index: number) => void): void {
  const top = Math.max(0, Math.ceil(circle.y - circle.radius));
  const bottom = Math.min(image.height - 1, Math.floor(circle.y + circle.radius));
  const left = Math.max(0, Math.ceil(circle.x - circle.radius));
  const right = Math.min(image.width - 1, Math.floor(circle.x + circle.radius));
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if (Math.hypot(x - circle.x, y - circle.y) <= circle.radius) {
        use(y * image.width + x);
      }
    }
  }
}

export function angleTowards(aimFrom: [number, number], point: [number, number]): number {
  const degrees = (Math.atan2(point[0] - aimFrom[0], aimFrom[1] - point[1]) * 180) / Math.PI;
  return Math.round((degrees + 360) % 360);
}

function valueAt(image: ByteImage | FloatImage, x: number, y: number): number | null {
  const column = Math.round(x);
  const row = Math.round(y);
  if (column < 0 || row < 0 || column >= image.width || row >= image.height) {
    return null;
  }
  return image.data[row * image.width + column];
}

function boundingBox(shape: ByteImage): { left: number; right: number; top: number; bottom: number } | null {
  let left = shape.width;
  let right = -1;
  let top = shape.height;
  let bottom = -1;
  for (let y = 0; y < shape.height; y++) {
    for (let x = 0; x < shape.width; x++) {
      if (shape.data[y * shape.width + x] === 1) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return right < 0 ? null : { left, right, top, bottom };
}
