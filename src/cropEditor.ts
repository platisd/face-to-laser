import {
  type Box,
  CROP_CHOICES,
  type Crop,
  type CropChoice,
  type Point,
  asPartOfPhoto,
  boxForShape,
  keepsEqualSides,
  movedBox,
  resizedBox,
} from "./crop";
import { clamp } from "./images";

const CHOICE_NAMES: Record<CropChoice, string> = {
  none: "No crop",
  circle: "Circle",
  rectangle: "Rectangle",
  square: "Square",
};
const CORNER_REACH_PX = 12;
const HANDLE_SIZE_PX = 9;
const SMALLEST_FRAME_PX = 24;
const ZOOM_STEP = 1.25;
const MOST_ZOOM = 20;

type Drag =
  | { kind: "moveFrame"; startPointer: Point; startBox: Box }
  | { kind: "resizeFrame"; fixedCorner: Point }
  | { kind: "movePhoto"; startPointer: Point; startView: View };

interface View {
  scale: number;
  x: number;
  y: number;
}

export interface CropEditor {
  showPhoto(url: string): void;
}

function find<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export function startCropEditor(useCrop: (crop: Crop | null) => void): CropEditor {
  const panel = find<HTMLElement>("crop-panel");
  const stage = find<HTMLDivElement>("crop-stage");
  const canvas = find<HTMLCanvasElement>("crop-canvas");
  const zoomButtons = find<HTMLDivElement>("crop-zoom-buttons");
  const help = find<HTMLParagraphElement>("crop-help");
  const applyButton = find<HTMLButtonElement>("crop-apply-button");
  const context = canvas.getContext("2d")!;
  const photo = new Image();

  let choice: CropChoice = "none";
  let box: Box | null = null;
  let appliedCrop = "null";
  let view: View = { scale: 1, x: 0, y: 0 };
  let viewNeedsFit = true;
  let drag: Drag | null = null;

  const radios = buildChoices(find<HTMLDivElement>("crop-shapes"), (chosen) => {
    choice = chosen;
    if (chosen !== "none") {
      box = boxForShape(box, chosen, photo.naturalWidth, photo.naturalHeight);
    }
    showParts();
  });

  function currentCrop(): Crop | null {
    if (choice === "none" || box === null) {
      return null;
    }
    return { shape: choice, boxAsPartOfPhoto: asPartOfPhoto(box, photo.naturalWidth, photo.naturalHeight) };
  }

  function showParts(): void {
    const hasFrame = choice !== "none" && photo.complete && photo.naturalWidth > 0;
    stage.hidden = !hasFrame;
    zoomButtons.hidden = !hasFrame;
    help.hidden = !hasFrame;
    applyButton.disabled = JSON.stringify(currentCrop()) === appliedCrop;
    draw();
  }

  function canvasSize(): { width: number; height: number } {
    return { width: stage.clientWidth, height: stage.clientHeight };
  }

  function fitScale(): number {
    const { width, height } = canvasSize();
    return Math.min(width / photo.naturalWidth, height / photo.naturalHeight);
  }

  function keepPhotoInView(): void {
    const { width, height } = canvasSize();
    const shownWidth = photo.naturalWidth * view.scale;
    const shownHeight = photo.naturalHeight * view.scale;
    view.x = shownWidth <= width ? (width - shownWidth) / 2 : clamp(view.x, width - shownWidth, 0);
    view.y = shownHeight <= height ? (height - shownHeight) / 2 : clamp(view.y, height - shownHeight, 0);
  }

  function showWholePhoto(): void {
    view = { scale: fitScale(), x: 0, y: 0 };
    keepPhotoInView();
    draw();
  }

  function zoomAround(factor: number, [screenX, screenY]: Point): void {
    const [photoX, photoY] = toPhoto([screenX, screenY]);
    const leastScale = fitScale();
    view.scale = clamp(view.scale * factor, leastScale, leastScale * MOST_ZOOM);
    view.x = screenX - photoX * view.scale;
    view.y = screenY - photoY * view.scale;
    keepPhotoInView();
    draw();
  }

  function toPhoto([x, y]: Point): Point {
    return [(x - view.x) / view.scale, (y - view.y) / view.scale];
  }

  function toScreen(photoBox: Box): Box {
    return {
      left: photoBox.left * view.scale + view.x,
      top: photoBox.top * view.scale + view.y,
      width: photoBox.width * view.scale,
      height: photoBox.height * view.scale,
    };
  }

  function corners(screenBox: Box): Point[] {
    const right = screenBox.left + screenBox.width;
    const bottom = screenBox.top + screenBox.height;
    return [
      [screenBox.left, screenBox.top],
      [right, screenBox.top],
      [right, bottom],
      [screenBox.left, bottom],
    ];
  }

  function cornerNear(point: Point): number {
    if (box === null) {
      return -1;
    }
    return corners(toScreen(box)).findIndex(
      ([x, y]) => Math.abs(x - point[0]) <= CORNER_REACH_PX && Math.abs(y - point[1]) <= CORNER_REACH_PX,
    );
  }

  function isInsideFrame([x, y]: Point): boolean {
    if (box === null) {
      return false;
    }
    const shown = toScreen(box);
    return x >= shown.left && x <= shown.left + shown.width && y >= shown.top && y <= shown.top + shown.height;
  }

  function addFramePath(shown: Box): void {
    if (choice === "circle") {
      const radius = shown.width / 2;
      context.moveTo(shown.left + shown.width, shown.top + radius);
      context.arc(shown.left + radius, shown.top + radius, radius, 0, 2 * Math.PI);
    } else {
      context.rect(shown.left, shown.top, shown.width, shown.height);
    }
  }

  function draw(): void {
    const { width, height } = canvasSize();
    if (stage.hidden || width === 0 || height === 0) {
      return;
    }
    const pixelRatio = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * pixelRatio) || canvas.height !== Math.round(height * pixelRatio)) {
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
    }
    if (viewNeedsFit) {
      viewNeedsFit = false;
      view = { scale: fitScale(), x: 0, y: 0 };
      keepPhotoInView();
    }
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.imageSmoothingQuality = "high";
    context.drawImage(photo, view.x, view.y, photo.naturalWidth * view.scale, photo.naturalHeight * view.scale);
    if (box === null) {
      return;
    }
    const shown = toScreen(box);
    context.fillStyle = "rgba(0, 0, 0, 0.55)";
    context.beginPath();
    context.rect(0, 0, width, height);
    addFramePath(shown);
    context.fill("evenodd");

    context.strokeStyle = "#ffffff";
    context.lineWidth = 2;
    context.beginPath();
    addFramePath(shown);
    context.stroke();
    if (choice === "circle") {
      context.lineWidth = 1;
      context.setLineDash([4, 4]);
      context.strokeRect(shown.left, shown.top, shown.width, shown.height);
      context.setLineDash([]);
    }
    context.fillStyle = "#ffffff";
    context.strokeStyle = "#000000";
    context.lineWidth = 1;
    for (const [x, y] of corners(shown)) {
      const half = HANDLE_SIZE_PX / 2;
      context.fillRect(x - half, y - half, HANDLE_SIZE_PX, HANDLE_SIZE_PX);
      context.strokeRect(x - half, y - half, HANDLE_SIZE_PX, HANDLE_SIZE_PX);
    }
  }

  function pointerOnCanvas(event: MouseEvent): Point {
    const area = canvas.getBoundingClientRect();
    return [event.clientX - area.left, event.clientY - area.top];
  }

  function cursorFor(point: Point): string {
    const corner = cornerNear(point);
    if (corner >= 0) {
      return corner % 2 === 0 ? "nwse-resize" : "nesw-resize";
    }
    return isInsideFrame(point) ? "move" : "grab";
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || box === null) {
      return;
    }
    const point = pointerOnCanvas(event);
    const corner = cornerNear(point);
    if (corner >= 0) {
      const photoCorners = corners(box);
      drag = { kind: "resizeFrame", fixedCorner: photoCorners[(corner + 2) % 4] };
    } else if (isInsideFrame(point)) {
      drag = { kind: "moveFrame", startPointer: point, startBox: box };
    } else {
      drag = { kind: "movePhoto", startPointer: point, startView: { ...view } };
      canvas.style.cursor = "grabbing";
    }
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    const point = pointerOnCanvas(event);
    if (drag === null) {
      canvas.style.cursor = cursorFor(point);
      return;
    }
    if (drag.kind === "movePhoto") {
      view.x = drag.startView.x + point[0] - drag.startPointer[0];
      view.y = drag.startView.y + point[1] - drag.startPointer[1];
      keepPhotoInView();
    } else if (drag.kind === "moveFrame") {
      const byX = (point[0] - drag.startPointer[0]) / view.scale;
      const byY = (point[1] - drag.startPointer[1]) / view.scale;
      box = movedBox(drag.startBox, byX, byY, photo.naturalWidth, photo.naturalHeight);
    } else if (choice !== "none") {
      box = resizedBox(
        drag.fixedCorner,
        toPhoto(point),
        keepsEqualSides(choice),
        SMALLEST_FRAME_PX / view.scale,
        photo.naturalWidth,
        photo.naturalHeight,
      );
    }
    showParts();
  });

  const stopDrag = (event: PointerEvent) => {
    drag = null;
    canvas.style.cursor = cursorFor(pointerOnCanvas(event));
  };
  canvas.addEventListener("pointerup", stopDrag);
  canvas.addEventListener("pointercancel", stopDrag);

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoomAround(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, pointerOnCanvas(event));
    },
    { passive: false },
  );

  const canvasMiddle = (): Point => [canvasSize().width / 2, canvasSize().height / 2];
  find<HTMLButtonElement>("crop-zoom-in-button").addEventListener("click", () => zoomAround(ZOOM_STEP, canvasMiddle()));
  find<HTMLButtonElement>("crop-zoom-out-button").addEventListener("click", () => zoomAround(1 / ZOOM_STEP, canvasMiddle()));
  find<HTMLButtonElement>("crop-zoom-fit-button").addEventListener("click", showWholePhoto);

  applyButton.addEventListener("click", () => {
    const crop = currentCrop();
    appliedCrop = JSON.stringify(crop);
    showParts();
    useCrop(crop);
  });

  new ResizeObserver(() => {
    if (!stage.hidden && !viewNeedsFit) {
      keepPhotoInView();
    }
    draw();
  }).observe(stage);

  photo.addEventListener("load", () => {
    viewNeedsFit = true;
    showParts();
  });

  return {
    showPhoto(url: string): void {
      choice = "none";
      box = null;
      appliedCrop = "null";
      viewNeedsFit = true;
      radios.none.checked = true;
      panel.hidden = false;
      photo.src = url;
      showParts();
    },
  };
}

function buildChoices(container: HTMLElement, onChange: (choice: CropChoice) => void): Record<CropChoice, HTMLInputElement> {
  const radios = {} as Record<CropChoice, HTMLInputElement>;
  for (const choice of CROP_CHOICES) {
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "crop-shape";
    radio.value = choice;
    radio.checked = choice === "none";
    radio.addEventListener("change", () => onChange(choice));
    const label = document.createElement("label");
    label.append(radio, CHOICE_NAMES[choice]);
    container.append(label);
    radios[choice] = radio;
  }
  return radios;
}
