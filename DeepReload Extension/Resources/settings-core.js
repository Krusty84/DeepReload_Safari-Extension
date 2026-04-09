//
//  settings-core.js
//  DeepReload Extension
//
//  Created by Sedoykin Alexey on 27/03/2026.
//

const TOAST_DURATION_MIN_SEC = 1;
const TOAST_DURATION_MAX_SEC = 15;
const AUTO_RELOAD_INTERVAL_MIN_SEC = 5;
const AUTO_RELOAD_INTERVAL_MAX_SEC = 3600;
const LEGACY_TOAST_DURATION_MS_KEY = "toastDurationMs";

export const DEFAULT_SETTINGS = {
  enableDeepReloadPage: true,
  enableDeepReloadElement: true,
  enableAutoReloadFallback: false,
  autoReloadIntervalSec: 30,
  enableElementHighlight: true,
  enableToastNotification: true,
  toastDurationSec: 5.5,
  highlightColor: "#ff00ff"
};

export let currentSettings = { ...DEFAULT_SETTINGS };
export const SETTINGS_RUNTIME_KEY = "__deepreload_settings_runtime__";
const existingSettingsRuntime = globalThis[SETTINGS_RUNTIME_KEY];

if (existingSettingsRuntime && typeof existingSettingsRuntime.cleanup === "function") {
  try {
    existingSettingsRuntime.cleanup();
  } catch (error) {
    console.warn("Deep Reload: Failed to clean up previous settings runtime", error);
  }
}

export const settingsRuntime = {
  destroyed: false,
  listenerRemovers: [],
  cleanup: null
};

globalThis[SETTINGS_RUNTIME_KEY] = settingsRuntime;

export function isSettingsRuntimeActive() {
  return globalThis[SETTINGS_RUNTIME_KEY] === settingsRuntime && settingsRuntime.destroyed !== true;
}

export function addDomListener(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  settingsRuntime.listenerRemovers.push(() => {
    target.removeEventListener(type, handler, options);
  });
}

export function addExtensionListener(eventSource, handler) {
  eventSource.addListener(handler);
  settingsRuntime.listenerRemovers.push(() => {
    try {
      if (eventSource.hasListener?.(handler)) {
        eventSource.removeListener(handler);
      }
    } catch (error) {
      console.warn("Deep Reload: Failed to remove settings listener", error);
    }
  });
}

export function clampToastDurationSec(value) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.toastDurationSec;
  return Math.min(TOAST_DURATION_MAX_SEC, Math.max(TOAST_DURATION_MIN_SEC, parsed));
}

function normalizeToastDurationSec(rawSettings) {
  if (rawSettings.toastDurationSec !== undefined) {
    return clampToastDurationSec(rawSettings.toastDurationSec);
  }

  if (rawSettings[LEGACY_TOAST_DURATION_MS_KEY] !== undefined) {
    return clampToastDurationSec(Number(rawSettings[LEGACY_TOAST_DURATION_MS_KEY]) / 1000);
  }

  return DEFAULT_SETTINGS.toastDurationSec;
}

export function clampAutoReloadIntervalSec(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.autoReloadIntervalSec;
  return Math.min(AUTO_RELOAD_INTERVAL_MAX_SEC, Math.max(AUTO_RELOAD_INTERVAL_MIN_SEC, parsed));
}

export function normalizeHighlightColor(value) {
  if (typeof value !== "string") return DEFAULT_SETTINGS.highlightColor;

  const trimmed = value.trim().toLowerCase();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(trimmed);
  if (!match) return DEFAULT_SETTINGS.highlightColor;

  if (trimmed.length === 4) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }

  return trimmed;
}

export function sanitizeSettings(rawSettings) {
  return {
    enableDeepReloadPage: rawSettings.enableDeepReloadPage !== false,
    enableDeepReloadElement: rawSettings.enableDeepReloadElement !== false,
    enableAutoReloadFallback: rawSettings.enableAutoReloadFallback === true,
    autoReloadIntervalSec: clampAutoReloadIntervalSec(rawSettings.autoReloadIntervalSec),
    enableElementHighlight: rawSettings.enableElementHighlight !== false,
    enableToastNotification: rawSettings.enableToastNotification !== false,
    toastDurationSec: normalizeToastDurationSec(rawSettings),
    highlightColor: normalizeHighlightColor(rawSettings.highlightColor)
  };
}

export function setCurrentSettings(nextSettings) {
  currentSettings = sanitizeSettings(nextSettings);
  return currentSettings;
}

export async function readSettings() {
  const stored = await browser.storage.local.get([
    ...Object.keys(DEFAULT_SETTINGS),
    LEGACY_TOAST_DURATION_MS_KEY
  ]);
  return sanitizeSettings(stored);
}

export async function saveSettings(partialSettings) {
  const mergedSettings = sanitizeSettings({
    ...currentSettings,
    ...partialSettings
  });

  await browser.storage.local.set(mergedSettings);
  await browser.storage.local.remove(LEGACY_TOAST_DURATION_MS_KEY);
  currentSettings = mergedSettings;
  return currentSettings;
}
