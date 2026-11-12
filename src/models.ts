export type ModelId = "person_shape" | "face_points" | "body_parts";

export interface ModelFile {
  id: ModelId;
  name: string;
  url: string;
  sizeBytes: number;
}

export const MODEL_FILES: ModelFile[] = [
  {
    id: "person_shape",
    name: "Background removal (U²-Net)",
    url: "https://huggingface.co/BritishWerewolf/U-2-Net/resolve/c08042b462485d8597c89d3ce831d00be8582c5c/onnx/model.onnx",
    sizeBytes: 175997641,
  },
  {
    id: "face_points",
    name: "Face points (MediaPipe face landmarker)",
    url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    sizeBytes: 3758596,
  },
  {
    id: "body_parts",
    name: "Face areas (MediaPipe selfie multiclass)",
    url: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite",
    sizeBytes: 16371837,
  },
];

export type DownloadState = "waiting" | "loading" | "ready" | "failed";

export interface DownloadProgress {
  id: ModelId;
  name: string;
  loadedBytes: number;
  totalBytes: number;
  fromCache: boolean;
  state: DownloadState;
  error?: string;
}

const CACHE_NAME = "face-to-laser-models-v1";

async function openModelCache(): Promise<Cache | null> {
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

export async function loadModelFile(file: ModelFile, report: (progress: DownloadProgress) => void): Promise<Uint8Array> {
  const progress: DownloadProgress = {
    id: file.id,
    name: file.name,
    loadedBytes: 0,
    totalBytes: file.sizeBytes,
    fromCache: false,
    state: "loading",
  };
  report({ ...progress });
  try {
    const cache = await openModelCache();
    const cached = await cache?.match(file.url);
    if (cached) {
      const bytes = new Uint8Array(await cached.arrayBuffer());
      report({ ...progress, fromCache: true, loadedBytes: bytes.length, totalBytes: bytes.length, state: "ready" });
      return bytes;
    }
    const response = await fetch(file.url);
    if (!response.ok || response.body === null) {
      throw new Error(`the server answered ${response.status}`);
    }
    const totalBytes = Number(response.headers.get("content-length")) || file.sizeBytes;
    let bytes = new Uint8Array(totalBytes);
    let loadedBytes = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (loadedBytes + value.length > bytes.length) {
        const bigger = new Uint8Array(Math.max(bytes.length * 2, loadedBytes + value.length));
        bigger.set(bytes.subarray(0, loadedBytes));
        bytes = bigger;
      }
      bytes.set(value, loadedBytes);
      loadedBytes += value.length;
      report({ ...progress, loadedBytes, totalBytes });
    }
    bytes = bytes.subarray(0, loadedBytes);
    await cache?.put(file.url, new Response(bytes)).catch(() => undefined);
    report({ ...progress, loadedBytes, totalBytes, state: "ready" });
    return bytes;
  } catch (error) {
    report({ ...progress, state: "failed", error: errorText(error) });
    throw error;
  }
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
