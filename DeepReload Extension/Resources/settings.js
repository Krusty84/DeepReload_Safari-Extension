//
//  settings.js
//  DeepReload Extension
//
//  Created by Sedoykin Alexey on 27/03/2026.
//

const TOAST_DURATION_MIN_MS = 1000;
const TOAST_DURATION_MAX_MS = 15000;
const AUTO_RELOAD_INTERVAL_MIN_SEC = 5;
const AUTO_RELOAD_INTERVAL_MAX_SEC = 3600;
const STATUS_VISIBLE_MS = 1400;

const DEFAULT_SETTINGS = {
  enableDeepReloadPage: true,
  enableDeepReloadElement: true,
  enableAutoReloadFallback: false,
  autoReloadIntervalSec: 30,
  enableElementHighlight: true,
  enableToastNotification: true,
  toastDurationMs: 5500,
  highlightColor: "#ff00ff"
};

let currentSettings = { ...DEFAULT_SETTINGS };
let statusTimer = null;
const SETTINGS_RUNTIME_KEY = "__wholepage_settings_runtime__";
const existingSettingsRuntime = globalThis[SETTINGS_RUNTIME_KEY];

if (existingSettingsRuntime && typeof existingSettingsRuntime.cleanup === "function") {
  try {
    existingSettingsRuntime.cleanup();
  } catch (error) {
    console.warn("Deep Reload: Failed to clean up previous settings runtime", error);
  }
}

const settingsRuntime = {
  destroyed: false,
  listenerRemovers: [],
  cleanup: null
};

globalThis[SETTINGS_RUNTIME_KEY] = settingsRuntime;

const controls = {
  enableDeepReloadPage: document.getElementById("enable-page-reload"),
  enableDeepReloadElement: document.getElementById("enable-element-reload"),
  enableAutoReloadFallback: document.getElementById("enable-auto-reload-fallback"),
  autoReloadIntervalSec: document.getElementById("auto-reload-interval-sec"),
  enableElementHighlight: document.getElementById("enable-element-highlight"),
  enableToastNotification: document.getElementById("enable-toast-notification"),
  toastDurationMs: document.getElementById("toast-duration-ms"),
  highlightColor: document.getElementById("highlight-color")
};

const saveStatusEl = document.getElementById("save-status");

function isSettingsRuntimeActive() {
  return globalThis[SETTINGS_RUNTIME_KEY] === settingsRuntime && settingsRuntime.destroyed !== true;
}

function addDomListener(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  settingsRuntime.listenerRemovers.push(() => {
    target.removeEventListener(type, handler, options);
  });
}

function addExtensionListener(eventSource, handler) {
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

function clampToastDurationMs(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.toastDurationMs;
  return Math.min(TOAST_DURATION_MAX_MS, Math.max(TOAST_DURATION_MIN_MS, parsed));
}

function clampAutoReloadIntervalSec(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.autoReloadIntervalSec;
  return Math.min(AUTO_RELOAD_INTERVAL_MAX_SEC, Math.max(AUTO_RELOAD_INTERVAL_MIN_SEC, parsed));
}

function normalizeHighlightColor(value) {
  if (typeof value !== "string") return DEFAULT_SETTINGS.highlightColor;

  const trimmed = value.trim().toLowerCase();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(trimmed);
  if (!match) return DEFAULT_SETTINGS.highlightColor;

  if (trimmed.length === 4) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }

  return trimmed;
}

function sanitizeSettings(rawSettings) {
  return {
    enableDeepReloadPage: rawSettings.enableDeepReloadPage !== false,
    enableDeepReloadElement: rawSettings.enableDeepReloadElement !== false,
    enableAutoReloadFallback: rawSettings.enableAutoReloadFallback === true,
    autoReloadIntervalSec: clampAutoReloadIntervalSec(rawSettings.autoReloadIntervalSec),
    enableElementHighlight: rawSettings.enableElementHighlight !== false,
    enableToastNotification: rawSettings.enableToastNotification !== false,
    toastDurationMs: clampToastDurationMs(rawSettings.toastDurationMs),
    highlightColor: normalizeHighlightColor(rawSettings.highlightColor)
  };
}

function showStatus(message, isError = false) {
  if (!saveStatusEl) return;

  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }

  saveStatusEl.textContent = message;
  saveStatusEl.style.color = isError ? "#a10029" : "#006b3c";

  statusTimer = setTimeout(() => {
    saveStatusEl.textContent = "Ready";
    saveStatusEl.style.color = "#006b3c";
  }, STATUS_VISIBLE_MS);
}

function renderControls() {
  if (!controls.enableDeepReloadPage || !controls.enableDeepReloadElement || !controls.enableAutoReloadFallback || !controls.autoReloadIntervalSec || !controls.enableElementHighlight || !controls.enableToastNotification || !controls.toastDurationMs || !controls.highlightColor) {
    return;
  }

  controls.enableDeepReloadPage.checked = currentSettings.enableDeepReloadPage;
  controls.enableDeepReloadElement.checked = currentSettings.enableDeepReloadElement;
  controls.enableAutoReloadFallback.checked = currentSettings.enableAutoReloadFallback;
  controls.autoReloadIntervalSec.value = String(currentSettings.autoReloadIntervalSec);
  controls.autoReloadIntervalSec.disabled = !currentSettings.enableAutoReloadFallback;
  controls.enableElementHighlight.checked = currentSettings.enableElementHighlight;
  controls.enableToastNotification.checked = currentSettings.enableToastNotification;
  controls.toastDurationMs.value = String(currentSettings.toastDurationMs);
  controls.toastDurationMs.disabled = !currentSettings.enableToastNotification;
  controls.highlightColor.value = normalizeHighlightColor(currentSettings.highlightColor);
  controls.highlightColor.disabled = !currentSettings.enableElementHighlight;
}

async function readSettings() {
  const stored = await browser.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  return sanitizeSettings(stored);
}

async function saveSettings(partialSettings) {
  const mergedSettings = sanitizeSettings({
    ...currentSettings,
    ...partialSettings
  });

  await browser.storage.local.set(mergedSettings);
  currentSettings = mergedSettings;
  renderControls();
}

function installListeners() {
  if (!controls.enableDeepReloadPage || !controls.enableDeepReloadElement || !controls.enableAutoReloadFallback || !controls.autoReloadIntervalSec || !controls.enableElementHighlight || !controls.enableToastNotification || !controls.toastDurationMs || !controls.highlightColor) {
    console.error("WholePage: Settings controls are missing in settings.html");
    return;
  }

  addDomListener(controls.enableDeepReloadPage, "change", async () => {
    try {
      await saveSettings({ enableDeepReloadPage: controls.enableDeepReloadPage.checked });
      showStatus("Saved");
    } catch (error) {
      console.error("WholePage: Failed to save setting", error);
      renderControls();
      showStatus("Save failed", true);
    }
  });

  addDomListener(controls.enableDeepReloadElement, "change", async () => {
    try {
      await saveSettings({ enableDeepReloadElement: controls.enableDeepReloadElement.checked });
      showStatus("Saved");
    } catch (error) {
      console.error("WholePage: Failed to save setting", error);
      renderControls();
      showStatus("Save failed", true);
    }
  });

  addDomListener(controls.enableAutoReloadFallback, "change", async () => {
    try {
      await saveSettings({ enableAutoReloadFallback: controls.enableAutoReloadFallback.checked });
      showStatus("Saved");
    } catch (error) {
      console.error("WholePage: Failed to save setting", error);
      renderControls();
      showStatus("Save failed", true);
    }
  });

  const persistAutoReloadInterval = async () => {
    try {
      const intervalSec = clampAutoReloadIntervalSec(controls.autoReloadIntervalSec.value);
      controls.autoReloadIntervalSec.value = String(intervalSec);
      await saveSettings({ autoReloadIntervalSec: intervalSec });
      showStatus("Saved");
    } catch (error) {
      console.error("WholePage: Failed to save setting", error);
      controls.autoReloadIntervalSec.value = String(currentSettings.autoReloadIntervalSec);
      showStatus("Save failed", true);
    }
  };

  addDomListener(controls.autoReloadIntervalSec, "change", () => {
    void persistAutoReloadInterval();
  });

  addDomListener(controls.autoReloadIntervalSec, "blur", () => {
    void persistAutoReloadInterval();
  });

  addDomListener(controls.enableToastNotification, "change", async () => {
    try {
      await saveSettings({ enableToastNotification: controls.enableToastNotification.checked });
      showStatus("Saved");
    } catch (error) {
      console.error("WholePage: Failed to save setting", error);
      renderControls();
      showStatus("Save failed", true);
    }
  });

  addDomListener(controls.enableElementHighlight, "change", async () => {
    try {
      await saveSettings({ enableElementHighlight: controls.enableElementHighlight.checked });
      showStatus("Saved");
    } catch (error) {
      console.error("WholePage: Failed to save setting", error);
      renderControls();
      showStatus("Save failed", true);
    }
  });

  const persistToastDuration = async () => {
    try {
      const durationMs = clampToastDurationMs(controls.toastDurationMs.value);
      controls.toastDurationMs.value = String(durationMs);
      await saveSettings({ toastDurationMs: durationMs });
      showStatus("Saved");
    } catch (error) {
      console.error("WholePage: Failed to save setting", error);
      controls.toastDurationMs.value = String(currentSettings.toastDurationMs);
      showStatus("Save failed", true);
    }
  };

  addDomListener(controls.toastDurationMs, "change", () => {
    void persistToastDuration();
  });

  addDomListener(controls.toastDurationMs, "blur", () => {
    void persistToastDuration();
  });

  addDomListener(controls.highlightColor, "change", async () => {
    try {
      const nextColor = normalizeHighlightColor(controls.highlightColor.value);
      controls.highlightColor.value = nextColor;
      await saveSettings({ highlightColor: nextColor });
      showStatus("Saved");
    } catch (error) {
      console.error("WholePage: Failed to save setting", error);
      controls.highlightColor.value = normalizeHighlightColor(currentSettings.highlightColor);
      showStatus("Save failed", true);
    }
  });

  addExtensionListener(browser.storage.onChanged, (changes, areaName) => {
    if (areaName !== "local") return;

    const hasRelevantChange = Object.keys(DEFAULT_SETTINGS).some((key) => key in changes);
    if (!hasRelevantChange) return;

    const nextRawSettings = { ...currentSettings };
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (!changes[key]) continue;
      nextRawSettings[key] = changes[key].newValue;
    }

    currentSettings = sanitizeSettings(nextRawSettings);
    renderControls();
  });
}

async function init() {
  try {
    currentSettings = await readSettings();
    if (!isSettingsRuntimeActive()) return;
    renderControls();
  } catch (error) {
    console.error("WholePage: Failed to load settings", error);
    if (!isSettingsRuntimeActive()) return;
    currentSettings = { ...DEFAULT_SETTINGS };
    renderControls();
    showStatus("Load failed, defaults used", true);
  }

  installListeners();
}

function disposeSettingsRuntime() {
  if (settingsRuntime.destroyed) {
    return;
  }

  settingsRuntime.destroyed = true;

  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }

  const removers = settingsRuntime.listenerRemovers.splice(0);
  removers.reverse().forEach((removeListener) => {
    try {
      removeListener();
    } catch (error) {
      console.warn("Deep Reload: Failed while disposing settings listener", error);
    }
  });

  if (globalThis[SETTINGS_RUNTIME_KEY] === settingsRuntime) {
    delete globalThis[SETTINGS_RUNTIME_KEY];
  }
}

settingsRuntime.cleanup = disposeSettingsRuntime;

void init();
