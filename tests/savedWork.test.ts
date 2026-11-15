import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { Crop } from "../src/crop";
import { photoFileName, savedWorkFromJson, savedWorkFromZip, savedWorkToJson } from "../src/savedWork";
import { defaultSettings } from "../src/settings";

const circleCrop: Crop = { shape: "circle", boxAsPartOfPhoto: { left: 0.1, top: 0.2, width: 0.5, height: 0.4 } };

describe("saved work", () => {
  it("survives save and load with the crop and the file name", () => {
    const settings = { ...defaultSettings(), width_mm: 80 };
    const loaded = savedWorkFromJson(savedWorkToJson({ settings, crop: circleCrop, fileName: "anna" }));
    expect(loaded).toEqual({ settings, crop: circleCrop, fileName: "anna" });
  });

  it("keeps 'no crop' apart from a file that says nothing about the crop", () => {
    const settings = defaultSettings();
    expect(savedWorkFromJson(savedWorkToJson({ settings, crop: null, fileName: "x" })).crop).toBeNull();
    expect("crop" in savedWorkFromJson('{"width_mm": 70}')).toBe(false);
  });

  it("skips a crop that does not make sense", () => {
    const bad = [
      { shape: "star", box_as_part_of_photo: { left: 0, top: 0, width: 0.5, height: 0.5 } },
      { shape: "none", box_as_part_of_photo: { left: 0, top: 0, width: 0.5, height: 0.5 } },
      { shape: "square", box_as_part_of_photo: { left: 0.8, top: 0, width: 0.5, height: 0.5 } },
      { shape: "square", box_as_part_of_photo: { left: 0, top: 0, width: 0, height: 0.5 } },
      { shape: "square", box_as_part_of_photo: { left: "0", top: 0, width: 0.5, height: 0.5 } },
      { shape: "square" },
    ];
    for (const crop of bad) {
      expect("crop" in savedWorkFromJson(JSON.stringify({ crop }))).toBe(false);
    }
  });

  it("names the photo after its type", () => {
    expect(photoFileName("face", new Blob([], { type: "image/jpeg" }))).toBe("face_photo.jpg");
    expect(photoFileName("face", new File([], "me.JFIF", { type: "" }))).toBe("face_photo.JFIF");
    expect(photoFileName("face", new Blob([], { type: "" }))).toBe("face_photo.img");
  });

  it("reads the settings and the photo back from an exported zip", async () => {
    const settings = { ...defaultSettings(), look: "stencil" as const };
    const zip = new JSZip();
    zip.file("anna_engrave.png", new Uint8Array([1]));
    zip.file("anna_settings.json", savedWorkToJson({ settings, crop: circleCrop, fileName: "anna" }));
    zip.file("anna_photo.jpg", new Uint8Array([9, 8, 7]));
    const loaded = await savedWorkFromZip(new Blob([await zip.generateAsync({ type: "uint8array" }) as BlobPart]));
    expect(loaded.settings).toEqual(settings);
    expect(loaded.crop).toEqual(circleCrop);
    expect(loaded.fileName).toBe("anna");
    expect(loaded.photo!.type).toBe("image/jpeg");
    expect(new Uint8Array(await loaded.photo!.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7]));
  });

  it("refuses a zip without settings", async () => {
    const zip = new JSZip();
    zip.file("anna_photo.jpg", new Uint8Array([1]));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await expect(savedWorkFromZip(new Blob([bytes as BlobPart]))).rejects.toThrow("no settings file");
  });
});
