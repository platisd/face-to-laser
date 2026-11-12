import { type Settings, settingsFromJson, settingsToJson } from "./settings";

const STORAGE_KEY = "face-to-laser-settings";

export function loadRememberedSettings(): Settings | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === null ? null : settingsFromJson(saved);
  } catch {
    return null;
  }
}

export function rememberSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, settingsToJson(settings));
  } catch {
    return;
  }
}
