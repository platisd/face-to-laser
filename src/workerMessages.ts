import type { Crop } from "./crop";
import type { PieceSize } from "./laserJob";
import type { DownloadProgress } from "./models";
import type { PreviewMode, RgbaPicture } from "./preview";
import type { Settings } from "./settings";

export type MessageToWorker =
  | { kind: "loadModels" }
  | { kind: "photo"; photo: Blob; crop: Crop | null }
  | { kind: "preview"; requestId: number; settings: Settings; mode: PreviewMode; woodColors: boolean }
  | { kind: "export"; requestId: number; settings: Settings; name: string };

export interface PreviewResult {
  picture: RgbaPicture;
  widthMm: number;
  heightMm: number;
  widthDots: number;
  heightDots: number;
  dotsPerMm: number;
  piece: PieceSize | null;
  hasCutLine: boolean;
  holderAimFrom: [number, number] | null;
  message: string;
}

export type MessageFromWorker =
  | { kind: "modelProgress"; progress: DownloadProgress }
  | { kind: "modelsReady" }
  | { kind: "modelsFailed"; error: string }
  | { kind: "analysisStarted" }
  | { kind: "analysisDone"; message: string }
  | { kind: "analysisFailed"; error: string }
  | { kind: "preview"; requestId: number; result: PreviewResult | null }
  | { kind: "exported"; requestId: number; zip: Uint8Array }
  | { kind: "requestFailed"; requestId: number; error: string };
