import type { RgbaPicture } from "./preview";

export interface RulerColors {
  background: string;
  lines: string;
  text: string;
}

export function rulerStepsMm(longestSideMm: number): { labelStepMm: number; tickStepMm: number } {
  if (longestSideMm <= 200) {
    return { labelStepMm: 10, tickStepMm: 5 };
  }
  if (longestSideMm <= 400) {
    return { labelStepMm: 20, tickStepMm: 10 };
  }
  return { labelStepMm: 50, tickStepMm: 10 };
}

export function rulerSizeFor(picture: { width: number; height: number }): number {
  return Math.max(24, Math.round(Math.max(picture.width, picture.height) / 22));
}

export function drawPictureWithRulers(
  canvas: HTMLCanvasElement,
  picture: RgbaPicture,
  dotsPerMm: number,
  colors: RulerColors,
): void {
  const rulerSize = rulerSizeFor(picture);
  const spaceForLastLabel = Math.round(rulerSize * 0.8);
  canvas.width = picture.width + rulerSize + spaceForLastLabel;
  canvas.height = picture.height + rulerSize + spaceForLastLabel;
  const context = canvas.getContext("2d")!;
  context.fillStyle = colors.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.putImageData(new ImageData(picture.data as ImageDataArray, picture.width, picture.height), rulerSize, rulerSize);

  const widthMm = picture.width / dotsPerMm;
  const heightMm = picture.height / dotsPerMm;
  const { labelStepMm, tickStepMm } = rulerStepsMm(Math.max(widthMm, heightMm));
  const longTick = rulerSize * 0.4;
  const shortTick = rulerSize * 0.2;
  const lineWidth = Math.max(1, rulerSize / 24);

  context.strokeStyle = colors.lines;
  context.fillStyle = colors.text;
  context.lineWidth = lineWidth;
  context.font = `${Math.round(rulerSize * 0.42)}px system-ui, sans-serif`;

  context.beginPath();
  context.moveTo(rulerSize, rulerSize - lineWidth / 2);
  context.lineTo(rulerSize + picture.width, rulerSize - lineWidth / 2);
  context.moveTo(rulerSize - lineWidth / 2, rulerSize);
  context.lineTo(rulerSize - lineWidth / 2, rulerSize + picture.height);
  for (let mm = 0; mm <= widthMm + 1e-9; mm += tickStepMm) {
    const x = rulerSize + mm * dotsPerMm;
    const tick = mm % labelStepMm === 0 ? longTick : shortTick;
    context.moveTo(x, rulerSize);
    context.lineTo(x, rulerSize - tick);
  }
  for (let mm = 0; mm <= heightMm + 1e-9; mm += tickStepMm) {
    const y = rulerSize + mm * dotsPerMm;
    const tick = mm % labelStepMm === 0 ? longTick : shortTick;
    context.moveTo(rulerSize, y);
    context.lineTo(rulerSize - tick, y);
  }
  context.stroke();

  context.textBaseline = "alphabetic";
  context.textAlign = "center";
  for (let mm = labelStepMm; mm <= widthMm + 1e-9; mm += labelStepMm) {
    context.fillText(String(mm), rulerSize + mm * dotsPerMm, rulerSize - longTick - rulerSize * 0.08);
  }
  for (let mm = labelStepMm; mm <= heightMm + 1e-9; mm += labelStepMm) {
    context.save();
    context.translate(rulerSize - longTick - rulerSize * 0.08, rulerSize + mm * dotsPerMm);
    context.rotate(-Math.PI / 2);
    context.fillText(String(mm), 0, 0);
    context.restore();
  }
  context.textAlign = "left";
  context.textBaseline = "top";
  context.fillText("mm", rulerSize * 0.12, rulerSize * 0.12);
}
