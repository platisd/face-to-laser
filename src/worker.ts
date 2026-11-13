import { type PartFinders, analyzePhoto } from "./analysis";
import { type Crop, cropBoxInPixels, hideOutsideCircle } from "./crop";
import { makeLaserFiles, zipFiles } from "./exportFiles";
import type { FloatImage, RgbaImage } from "./images";
import { type BilateralPool, createBilateralPool } from "./bilateralPool";
import { EDGE_KEEPING_COLOR_REACH, EDGE_KEEPING_PASSES, SMOOTHING_REACH_MM } from "./imageSteps";
import { type LaserJob, type LaserJobCache, type PhotoAnalysis, makeLaserJob, pieceSize, prepareLaserJobCache } from "./laserJob";
import { MODEL_FILES, type ModelId, errorText, loadModelFile } from "./models";
import { createPartFinders } from "./partFinders";
import { loadOpenCv } from "./opencv";
import { makePreview } from "./preview";
import type { Settings } from "./settings";
import type { MessageFromWorker, MessageToWorker } from "./workerMessages";

const LARGEST_PHOTO_SIDE = 4500;
const MEDIAPIPE_FOLDER_URL = new URL(`${import.meta.env.BASE_URL}mediapipe`, self.location.origin).href;

let partFinders: Promise<PartFinders> | null = null;
let analysis: Promise<PhotoAnalysis | null> = Promise.resolve(null);
let lastJob: { analysis: PhotoAnalysis; settingsJson: string; job: LaserJob } | null = null;
let bilateralPool: BilateralPool | null = null;
let jobCache: { analysis: PhotoAnalysis; cache: LaserJobCache } | null = null;

function send(message: MessageFromWorker, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer });
}

function loadModels(): Promise<PartFinders> {
  const loading = (async () => {
    const bytes = await Promise.all(
      MODEL_FILES.map((file) => loadModelFile(file, (progress) => send({ kind: "modelProgress", progress }))),
    );
    const byId = Object.fromEntries(MODEL_FILES.map((file, index) => [file.id, bytes[index]])) as Record<
      ModelId,
      Uint8Array
    >;
    await loadOpenCv();
    return createPartFinders(byId, MEDIAPIPE_FOLDER_URL);
  })();
  loading.then(
    () => send({ kind: "modelsReady" }),
    (error) => {
      partFinders = null;
      send({ kind: "modelsFailed", error: errorText(error) });
    },
  );
  return loading;
}

async function readPhoto(photo: Blob, crop: Crop | null): Promise<RgbaImage> {
  const whole = await createImageBitmap(photo, { imageOrientation: "from-image", premultiplyAlpha: "none" });
  const box = crop === null ? { left: 0, top: 0, width: whole.width, height: whole.height } : cropBoxInPixels(crop, whole.width, whole.height);
  const scale = Math.min(1, LARGEST_PHOTO_SIDE / Math.max(box.width, box.height));
  const bitmap = await createImageBitmap(whole, box.left, box.top, box.width, box.height, {
    resizeWidth: Math.max(1, Math.round(box.width * scale)),
    resizeHeight: Math.max(1, Math.round(box.height * scale)),
    resizeQuality: "high",
    premultiplyAlpha: "none",
  });
  whole.close();
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d")!;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const image = { width: pixels.width, height: pixels.height, data: pixels.data };
  if (crop?.shape === "circle") {
    hideOutsideCircle(image);
  }
  return image;
}

async function analyze(photo: Blob, crop: Crop | null): Promise<PhotoAnalysis | null> {
  try {
    const pixels = await readPhoto(photo, crop);
    partFinders ??= loadModels();
    const finders = await partFinders;
    send({ kind: "analysisStarted" });
    const result = await analyzePhoto(pixels, finders);
    send({ kind: "analysisDone", message: result.message });
    return result;
  } catch (error) {
    send({ kind: "analysisFailed", error: errorText(error) });
    return null;
  }
}

async function laserJobFor(photo: PhotoAnalysis, settings: Settings): Promise<LaserJob> {
  const settingsJson = JSON.stringify(settings);
  if (lastJob?.analysis !== photo || lastJob.settingsJson !== settingsJson) {
    if (jobCache?.analysis !== photo) {
      jobCache = { analysis: photo, cache: {} };
    }
    const { cache } = jobCache;
    prepareLaserJobCache(photo, settings, cache);
    if (cache.smoothGray === undefined) {
      cache.smoothGray = await edgeKeepingBlurInParallel(cache.evenedGray!, settings.dots_per_mm);
    }
    lastJob = { analysis: photo, settingsJson, job: makeLaserJob(photo, settings, cache) };
  }
  return lastJob.job;
}

async function edgeKeepingBlurInParallel(gray: FloatImage, dotsPerMm: number): Promise<FloatImage> {
  bilateralPool ??= createBilateralPool();
  let current = gray;
  for (let pass = 0; pass < EDGE_KEEPING_PASSES; pass++) {
    current = await bilateralPool.filter(current, EDGE_KEEPING_COLOR_REACH, SMOOTHING_REACH_MM * dotsPerMm);
  }
  return current;
}

async function handle(message: MessageToWorker): Promise<void> {
  if (message.kind === "loadModels") {
    partFinders ??= loadModels();
    return;
  }
  if (message.kind === "photo") {
    lastJob = null;
    jobCache = null;
    analysis = analyze(message.photo, message.crop);
    return;
  }
  try {
    const photo = await analysis;
    if (message.kind === "preview") {
      if (photo === null) {
        send({ kind: "preview", requestId: message.requestId, result: null });
        return;
      }
      const job = await laserJobFor(photo, message.settings);
      const picture = makePreview(job, message.mode, message.woodColors);
      const result = {
        picture,
        widthMm: job.widthMm,
        heightMm: job.heightMm,
        widthDots: job.engrave.width,
        heightDots: job.engrave.height,
        dotsPerMm: job.dotsPerMm,
        piece: pieceSize(job),
        hasCutLine: job.cutLineMm !== null,
        holderAimFrom: job.holderAimFromPx,
        message: photo.message,
      };
      send({ kind: "preview", requestId: message.requestId, result }, [picture.data.buffer]);
    } else {
      if (photo === null) {
        throw new Error("Upload a photo first.");
      }
      const job = await laserJobFor(photo, message.settings);
      const zip = await zipFiles(await makeLaserFiles(job, message.settings, message.name));
      send({ kind: "exported", requestId: message.requestId, zip }, [zip.buffer]);
    }
  } catch (error) {
    send({ kind: "requestFailed", requestId: message.requestId, error: errorText(error) });
  }
}

let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<MessageToWorker>) => {
  queue = queue.then(() => handle(event.data));
};
