import { type FloatImage, roundLikePython } from "./images";

const LOOKUP_STEPS = 1 << 12;

export interface BilateralSetup {
  radius: number;
  spaceWeights: Float32Array;
  rowOffsets: Int32Array;
  columnOffsets: Int32Array;
  closenessByDifference: Float32Array;
  stepsPerUnit: number;
}

export function bilateralSetup(
  lowestValue: number,
  highestValue: number,
  sigmaColor: number,
  sigmaSpace: number,
): BilateralSetup | null {
  if (Math.abs(highestValue - lowestValue) < 1.1920929e-7) {
    return null;
  }
  const radius = roundLikePython(sigmaSpace * 1.5);
  const colorFactor = -0.5 / (sigmaColor * sigmaColor);
  const spaceFactor = -0.5 / (sigmaSpace * sigmaSpace);
  const stepsPerUnit = LOOKUP_STEPS / (highestValue - lowestValue);

  const closenessByDifference = new Float32Array(LOOKUP_STEPS + 2);
  let previous = 1;
  for (let step = 0; step < closenessByDifference.length; step++) {
    if (previous > 0) {
      const difference = step / stepsPerUnit;
      closenessByDifference[step] = Math.exp(difference * difference * colorFactor);
      previous = closenessByDifference[step];
    }
  }

  const weights: number[] = [];
  const rows: number[] = [];
  const columns: number[] = [];
  for (let row = -radius; row <= radius; row++) {
    for (let column = -radius; column <= radius; column++) {
      const distance = Math.sqrt(row * row + column * column);
      if (distance > radius) {
        continue;
      }
      weights.push(Math.fround(Math.exp(distance * distance * spaceFactor)));
      rows.push(row);
      columns.push(column);
    }
  }
  return {
    radius,
    spaceWeights: Float32Array.from(weights),
    rowOffsets: Int32Array.from(rows),
    columnOffsets: Int32Array.from(columns),
    closenessByDifference,
    stepsPerUnit,
  };
}

function reflect(index: number, size: number): number {
  if (size === 1) {
    return 0;
  }
  while (index < 0 || index >= size) {
    index = index < 0 ? -index : 2 * size - 2 - index;
  }
  return index;
}

export function paddedRows(image: FloatImage, firstRow: number, endRow: number, radius: number): Float32Array {
  const paddedWidth = image.width + 2 * radius;
  const padded = new Float32Array((endRow - firstRow + 2 * radius) * paddedWidth);
  for (let y = firstRow - radius; y < endRow + radius; y++) {
    const sourceRow = reflect(y, image.height) * image.width;
    const targetRow = (y - firstRow + radius) * paddedWidth;
    for (let x = -radius; x < image.width + radius; x++) {
      padded[targetRow + x + radius] = image.data[sourceRow + reflect(x, image.width)];
    }
  }
  return padded;
}

export function bilateralOnPaddedRows(
  padded: Float32Array,
  width: number,
  rowCount: number,
  setup: BilateralSetup,
): Float32Array {
  const { radius, spaceWeights, closenessByDifference, stepsPerUnit } = setup;
  const paddedWidth = width + 2 * radius;
  const offsets = Int32Array.from(setup.rowOffsets, (row, k) => row * paddedWidth + setup.columnOffsets[k]);
  const neighbourCount = offsets.length;
  const result = new Float32Array(width * rowCount);
  for (let y = 0; y < rowCount; y++) {
    const rowStart = (y + radius) * paddedWidth + radius;
    for (let x = 0; x < width; x++) {
      const center = rowStart + x;
      const centerValue = padded[center];
      let weightedSum = 0;
      let weightSum = 0;
      for (let k = 0; k < neighbourCount; k++) {
        const value = padded[center + offsets[k]];
        let position = Math.abs(value - centerValue) * stepsPerUnit;
        const step = position | 0;
        position -= step;
        const closeness =
          closenessByDifference[step] + position * (closenessByDifference[step + 1] - closenessByDifference[step]);
        const weight = spaceWeights[k] * closeness;
        weightedSum += value * weight;
        weightSum += weight;
      }
      result[y * width + x] = weightedSum / weightSum;
    }
  }
  return result;
}

export function valueRange(image: FloatImage): [number, number] {
  let lowest = Infinity;
  let highest = -Infinity;
  for (const value of image.data) {
    if (value < lowest) {
      lowest = value;
    }
    if (value > highest) {
      highest = value;
    }
  }
  return [lowest, highest];
}

export function bilateralFilter(image: FloatImage, sigmaColor: number, sigmaSpace: number): FloatImage {
  const setup = bilateralSetup(...valueRange(image), sigmaColor, sigmaSpace);
  if (setup === null) {
    return { width: image.width, height: image.height, data: image.data.slice() };
  }
  const padded = paddedRows(image, 0, image.height, setup.radius);
  return { width: image.width, height: image.height, data: bilateralOnPaddedRows(padded, image.width, image.height, setup) };
}
