//
//  background-core.js
//  DeepReload Extension
//  Provides background runtime state, constants, listeners, and settings access.
//
//  Created by Sedoykin Alexey on 27/03/2026.
//

import "./settings-schema.js";

const {
  DEFAULT_SETTINGS,
  readSettings,
  sanitizeSettings
} = globalThis.__deepreload_settings_schema__;

export const BUSTABLE_PROTOCOLS = new Set(["http:", "https:"]);
export const MENU_WHOLE_PAGE_ID = "whole-page";
export const MENU_ELEMENT_UNDER_CURSOR_ID = "element-under-cursor";
export const MENU_AUTOMATIC_ROOT_ID = "automatic-root";
export const MENU_AUTOMATIC_WHOLE_PAGE_ID = "automatic-whole-page";
export const MENU_AUTOMATIC_RESET_ID = "automatic-reset";
export { DEFAULT_SETTINGS, readSettings };

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

export function normalizeSettings(rawSettings) {
  return sanitizeSettings(rawSettings);
}
