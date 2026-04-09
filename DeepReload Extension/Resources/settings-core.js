//
//  settings-core.js
//  DeepReload Extension
//
//  Created by Sedoykin Alexey on 27/03/2026.
//

import "./settings-schema.js";

const {
  DEFAULT_SETTINGS,
  clampAutoReloadIntervalSec,
  clampToastDurationSec,
  normalizeHighlightColor,
  readSettings,
  sanitizeSettings,
  saveSettings
} = globalThis.__deepreload_settings_schema__;

export {
  DEFAULT_SETTINGS,
  clampAutoReloadIntervalSec,
  clampToastDurationSec,
  normalizeHighlightColor,
  readSettings,
  sanitizeSettings,
  saveSettings
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

export function setCurrentSettings(nextSettings) {
  currentSettings = sanitizeSettings(nextSettings);
  return currentSettings;
}

export async function persistSettings(partialSettings) {
  currentSettings = await saveSettings(partialSettings, currentSettings);
  return currentSettings;
}
