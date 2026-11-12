import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import { blackAndWhitePng } from "../../src/exportFiles";

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
  return Buffer.from(await blackAndWhitePng({ width: size, height: size, data }, 10000));
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
