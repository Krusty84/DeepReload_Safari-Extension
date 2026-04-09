//
//  settings-schema.js
//  DeepReload Extension
//
//  Created by Sedoykin Alexey on 09/04/2026.
//

const DEEPRELOAD_SETTINGS_SCHEMA_KEY = "__deepreload_settings_schema__";

if (!globalThis[DEEPRELOAD_SETTINGS_SCHEMA_KEY]) {
  const TOAST_DURATION_MIN_SEC = 1;
  const TOAST_DURATION_MAX_SEC = 15;
  const AUTO_RELOAD_INTERVAL_MIN_SEC = 5;
  const AUTO_RELOAD_INTERVAL_MAX_SEC = 3600;
  const LEGACY_TOAST_DURATION_MS_KEY = "toastDurationMs";

  const DEFAULT_SETTINGS = {
    enableDeepReloadPage: true,
    enableDeepReloadElement: true,
    enableAutoReloadFallback: false,
    autoReloadIntervalSec: 30,
    enableElementHighlight: true,
    enableToastNotification: true,
    toastDurationSec: 5.5,
    highlightColor: "#ff00ff"
  };

  const STORAGE_KEYS = [
    ...Object.keys(DEFAULT_SETTINGS),
    LEGACY_TOAST_DURATION_MS_KEY
  ];

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
    const source = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
    return {
      enableDeepReloadPage: source.enableDeepReloadPage !== false,
      enableDeepReloadElement: source.enableDeepReloadElement !== false,
      enableAutoReloadFallback: source.enableAutoReloadFallback === true,
      autoReloadIntervalSec: clampAutoReloadIntervalSec(source.autoReloadIntervalSec),
      enableElementHighlight: source.enableElementHighlight !== false,
      enableToastNotification: source.enableToastNotification !== false,
      toastDurationSec: normalizeToastDurationSec(source),
      highlightColor: normalizeHighlightColor(source.highlightColor)
    };
  }

  async function readSettings() {
    const stored = await browser.storage.local.get(STORAGE_KEYS);
    return sanitizeSettings(stored);
  }

  async function saveSettings(partialSettings, currentSettings = DEFAULT_SETTINGS) {
    const mergedSettings = sanitizeSettings({
      ...currentSettings,
      ...partialSettings
    });

    await browser.storage.local.set(mergedSettings);
    await browser.storage.local.remove(LEGACY_TOAST_DURATION_MS_KEY);
    return mergedSettings;
  }

  globalThis[DEEPRELOAD_SETTINGS_SCHEMA_KEY] = Object.freeze({
    DEFAULT_SETTINGS: Object.freeze({ ...DEFAULT_SETTINGS }),
    LEGACY_TOAST_DURATION_MS_KEY,
    STORAGE_KEYS: Object.freeze([...STORAGE_KEYS]),
    clampToastDurationSec,
    clampAutoReloadIntervalSec,
    normalizeHighlightColor,
    sanitizeSettings,
    readSettings,
    saveSettings
  });
}
