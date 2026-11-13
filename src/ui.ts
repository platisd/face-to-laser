import {
  CONTROL_GROUPS,
  type Control,
  type SettingPath,
  type SettingValue,
  type SliderControl,
  controlsInUse,
  getSettingValue,
  withSettingValue,
} from "./controls";
import type { Crop } from "./crop";
import { startCropEditor } from "./cropEditor";
import { safeFileName } from "./fileNames";
import { type DownloadProgress, MODEL_FILES, type ModelId } from "./models";
import { newestOnly } from "./newestOnly";
import { drawPictureWithRulers, rulerSizeFor } from "./rulers";
import { angleTowards } from "./keychain";
import { PREVIEW_MODES, PREVIEW_RESULT, type PreviewMode } from "./preview";
import { loadRememberedSettings, rememberSettings } from "./rememberedSettings";
import { defaultSettings, settingsFromJson, settingsToJson } from "./settings";
import type { MessageFromWorker, MessageToWorker, PreviewResult } from "./workerMessages";

interface ShownControl {
  control: Control;
  element: HTMLElement;
  inputs: (HTMLInputElement | HTMLSelectElement)[];
  show(value: SettingValue): void;
}

function find<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export function startApp(): void {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  const send = (message: MessageToWorker) => worker.postMessage(message);

  let settings = loadRememberedSettings() ?? defaultSettings();
  let previewMode: PreviewMode = PREVIEW_RESULT;
  let analysisReady = false;
  let analysisFailed = false;
  let latestPhoto: Blob | null = null;
  let latestCrop: Crop | null = null;
  let latestRequestId = 0;
  const modelProgress = new Map<ModelId, DownloadProgress>();

  const status = find<HTMLParagraphElement>("status");
  const canvas = find<HTMLCanvasElement>("preview");
  const previewEmpty = find<HTMLParagraphElement>("preview-empty");
  const busy = find<HTMLSpanElement>("busy");
  const exportButton = find<HTMLButtonElement>("export-button");
  const exportMessage = find<HTMLParagraphElement>("export-message");
  const settingsMessage = find<HTMLParagraphElement>("settings-message");
  const woodColors = find<HTMLInputElement>("wood-colors");
  const modelPanel = find<HTMLElement>("model-downloads");
  const cropEditor = startCropEditor((crop) => {
    latestCrop = crop;
    analyzeLatestPhoto();
  });

  function showStatus(text: string, isError = false): void {
    status.textContent = text;
    status.classList.toggle("error", isError);
  }

  function showMessage(element: HTMLElement, text: string, isError = false): void {
    element.textContent = text;
    element.classList.toggle("error", isError);
  }

  const preview = newestOnly(() => {
    latestRequestId++;
    busy.hidden = false;
    send({ kind: "preview", requestId: latestRequestId, settings, mode: previewMode, woodColors: woodColors.checked });
  });

  function askForPreview(): void {
    if (analysisReady) {
      preview.ask();
    }
  }

  const shownControls = buildControls(find<HTMLDivElement>("controls"), (path, value) => {
    settings = withSettingValue(settings, path, value);
    settingsChanged();
  });

  function settingsChanged(): void {
    rememberSettings(settings);
    const inUse = controlsInUse(settings);
    for (const shown of shownControls) {
      shown.show(getSettingValue(settings, shown.control.path));
      const isInUse = inUse[shown.control.path];
      shown.element.classList.toggle("not-in-use", !isInUse);
      for (const input of shown.inputs) {
        input.disabled = !isInUse;
      }
    }
    askForPreview();
  }

  buildPreviewModes(find<HTMLDivElement>("preview-modes"), (mode) => {
    previewMode = mode;
    askForPreview();
  });
  woodColors.addEventListener("change", askForPreview);

  let shownPreview: PreviewResult | null = null;
  canvas.addEventListener("click", (event) => {
    const aimFrom = shownPreview?.holderAimFrom;
    if (!shownPreview || !aimFrom) {
      return;
    }
    const box = canvas.getBoundingClientRect();
    const rulerSize = rulerSizeFor(shownPreview.picture);
    const x = ((event.clientX - box.left) * canvas.width) / box.width - rulerSize;
    const y = ((event.clientY - box.top) * canvas.height) / box.height - rulerSize;
    settings = withSettingValue(settings, "keychain_angle_deg", angleTowards(aimFrom, [x, y]));
    settingsChanged();
  });

  function showPreview(result: PreviewResult | null): void {
    if (result === null) {
      return;
    }
    shownPreview = result;
    canvas.classList.toggle("places-holder", result.holderAimFrom !== null);
    const pageColors = getComputedStyle(document.documentElement);
    drawPictureWithRulers(canvas, result.picture, result.dotsPerMm, {
      background: pageColors.getPropertyValue("--panel").trim() || "#ffffff",
      lines: pageColors.getPropertyValue("--muted").trim() || "#6b635a",
      text: pageColors.getPropertyValue("--text").trim() || "#1f1b16",
    });
    canvas.hidden = false;
    previewEmpty.hidden = true;
    const sizeText = (widthMm: number, heightMm: number) => `${widthMm.toFixed(1)} × ${heightMm.toFixed(1)} mm`;
    const pieceText =
      result.piece === null
        ? ""
        : ` ${result.hasCutLine ? "Cut piece" : "Burned area"}: ${sizeText(result.piece.widthMm, result.piece.heightMm)}.`;
    showStatus(
      `${result.message} Whole area: ${sizeText(result.widthMm, result.heightMm)}.${pieceText} ` +
        `(${result.widthDots} × ${result.heightDots} dots)`,
    );
  }

  function choosePhoto(photo: Blob): void {
    if (!photo.type.startsWith("image/")) {
      showStatus("This file is not a picture.", true);
      return;
    }
    latestPhoto = photo;
    latestCrop = null;
    const thumb = find<HTMLImageElement>("photo-thumb");
    if (thumb.src) {
      URL.revokeObjectURL(thumb.src);
    }
    thumb.src = URL.createObjectURL(photo);
    thumb.hidden = false;
    find<HTMLSpanElement>("photo-drop-text").textContent = "Choose another photo, drop it here, or paste it.";
    cropEditor.showPhoto(thumb.src);
    analyzeLatestPhoto();
  }

  function analyzeLatestPhoto(): void {
    if (latestPhoto === null) {
      return;
    }
    analysisReady = false;
    analysisFailed = false;
    exportButton.disabled = true;
    showStatus(allModelsReady() ? "Looking at the photo…" : "Waiting for the models to finish loading…");
    busy.hidden = false;
    send({ kind: "photo", photo: latestPhoto, crop: latestCrop });
  }

  function allModelsReady(): boolean {
    return MODEL_FILES.every((file) => modelProgress.get(file.id)?.state === "ready");
  }

  function showModelProgress(): void {
    renderModelPanel(modelPanel, modelProgress, () => {
      modelProgress.clear();
      send({ kind: "loadModels" });
      if (analysisFailed) {
        analyzeLatestPhoto();
      }
    });
  }

  worker.addEventListener("message", (event: MessageEvent<MessageFromWorker>) => {
    const message = event.data;
    switch (message.kind) {
      case "modelProgress":
        modelProgress.set(message.progress.id, message.progress);
        showModelProgress();
        break;
      case "modelsReady":
        showModelProgress();
        break;
      case "modelsFailed":
        showModelProgress();
        break;
      case "analysisStarted":
        showStatus("Looking at the photo…");
        break;
      case "analysisDone":
        analysisReady = true;
        exportButton.disabled = false;
        showStatus(message.message);
        preview.ask();
        break;
      case "analysisFailed":
        analysisFailed = true;
        busy.hidden = true;
        showStatus(`Could not use this photo: ${message.error}`, true);
        break;
      case "preview":
        preview.finished();
        busy.hidden = !preview.isBusy();
        if (message.requestId === latestRequestId) {
          showPreview(message.result);
        }
        break;
      case "exported":
        exportButton.disabled = !analysisReady;
        showMessage(exportMessage, "Done. The .zip file is in your downloads.");
        downloadFile(new Blob([message.zip as BlobPart], { type: "application/zip" }), exportFileName());
        break;
      case "requestFailed":
        if (message.requestId === exportRequestId) {
          exportButton.disabled = !analysisReady;
          showMessage(exportMessage, `Could not export: ${message.error}`, true);
        } else {
          preview.finished();
          busy.hidden = !preview.isBusy();
          showStatus(`Could not make the preview: ${message.error}`, true);
        }
        break;
    }
  });

  let exportRequestId = -1;
  const fileName = find<HTMLInputElement>("file-name");
  const exportFileName = () => `${safeFileName(fileName.value)}_${timestamp()}.zip`;
  exportButton.addEventListener("click", () => {
    latestRequestId++;
    exportRequestId = latestRequestId;
    exportButton.disabled = true;
    showMessage(exportMessage, "Making the laser files…");
    send({ kind: "export", requestId: exportRequestId, settings, name: safeFileName(fileName.value) });
  });

  connectPhotoInput(choosePhoto);

  find<HTMLButtonElement>("reset-button").addEventListener("click", () => {
    settings = defaultSettings();
    showMessage(settingsMessage, "All settings are back to their first values.");
    settingsChanged();
  });
  find<HTMLButtonElement>("save-button").addEventListener("click", () => {
    downloadFile(new Blob([settingsToJson(settings)], { type: "application/json" }), "laser_settings.json");
  });
  const loadInput = find<HTMLInputElement>("load-input");
  find<HTMLButtonElement>("load-button").addEventListener("click", () => loadInput.click());
  loadInput.addEventListener("change", async () => {
    const file = loadInput.files?.[0];
    loadInput.value = "";
    if (!file) {
      return;
    }
    try {
      settings = settingsFromJson(await file.text());
      showMessage(settingsMessage, `Loaded ${file.name}.`);
      settingsChanged();
    } catch (error) {
      showMessage(settingsMessage, `Could not read the settings file: ${(error as Error).message}`, true);
    }
  });

  settingsChanged();
  showModelProgress();
  send({ kind: "loadModels" });
}

function buildControls(container: HTMLElement, onChange: (path: SettingPath, value: SettingValue) => void): ShownControl[] {
  const shown: ShownControl[] = [];
  for (const group of CONTROL_GROUPS) {
    const details = document.createElement("details");
    details.className = "group";
    details.open = group.open;
    const summary = document.createElement("summary");
    summary.textContent = group.title;
    const body = document.createElement("div");
    body.className = "group-body";
    details.append(summary, body);
    if (group.note) {
      const note = document.createElement("p");
      note.className = "group-note";
      note.textContent = group.note;
      body.append(note);
    }
    let rowElement: HTMLElement | null = null;
    for (const control of group.controls) {
      const built = buildControl(control, onChange);
      shown.push(built);
      if (control.row === undefined) {
        rowElement = null;
        body.append(built.element);
        continue;
      }
      if (rowElement === null || rowElement.dataset.row !== control.row) {
        rowElement = document.createElement("div");
        rowElement.className = "area-row";
        rowElement.dataset.row = control.row;
        const heading = document.createElement("h3");
        heading.textContent = control.row;
        rowElement.append(heading);
        body.append(rowElement);
      }
      rowElement.append(built.element);
    }
    container.append(details);
  }
  return shown;
}

let nextInputNumber = 0;

function buildControl(control: Control, onChange: (path: SettingPath, value: SettingValue) => void): ShownControl {
  const element = document.createElement("div");
  element.className = "control";
  element.dataset.path = control.path;
  const inputId = `setting-${nextInputNumber++}`;
  const label = document.createElement("label");
  label.className = "control-label";
  label.htmlFor = inputId;
  label.textContent = control.label;
  if (control.row) {
    label.setAttribute("aria-label", `${control.row} ${control.label.toLowerCase()}`);
  }

  const addInfo = () => {
    if (control.info) {
      const info = document.createElement("span");
      info.className = "control-info";
      info.textContent = control.info;
      element.append(info);
    }
  };

  if (control.kind === "slider") {
    const built = buildSlider(control, inputId, (value) => onChange(control.path, value));
    element.append(label, built.line);
    addInfo();
    return { control, element, inputs: built.inputs, show: (value) => built.show(value as number) };
  }

  if (control.kind === "checkbox") {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = inputId;
    checkbox.addEventListener("change", () => onChange(control.path, checkbox.checked));
    label.className = "checkbox";
    label.prepend(checkbox);
    element.append(label);
    addInfo();
    return { control, element, inputs: [checkbox], show: (value) => (checkbox.checked = value as boolean) };
  }

  if (control.kind === "dropdown") {
    const select = document.createElement("select");
    select.id = inputId;
    for (const choice of control.choices) {
      select.append(new Option(choice.replace("_", " "), choice));
    }
    select.addEventListener("change", () => onChange(control.path, select.value));
    element.append(label, select);
    addInfo();
    return { control, element, inputs: [select], show: (value) => (select.value = value as string) };
  }

  const group = document.createElement("div");
  group.className = "choice-row";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", control.label);
  const radios = control.choices.map((choice) => {
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = inputId;
    radio.value = choice;
    radio.addEventListener("change", () => onChange(control.path, choice));
    const choiceLabel = document.createElement("label");
    choiceLabel.append(radio, choice);
    group.append(choiceLabel);
    return radio;
  });
  const heading = document.createElement("span");
  heading.className = "control-label";
  heading.textContent = control.label;
  element.append(heading, group);
  addInfo();
  return {
    control,
    element,
    inputs: radios,
    show: (value) => radios.forEach((radio) => (radio.checked = radio.value === value)),
  };
}

function buildSlider(control: SliderControl, inputId: string, onChange: (value: number) => void) {
  const line = document.createElement("div");
  line.className = "slider-line";
  const range = document.createElement("input");
  range.type = "range";
  range.id = inputId;
  const number = document.createElement("input");
  number.type = "number";
  number.setAttribute("aria-label", control.label);
  for (const input of [range, number]) {
    input.min = String(control.min);
    input.max = String(control.max);
    input.step = String(control.step);
  }
  range.addEventListener("input", () => onChange(Number(range.value)));
  number.addEventListener("change", () => {
    const typed = Number(number.value);
    if (number.value.trim() === "" || !Number.isFinite(typed)) {
      return;
    }
    onChange(Math.min(control.max, Math.max(control.min, typed)));
  });
  line.append(range, number);
  return {
    line,
    inputs: [range, number],
    show(value: number) {
      range.value = String(value);
      if (document.activeElement !== number) {
        number.value = String(value);
      }
    },
  };
}

function buildPreviewModes(container: HTMLElement, onChange: (mode: PreviewMode) => void): void {
  for (const mode of PREVIEW_MODES) {
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "preview-mode";
    radio.value = mode;
    radio.checked = mode === PREVIEW_RESULT;
    radio.addEventListener("change", () => onChange(mode));
    const label = document.createElement("label");
    label.append(radio, mode);
    container.append(label);
  }
}

function renderModelPanel(panel: HTMLElement, progress: Map<ModelId, DownloadProgress>, retry: () => void): void {
  const allReady = MODEL_FILES.every((file) => progress.get(file.id)?.state === "ready");
  panel.replaceChildren();
  panel.hidden = allReady;
  if (allReady) {
    return;
  }
  const heading = document.createElement("h2");
  heading.textContent = "Loading models";
  panel.append(heading);
  let anyFailed = false;
  for (const file of MODEL_FILES) {
    const item = progress.get(file.id);
    const line = document.createElement("div");
    line.className = "model-line";
    const name = document.createElement("span");
    name.textContent = file.name;
    const size = document.createElement("span");
    const totalBytes = item?.totalBytes ?? file.sizeBytes;
    size.textContent = `${megabytes(item?.loadedBytes ?? 0)} / ${megabytes(totalBytes)} MB`;
    const bar = document.createElement("progress");
    bar.max = totalBytes;
    bar.value = item?.loadedBytes ?? 0;
    bar.setAttribute("aria-label", `${file.name} download`);
    const note = document.createElement("span");
    note.className = "model-note";
    if (item === undefined || item.state === "waiting") {
      note.textContent = "Waiting…";
    } else if (item.state === "failed") {
      anyFailed = true;
      note.classList.add("error");
      note.textContent = `Download failed: ${item.error ?? "unknown problem"}. Check the internet connection.`;
    } else if (item.fromCache) {
      note.textContent = "Loaded from browser cache.";
    } else {
      note.textContent = item.state === "ready" ? "Downloaded." : "Downloading.";
    }
    line.append(name, size, bar, note);
    panel.append(line);
  }
  if (anyFailed) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Try again";
    button.title = "Download the models again";
    button.addEventListener("click", retry);
    panel.append(button);
  }
}

function megabytes(bytes: number): string {
  return (bytes / 1e6).toFixed(1);
}

function connectPhotoInput(choosePhoto: (photo: Blob) => void): void {
  const input = find<HTMLInputElement>("photo-input");
  const dropZone = find<HTMLLabelElement>("photo-drop");
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) {
      choosePhoto(file);
    }
    input.value = "";
  });
  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragging"));
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
    const file = event.dataTransfer?.files[0];
    if (file) {
      choosePhoto(file);
    }
  });
  document.addEventListener("paste", (event) => {
    const file = [...(event.clipboardData?.files ?? [])].find((item) => item.type.startsWith("image/"));
    if (file) {
      choosePhoto(file);
    }
  });
}

function downloadFile(blob: Blob, name: string): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

function timestamp(): string {
  const now = new Date();
  const two = (value: number) => String(value).padStart(2, "0");
  return (
    `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-` +
    `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`
  );
}
