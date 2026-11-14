import { FaceLandmarker, FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";
import * as ort from "onnxruntime-web/wasm";
import type { PartFinders } from "./analysis";
import type { FloatImage, RgbaImage } from "./images";
import type { ModelId } from "./models";
import { resizeRgba } from "./opencv";

const U2NET_SIZE = 320;
const MOST_FACES = 10;
const U2NET_MEAN = [0.485, 0.456, 0.406];
const U2NET_STD = [0.229, 0.224, 0.225];

export async function createPartFinders(
  modelBytes: Record<ModelId, Uint8Array>,
  mediapipeFolderUrl: string,
): Promise<PartFinders> {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const personSession = await ort.InferenceSession.create(modelBytes.person_shape, { executionProviders: ["wasm"] });

  const fileset = await FilesetResolver.forVisionTasks(mediapipeFolderUrl, true);
  const restoreModuleFactory = async () => {
    const loader = await import(/* @vite-ignore */ fileset.wasmLoaderPath);
    (self as unknown as { ModuleFactory: unknown }).ModuleFactory = loader.default;
  };
  await restoreModuleFactory();
  const faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: modelBytes.face_points, delegate: "CPU" },
    runningMode: "IMAGE",
    numFaces: MOST_FACES,
  });
  await restoreModuleFactory();
  const segmenter = await ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: modelBytes.body_parts, delegate: "CPU" },
    runningMode: "IMAGE",
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  });
  const asImageData = (image: RgbaImage) => new ImageData(image.data as ImageDataArray, image.width, image.height);

  return {
    findPerson: (image) => findPersonWithU2net(personSession, image),
    findBodyParts(image) {
      const parts: FloatImage[] = [];
      segmenter.segment(asImageData(image), (result) => {
        for (const mask of result.confidenceMasks ?? []) {
          parts.push({ width: mask.width, height: mask.height, data: mask.getAsFloat32Array().slice() });
        }
      });
      if (parts.length < 6) {
        throw new Error(`the person shape model gave ${parts.length} parts instead of 6`);
      }
      return parts;
    },
    findFaces(image) {
      const faces = faceLandmarker.detect(asImageData(image)).faceLandmarks;
      return faces.map((face) => face.map((point) => [point.x, point.y]));
    },
  };
}

async function findPersonWithU2net(session: ort.InferenceSession, image: RgbaImage): Promise<FloatImage> {
  const small = resizeRgba(image, U2NET_SIZE, U2NET_SIZE);
  const pixelCount = U2NET_SIZE * U2NET_SIZE;
  let brightest = 1e-6;
  for (let i = 0; i < pixelCount; i++) {
    for (let channel = 0; channel < 3; channel++) {
      brightest = Math.max(brightest, small.data[i * 4 + channel]);
    }
  }
  const input = new Float32Array(3 * pixelCount);
  for (let channel = 0; channel < 3; channel++) {
    for (let i = 0; i < pixelCount; i++) {
      input[channel * pixelCount + i] = (small.data[i * 4 + channel] / brightest - U2NET_MEAN[channel]) / U2NET_STD[channel];
    }
  }
  const tensor = new ort.Tensor("float32", input, [1, 3, U2NET_SIZE, U2NET_SIZE]);
  const outputs = await session.run({ [session.inputNames[0]]: tensor });
  const prediction = outputs[session.outputNames[0]].data as Float32Array;
  let lowest = Infinity;
  let highest = -Infinity;
  for (let i = 0; i < pixelCount; i++) {
    lowest = Math.min(lowest, prediction[i]);
    highest = Math.max(highest, prediction[i]);
  }
  const person = new Float32Array(pixelCount);
  const range = highest - lowest || 1;
  for (let i = 0; i < pixelCount; i++) {
    const normalized = Math.min(Math.max((prediction[i] - lowest) / range, 0), 1);
    person[i] = Math.floor(normalized * 255) / 255;
  }
  return { width: U2NET_SIZE, height: U2NET_SIZE, data: person };
}
