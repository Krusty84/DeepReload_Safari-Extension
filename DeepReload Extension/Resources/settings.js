//
//  settings.js
//  DeepReload Extension
//
//  Created by Sedoykin Alexey on 27/03/2026.
//

import {
  DEFAULT_SETTINGS,
  SETTINGS_RUNTIME_KEY,
  isSettingsRuntimeActive,
  readSettings,
  setCurrentSettings,
  settingsRuntime
} from "./settings-core.js";
import {
  clearStatusTimer,
  installListeners,
  renderControls,
  showStatus
} from "./settings-form.js";

async function init() {
  try {
    setCurrentSettings(await readSettings());
    if (!isSettingsRuntimeActive()) return;
    renderControls();
  } catch (error) {
    console.error("WholePage: Failed to load settings", error);
    if (!isSettingsRuntimeActive()) return;
    setCurrentSettings({ ...DEFAULT_SETTINGS });
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
  clearStatusTimer();

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
