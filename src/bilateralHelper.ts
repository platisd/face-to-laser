import { type BilateralSetup, bilateralOnPaddedRows } from "./bilateral";

export interface BilateralTask {
  padded: Float32Array;
  width: number;
  rowCount: number;
  setup: BilateralSetup;
}

self.onmessage = (event: MessageEvent<BilateralTask>) => {
  const { padded, width, rowCount, setup } = event.data;
  const result = bilateralOnPaddedRows(padded, width, rowCount, setup);
  self.postMessage(result, { transfer: [result.buffer] });
};
