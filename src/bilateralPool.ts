import { bilateralFilter, bilateralSetup, paddedRows, valueRange } from "./bilateral";
import type { BilateralTask } from "./bilateralHelper";
import type { FloatImage } from "./images";

const MOST_HELPERS = 8;

export interface BilateralPool {
  filter(image: FloatImage, sigmaColor: number, sigmaSpace: number): Promise<FloatImage>;
}

export function createBilateralPool(): BilateralPool {
  const helperCount = Math.min(MOST_HELPERS, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));
  let helpers: Worker[] = [];
  try {
    helpers = Array.from(
      { length: helperCount },
      () => new Worker(new URL("./bilateralHelper.ts", import.meta.url), { type: "module" }),
    );
  } catch {
    helpers = [];
  }

  return {
    async filter(image, sigmaColor, sigmaSpace) {
      const setup = bilateralSetup(...valueRange(image), sigmaColor, sigmaSpace);
      if (helpers.length === 0 || setup === null) {
        return bilateralFilter(image, sigmaColor, sigmaSpace);
      }
      const rowsPerHelper = Math.ceil(image.height / helpers.length);
      const strips = helpers.map((helper, index) => {
        const firstRow = Math.min(image.height, index * rowsPerHelper);
        const endRow = Math.min(image.height, firstRow + rowsPerHelper);
        const task: BilateralTask = {
          padded: paddedRows(image, firstRow, endRow, setup.radius),
          width: image.width,
          rowCount: endRow - firstRow,
          setup,
        };
        return runOnHelper(helper, task).then((rows) => ({ firstRow, rows }));
      });
      const result: FloatImage = { width: image.width, height: image.height, data: new Float32Array(image.data.length) };
      for (const { firstRow, rows } of await Promise.all(strips)) {
        result.data.set(rows, firstRow * image.width);
      }
      return result;
    },
  };
}

function runOnHelper(helper: Worker, task: BilateralTask): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    helper.onmessage = (event: MessageEvent<Float32Array>) => resolve(event.data);
    helper.onerror = (event) => reject(new Error(event.message || "a helper stopped working"));
    helper.postMessage(task, { transfer: [task.padded.buffer] });
  });
}
