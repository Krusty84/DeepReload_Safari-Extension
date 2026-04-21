//
//  content.js
//  DeepReload Extension
//  Initializes shared content-script state, settings, timers, and lifecycle.
//
//  Created by Sedoykin Alexey on 27/03/2026.
//

const sharedSettingsSchema = globalThis.__deepreload_settings_schema__;

// Keep these as top-level declarations: later content files rely on the shared content-script scope.
var DEFAULT_SETTINGS = sharedSettingsSchema.DEFAULT_SETTINGS;

function clampAutoReloadIntervalSec(value) {
  return sharedSettingsSchema.clampAutoReloadIntervalSec(value);
}

function normalizeHighlightColor(value) {
  return sharedSettingsSchema.normalizeHighlightColor(value);
}

function sanitizeSettings(rawSettings) {
  return sharedSettingsSchema.sanitizeSettings(rawSettings);
}

async function readSharedSettings() {
  return sharedSettingsSchema.readSettings();
}

let lastSelectedElementLocator = null;
let currentHighlightedElement = null;
let activeReloadSessionId = 0;
let reloadIndicatorElement = null;
let reloadIndicatorTimer = null;
let reloadIndicatorHideTimer = null;
let activeIndicatorSessionId = 0;
let debugReportElement = null;
let debugReportHideTimer = null;
let debugReportFadeTimer = null;
let highlightOverlayRoot = null;
let highlightOverlayFrameId = 0;
let highlightResizeObserver = null;
let automaticReloadMode = null;
let automaticReloadIntervalMs = 0;
let automaticReloadTimer = null;
let automaticReloadNextAtMs = 0;
let automaticReloadBannerElement = null;
let automaticReloadCountdownTimer = null;
let automaticReloadToken = 0;
const managedTimeoutIds = new Set();
const CONTENT_RUNTIME_KEY = "__deepreload_content_runtime__";
const existingContentRuntime = globalThis[CONTENT_RUNTIME_KEY];

if (existingContentRuntime && typeof existingContentRuntime.cleanup === "function") {
  try {
    existingContentRuntime.cleanup();
  } catch (error) {
    console.warn("Deep Reload: Failed to clean up previous content runtime", error);
  }
}

const contentRuntime = {
  destroyed: false,
  listenerRemovers: [],
  cleanup: null
};

globalThis[CONTENT_RUNTIME_KEY] = contentRuntime;

const BUSTABLE_PROTOCOLS = new Set(["http:", "https:"]);
const PENDING_REPORT_STORAGE_KEY = "__deepreload_pending_report__";
const AUTO_RELOAD_STATE_STORAGE_KEY = "__deepreload_auto_reload_state__";
const AUTO_PAGE_BLINK_STORAGE_KEY = "__deepreload_auto_page_blink__";
const PENDING_REPORT_MAX_AGE_MS = 20000;
const AUTO_PAGE_BLINK_MAX_AGE_MS = 20000;
const AUTOMATIC_RELOAD_BANNER_UPDATE_MS = 1000;
const ELEMENT_SELECTION_BLINK_LEAD_IN_MS = 130;
const HIGHLIGHT_BORDER_WIDTH_PX = 3;
const HIGHLIGHT_OVERLAY_PADDING_PX = 2;
const HIGHLIGHT_MAX_RECT_COUNT = 24;
const URL_STYLE_PROPERTIES = [
  "backgroundImage",
  "borderImageSource",
  "listStyleImage",
  "maskImage",
  "webkitMaskImage"
];

let runtimeSettings = { ...DEFAULT_SETTINGS };

function isRuntimeActive() {
  return globalThis[CONTENT_RUNTIME_KEY] === contentRuntime && contentRuntime.destroyed !== true;
}

function addDomListener(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  contentRuntime.listenerRemovers.push(() => {
    target.removeEventListener(type, handler, options);
  });
}

function addExtensionListener(eventSource, handler) {
  eventSource.addListener(handler);
  contentRuntime.listenerRemovers.push(() => {
    try {
      if (eventSource.hasListener?.(handler)) {
        eventSource.removeListener(handler);
      }
    } catch (error) {
      console.warn("Deep Reload: Failed to remove extension listener", error);
    }
  });
}

function scheduleManagedTimeout(callback, delay) {
  const timeoutId = setTimeout(() => {
    managedTimeoutIds.delete(timeoutId);
    callback();
  }, delay);
  managedTimeoutIds.add(timeoutId);
  return timeoutId;
}

function clearManagedTimeout(timeoutId) {
  if (!timeoutId) return null;
  clearTimeout(timeoutId);
  managedTimeoutIds.delete(timeoutId);
  return null;
}

function clearAllManagedTimeouts() {
  for (const timeoutId of managedTimeoutIds) {
    clearTimeout(timeoutId);
  }
  managedTimeoutIds.clear();
}

function waitForManagedDelay(delay) {
  return new Promise((resolve) => {
    scheduleManagedTimeout(resolve, delay);
  });
}

function isMessageObject(value) {
  return value !== null && typeof value === "object";
}

function normalizeReportContext(value) {
  if (!isMessageObject(value)) return null;

  const normalized = {};

  if (typeof value.mode === "string" && value.mode.trim()) {
    normalized.mode = value.mode.trim();
  }

  if (typeof value.note === "string" && value.note.trim()) {
    normalized.note = value.note.trim();
  }

  if (value.suppressReport === true) {
    normalized.suppressReport = true;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function hexToRgb(hexColor) {
  const normalized = normalizeHighlightColor(hexColor).slice(1);
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
}

// Full modes show feedback on right-click selection; command modes show feedback only while executing reload.
function usesPersistentElementSelectionVisuals() {
  return runtimeSettings.elementSelectionStyle === "persistent";
}

function usesBlinkElementSelectionVisuals() {
  return runtimeSettings.elementSelectionStyle === "blink";
}

function canRenderPersistentElementSelectionVisuals() {
  return (
    runtimeSettings.elementSelectionStyle === "persistent" ||
    runtimeSettings.elementSelectionStyle === "half-persistent"
  );
}

function usesCommandBlinkElementSelectionVisuals() {
  return (
    runtimeSettings.elementSelectionStyle === "blink" ||
    runtimeSettings.elementSelectionStyle === "half-blink"
  );
}

function usesCommandPersistentElementSelectionVisuals() {
  return runtimeSettings.elementSelectionStyle === "half-persistent";
}

function applyRuntimeSettingsPatch(patch) {
  runtimeSettings = sanitizeSettings({
    ...runtimeSettings,
    ...patch
  });

  if (!runtimeSettings.enableToastNotification) {
    if (reloadIndicatorTimer) {
      clearInterval(reloadIndicatorTimer);
      reloadIndicatorTimer = null;
    }
    reloadIndicatorHideTimer = clearManagedTimeout(reloadIndicatorHideTimer);
    if (debugReportHideTimer) {
      debugReportHideTimer = clearManagedTimeout(debugReportHideTimer);
    }
    debugReportFadeTimer = clearManagedTimeout(debugReportFadeTimer);
    if (reloadIndicatorElement) {
      reloadIndicatorElement.style.display = "none";
      reloadIndicatorElement.style.opacity = "0";
    }
    if (debugReportElement) {
      debugReportElement.style.display = "none";
      debugReportElement.style.opacity = "0";
    }
  }

  if (!runtimeSettings.enableDeepReloadElement) {
    clearSelectedElement();
  }

  if (!runtimeSettings.enableDeepReloadPage && automaticReloadMode === "page") {
    stopAutomaticReload();
  }

  if (!usesPersistentElementSelectionVisuals()) {
    clearSelectionVisual();
  }

  if (!runtimeSettings.enableAutoReloadFallback) {
    stopAutomaticReload();
  }

  if (runtimeSettings.enableAutoReloadFallback && automaticReloadMode === "page" && runtimeSettings.enableDeepReloadPage) {
    renderAutomaticReloadBanner();
    startAutomaticReloadCountdown();
  } else {
    hideAutomaticReloadBanner();
  }

  if (runtimeSettings.enableDeepReloadElement && usesPersistentElementSelectionVisuals() && currentHighlightedElement) {
    syncHighlightOverlay();
  }
}

async function loadSettingsFromStorage() {
  try {
    const stored = await readSharedSettings();
    if (!isRuntimeActive()) return;
    applyRuntimeSettingsPatch(stored);
  } catch (error) {
    console.warn("Deep Reload: Failed to load runtime settings", error);
    if (!isRuntimeActive()) return;
    applyRuntimeSettingsPatch(DEFAULT_SETTINGS);
  }
}
