//
//  background-core.js
//  DeepReload Extension
//
//  Created by Sedoykin Alexey on 27/03/2026.
//

export const BUSTABLE_PROTOCOLS = new Set(["http:", "https:"]);
export const MENU_WHOLE_PAGE_ID = "whole-page";
export const MENU_ELEMENT_UNDER_CURSOR_ID = "element-under-cursor";
export const MENU_AUTOMATIC_ROOT_ID = "automatic-root";
export const MENU_AUTOMATIC_WHOLE_PAGE_ID = "automatic-whole-page";
export const MENU_AUTOMATIC_RESET_ID = "automatic-reset";
const AUTO_RELOAD_INTERVAL_MIN_SEC = 5;
const AUTO_RELOAD_INTERVAL_MAX_SEC = 3600;
const TOAST_DURATION_MIN_SEC = 1;
const TOAST_DURATION_MAX_SEC = 15;
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

export const BACKGROUND_RUNTIME_KEY = "__deepreload_background_runtime__";
const existingBackgroundRuntime = globalThis[BACKGROUND_RUNTIME_KEY];

if (existingBackgroundRuntime && typeof existingBackgroundRuntime.cleanup === "function") {
  try {
    existingBackgroundRuntime.cleanup();
  } catch (error) {
    console.warn("Deep Reload: Failed to clean up previous background runtime", error);
  }
}

export const backgroundRuntime = {
  destroyed: false,
  listenerRemovers: [],
  cleanup: null
};

globalThis[BACKGROUND_RUNTIME_KEY] = backgroundRuntime;

export function isBackgroundRuntimeActive() {
  return globalThis[BACKGROUND_RUNTIME_KEY] === backgroundRuntime && backgroundRuntime.destroyed !== true;
}

export function addExtensionListener(eventSource, handler) {
  eventSource.addListener(handler);
  backgroundRuntime.listenerRemovers.push(() => {
    try {
      if (eventSource.hasListener?.(handler)) {
        eventSource.removeListener(handler);
      }
    } catch (error) {
      console.warn("Deep Reload: Failed to remove background listener", error);
    }
  });
}

export function isMessageObject(value) {
  return value !== null && typeof value === "object";
}

function clampAutoReloadIntervalSec(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.autoReloadIntervalSec;
  return Math.min(AUTO_RELOAD_INTERVAL_MAX_SEC, Math.max(AUTO_RELOAD_INTERVAL_MIN_SEC, parsed));
}

function clampToastDurationSec(value) {
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

export function normalizeSettings(rawSettings) {
  return {
    enableDeepReloadPage: rawSettings.enableDeepReloadPage !== false,
    enableDeepReloadElement: rawSettings.enableDeepReloadElement !== false,
    enableAutoReloadFallback: rawSettings.enableAutoReloadFallback === true,
    autoReloadIntervalSec: clampAutoReloadIntervalSec(rawSettings.autoReloadIntervalSec),
    enableToastNotification: rawSettings.enableToastNotification !== false,
    toastDurationSec: normalizeToastDurationSec(rawSettings)
  };
}

export async function readSettings() {
  const stored = await browser.storage.local.get([
    ...Object.keys(DEFAULT_SETTINGS),
    LEGACY_TOAST_DURATION_MS_KEY
  ]);
  return normalizeSettings(stored);
}
