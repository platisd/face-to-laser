import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import { grayPng } from "../../src/exportFiles";

async function madeUpPhoto(): Promise<Buffer> {
  const size = 300;
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const isHead = Math.hypot(x - 150, y - 110) < 70;
      const isBody = y > 170 && Math.abs(x - 150) < 110 - (300 - y) * 0.3;
      data[y * size + x] = isHead || isBody ? (x + y) % 7 === 0 ? 255 : 0 : 255;
    }
  }
  return Buffer.from(await grayPng({ width: size, height: size, data }, 10000, false));
}

test("photo to laser files", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Face to laser" })).toBeVisible();

  const ditherMethod = page.locator('.control[data-path="dither_method"]');
  await expect(ditherMethod.locator("select")).toBeEnabled();
  await page.getByRole("radio", { name: "stencil" }).check();
  await expect(ditherMethod).toHaveClass(/not-in-use/);
  await expect(ditherMethod.locator("select")).toBeDisabled();

  await page.reload();
  await expect(page.getByRole("radio", { name: "stencil" })).toBeChecked();
  await page.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(page.getByRole("radio", { name: "photo" })).toBeChecked();

  await page.locator("#load-input").setInputFiles("tests/files/python_settings.json");
  await expect(page.locator('.control[data-path="width_mm"] input[type=number]')).toHaveValue("123");

  await page.locator("#photo-input").setInputFiles({ name: "made-up.png", mimeType: "image/png", buffer: await madeUpPhoto() });
  await expect(page.locator("#status")).toContainText("Whole area: 123.0 ×", { timeout: 120000 });
  await expect(page.locator("#preview")).toBeVisible();

  await page.locator("#file-name").fill("test face");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export laser files" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^testface_\d{8}-\d{6}\.zip$/);
  const zip = await JSZip.loadAsync(readFileSync(await download.path()));
  expect(Object.keys(zip.files).sort()).toEqual(
    ["testface_combined.svg", "testface_cut.dxf", "testface_cut.svg", "testface_engrave.png", "testface_settings.json"],
  );
});

test("crop the photo with a circle", async ({ page }) => {
  await page.goto("./");
  await page.locator("#photo-input").setInputFiles({ name: "made-up.png", mimeType: "image/png", buffer: await madeUpPhoto() });
  await expect(page.locator("#status")).toContainText("Whole area:", { timeout: 120000 });
  const applyButton = page.getByRole("button", { name: "Apply crop" });
  await expect(applyButton).toBeDisabled();

  await page.getByRole("radio", { name: "Circle" }).check();
  const stage = page.locator("#crop-canvas");
  await expect(stage).toBeVisible();
  await expect(applyButton).toBeEnabled();

  const area = (await stage.boundingBox())!;
  const middle = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.wheel(0, -200);
  await page.getByRole("button", { name: "Fit" }).click();
  const frameSide = Math.min(area.width, area.height) * 0.8;
  const corner = { x: middle.x + frameSide / 2, y: middle.y + frameSide / 2 };
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x - 40, corner.y - 40, { steps: 5 });
  await page.mouse.up();

  await applyButton.click();
  await expect(applyButton).toBeDisabled();
  await expect(page.locator("#export-button")).toBeDisabled();
  await expect(page.locator("#status")).toContainText("Cut piece:", { timeout: 120000 });
  await expect(page.locator("#export-button")).toBeEnabled();

  await page.getByRole("radio", { name: "No crop" }).check();
  await expect(stage).toBeHidden();
  await expect(applyButton).toBeEnabled();
});

test("add a keychain holder and place it by clicking the preview", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Reset to defaults" }).click();
  await page.locator("#photo-input").setInputFiles({ name: "made-up.png", mimeType: "image/png", buffer: await madeUpPhoto() });
  await expect(page.locator("#status")).toContainText("Cut piece:", { timeout: 120000 });
  const pieceText = async () => (await page.locator("#status").textContent())!.match(/Cut piece: ([\d.]+) × ([\d.]+)/)!;
  const heightWithout = Number((await pieceText())[2]);

  await page.locator("summary", { hasText: "Keychain" }).click();
  const angle = page.locator('.control[data-path="keychain_angle_deg"] input[type=number]');
  await expect(angle).toBeDisabled();
  await page.getByRole("checkbox", { name: "Keychain holder" }).check();
  await expect(angle).toBeEnabled();
  await expect.poll(async () => Number((await pieceText())[2]), { timeout: 60000 }).toBeGreaterThan(heightWithout + 5);

  const preview = (await page.locator("#preview").boundingBox())!;
  await page.mouse.click(preview.x + preview.width - 5, preview.y + preview.height * 0.55);
  await expect.poll(async () => Number(await angle.inputValue())).toBeGreaterThan(60);
  expect(Number(await angle.inputValue())).toBeLessThan(120);

  await page.getByRole("checkbox", { name: "Cut line", exact: true }).uncheck();
  await expect(angle).toBeDisabled();
});
