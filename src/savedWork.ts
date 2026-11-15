import JSZip from "jszip";
import { type Box, CROP_CHOICES, type Crop, type CropShape } from "./crop";
import { type Settings, settingsFromJson } from "./settings";

export interface SavedWork {
  settings: Settings;
  crop: Crop | null;
  fileName: string;
}

export interface LoadedWork {
  settings: Settings;
  crop?: Crop | null;
  fileName?: string;
  photo?: File;
}

const PHOTO_ENDINGS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/tiff": "tiff",
};
const PHOTO_IN_ZIP = /_photo\.([a-z0-9]+)$/i;
const SETTINGS_IN_ZIP = /_settings\.json$/i;

export function savedWorkToJson(work: SavedWork): string {
  const crop =
    work.crop === null ? null : { shape: work.crop.shape, box_as_part_of_photo: work.crop.boxAsPartOfPhoto };
  return JSON.stringify({ ...work.settings, crop, file_name: work.fileName }, null, 2);
}

export function savedWorkFromJson(text: string): LoadedWork {
  const settings = settingsFromJson(text);
  const loaded = JSON.parse(text) as Record<string, unknown>;
  const work: LoadedWork = { settings };
  if (typeof loaded.file_name === "string") {
    work.fileName = loaded.file_name;
  }
  if (loaded.crop === null) {
    work.crop = null;
  } else {
    const crop = readCrop(loaded.crop);
    if (crop !== null) {
      work.crop = crop;
    }
  }
  return work;
}

export async function savedWorkFromZip(zipFile: Blob): Promise<LoadedWork> {
  const zip = await JSZip.loadAsync(zipFile);
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  const settingsName = names.find((name) => SETTINGS_IN_ZIP.test(name)) ?? names.find((name) => name.endsWith(".json"));
  if (settingsName === undefined) {
    throw new Error("the .zip file has no settings file");
  }
  const work = savedWorkFromJson(await zip.file(settingsName)!.async("string"));
  const photoName = names.find((name) => PHOTO_IN_ZIP.test(name));
  if (photoName !== undefined) {
    const ending = photoName.match(PHOTO_IN_ZIP)![1].toLowerCase();
    const bytes = await zip.file(photoName)!.async("uint8array");
    work.photo = new File([bytes as BlobPart], photoName.split("/").pop()!, { type: photoTypeFor(ending) });
  }
  return work;
}

export function photoFileName(name: string, photo: Blob): string {
  return `${name}_photo.${photoEndingFor(photo)}`;
}

function photoEndingFor(photo: Blob): string {
  const known = PHOTO_ENDINGS[photo.type];
  if (known !== undefined) {
    return known;
  }
  const fromName = photo instanceof File ? photo.name.match(/\.([a-z0-9]+)$/i)?.[1] : undefined;
  return (fromName ?? photo.type.replace(/^image\//, "").replace(/[^a-z0-9]/gi, "")) || "img";
}

function photoTypeFor(ending: string): string {
  const known = Object.entries(PHOTO_ENDINGS).find(([, knownEnding]) => knownEnding === ending);
  if (known !== undefined) {
    return known[0];
  }
  return ending === "jpeg" ? "image/jpeg" : `image/${ending}`;
}

function readCrop(value: unknown): Crop | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { shape, box_as_part_of_photo: box } = value as Record<string, unknown>;
  if (!isCropShape(shape) || !isPartOfPhoto(box)) {
    return null;
  }
  return { shape, boxAsPartOfPhoto: { left: box.left, top: box.top, width: box.width, height: box.height } };
}

function isCropShape(value: unknown): value is CropShape {
  return value !== "none" && (CROP_CHOICES as readonly unknown[]).includes(value);
}

function isPartOfPhoto(value: unknown): value is Box {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { left, top, width, height } = value as Record<string, unknown>;
  const numbers = [left, top, width, height];
  if (!numbers.every((number) => typeof number === "number" && Number.isFinite(number))) {
    return false;
  }
  const [l, t, w, h] = numbers as number[];
  const slack = 1e-6;
  return l >= 0 && t >= 0 && w > 0 && h > 0 && l + w <= 1 + slack && t + h <= 1 + slack;
}
