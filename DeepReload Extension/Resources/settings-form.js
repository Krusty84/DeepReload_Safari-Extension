//
//  settings-form.js
//  DeepReload Extension
//
//  Created by Sedoykin Alexey on 27/03/2026.
//

import {
  DEFAULT_SETTINGS,
  addDomListener,
  addExtensionListener,
  clampAutoReloadIntervalSec,
  clampToastDurationSec,
  currentSettings,
  normalizeHighlightColor,
  sanitizeSettings,
  saveSettings,
  setCurrentSettings
} from "./settings-core.js";

const STATUS_VISIBLE_MS = 1400;

const controls = {
  enableDeepReloadPage: document.getElementById("enable-page-reload"),
  enableDeepReloadElement: document.getElementById("enable-element-reload"),
  enableAutoReloadFallback: document.getElementById("enable-auto-reload-fallback"),
  autoReloadIntervalSec: document.getElementById("auto-reload-interval-sec"),
  enableElementHighlight: document.getElementById("enable-element-highlight"),
  enableToastNotification: document.getElementById("enable-toast-notification"),
  toastDurationSec: document.getElementById("toast-duration-sec"),
  highlightColor: document.getElementById("highlight-color")
};

const saveStatusEl = document.getElementById("save-status");
let statusTimer = null;

function hasAllControls() {
  return Boolean(
    controls.enableDeepReloadPage &&
    controls.enableDeepReloadElement &&
    controls.enableAutoReloadFallback &&
    controls.autoReloadIntervalSec &&
    controls.enableElementHighlight &&
    controls.enableToastNotification &&
    controls.toastDurationSec &&
    controls.highlightColor
  );
}

export function clearStatusTimer() {
  if (!statusTimer) return;
  clearTimeout(statusTimer);
  statusTimer = null;
}

export function showStatus(message, isError = false) {
  if (!saveStatusEl) return;

  clearStatusTimer();

  saveStatusEl.textContent = message;
  saveStatusEl.style.color = isError ? "#a10029" : "#006b3c";

  statusTimer = setTimeout(() => {
    saveStatusEl.textContent = "Ready";
    saveStatusEl.style.color = "#006b3c";
    statusTimer = null;
  }, STATUS_VISIBLE_MS);
}

export function renderControls() {
  if (!hasAllControls()) return;

  controls.enableDeepReloadPage.checked = currentSettings.enableDeepReloadPage;
  controls.enableDeepReloadElement.checked = currentSettings.enableDeepReloadElement;
  controls.enableAutoReloadFallback.checked = currentSettings.enableAutoReloadFallback;
  controls.autoReloadIntervalSec.value = String(currentSettings.autoReloadIntervalSec);
  controls.autoReloadIntervalSec.disabled = !currentSettings.enableAutoReloadFallback;
  controls.enableElementHighlight.checked = currentSettings.enableElementHighlight;
  controls.enableToastNotification.checked = currentSettings.enableToastNotification;
  controls.toastDurationSec.value = String(currentSettings.toastDurationSec);
  controls.toastDurationSec.disabled = !currentSettings.enableToastNotification;
  controls.highlightColor.value = normalizeHighlightColor(currentSettings.highlightColor);
  controls.highlightColor.disabled = !currentSettings.enableElementHighlight;
}

async function persistCheckboxSetting(key, control) {
  try {
    await saveSettings({ [key]: control.checked });
    renderControls();
    showStatus("Saved");
  } catch (error) {
    console.error("WholePage: Failed to save setting", error);
    renderControls();
    showStatus("Save failed", true);
  }
}

async function persistNumericSetting(key, control, clampValue, fallbackValue) {
  try {
    const nextValue = clampValue(control.value);
    control.value = String(nextValue);
    await saveSettings({ [key]: nextValue });
    renderControls();
    showStatus("Saved");
  } catch (error) {
    console.error("WholePage: Failed to save setting", error);
    control.value = String(fallbackValue);
    showStatus("Save failed", true);
  }
}

export function installListeners() {
  if (!hasAllControls()) {
    console.error("WholePage: Settings controls are missing in settings.html");
    return;
  }

  addDomListener(controls.enableDeepReloadPage, "change", () => {
    void persistCheckboxSetting("enableDeepReloadPage", controls.enableDeepReloadPage);
  });

  addDomListener(controls.enableDeepReloadElement, "change", () => {
    void persistCheckboxSetting("enableDeepReloadElement", controls.enableDeepReloadElement);
  });

  addDomListener(controls.enableAutoReloadFallback, "change", () => {
    void persistCheckboxSetting("enableAutoReloadFallback", controls.enableAutoReloadFallback);
  });

  const persistAutoReloadInterval = () => persistNumericSetting(
    "autoReloadIntervalSec",
    controls.autoReloadIntervalSec,
    clampAutoReloadIntervalSec,
    currentSettings.autoReloadIntervalSec
  );

  addDomListener(controls.autoReloadIntervalSec, "change", () => {
    void persistAutoReloadInterval();
  });

  addDomListener(controls.autoReloadIntervalSec, "blur", () => {
    void persistAutoReloadInterval();
  });

  addDomListener(controls.enableToastNotification, "change", () => {
    void persistCheckboxSetting("enableToastNotification", controls.enableToastNotification);
  });

  addDomListener(controls.enableElementHighlight, "change", () => {
    void persistCheckboxSetting("enableElementHighlight", controls.enableElementHighlight);
  });

  const persistToastDuration = () => persistNumericSetting(
    "toastDurationSec",
    controls.toastDurationSec,
    clampToastDurationSec,
    currentSettings.toastDurationSec
  );

  addDomListener(controls.toastDurationSec, "change", () => {
    void persistToastDuration();
  });

  addDomListener(controls.toastDurationSec, "blur", () => {
    void persistToastDuration();
  });

  addDomListener(controls.highlightColor, "change", async () => {
    try {
      const nextColor = normalizeHighlightColor(controls.highlightColor.value);
      controls.highlightColor.value = nextColor;
      await saveSettings({ highlightColor: nextColor });
      renderControls();
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

    setCurrentSettings(sanitizeSettings(nextRawSettings));
    renderControls();
  });
}
