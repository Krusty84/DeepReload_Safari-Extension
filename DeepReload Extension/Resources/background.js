//
//  background.js
//  DeepReload Extension
//
//  Created by Sedoykin Alexey on 27/03/2026.
//

import {
  BACKGROUND_RUNTIME_KEY,
  DEFAULT_SETTINGS,
  addExtensionListener,
  backgroundRuntime,
  isBackgroundRuntimeActive,
  isMessageObject,
  normalizeSettings,
  readSettings
} from "./background-core.js";
import { handleWholePageReload } from "./background-actions.js";
import {
  applyContextMenuSettings,
  handleContextMenuClicked,
  handleStorageChanged
} from "./background-menus.js";

function handleRuntimeMessage(message, sender) {
  if (!isBackgroundRuntimeActive()) return;
  if (!isMessageObject(message)) return;
  if (message.action !== "triggerAutoWholePageReload") return;
  if (!sender.tab || typeof sender.tab.id !== "number") return;

  return (async () => {
    let settings;
    try {
      settings = await readSettings();
    } catch (error) {
      console.warn("Deep Reload: Failed to read settings for automatic whole-page reload", error);
      settings = normalizeSettings(DEFAULT_SETTINGS);
    }
    if (!isBackgroundRuntimeActive()) {
      return { triggered: false, reason: "runtime-inactive" };
    }

    if (!settings.enableDeepReloadPage) {
      return { triggered: false, reason: "page-reload-disabled" };
    }

    const didTrigger = await handleWholePageReload(sender.tab, {
      mode: "Automatic",
      suppressReport: true
    });
    return { triggered: didTrigger === true };
  })();
}

function handleInstalled() {
  if (!isBackgroundRuntimeActive()) return;
  void applyContextMenuSettings();
}

function disposeBackgroundRuntime() {
  if (backgroundRuntime.destroyed) {
    return;
  }

  backgroundRuntime.destroyed = true;

  const removers = backgroundRuntime.listenerRemovers.splice(0);
  removers.reverse().forEach((removeListener) => {
    try {
      removeListener();
    } catch (error) {
      console.warn("Deep Reload: Failed while disposing background listener", error);
    }
  });

  if (globalThis[BACKGROUND_RUNTIME_KEY] === backgroundRuntime) {
    delete globalThis[BACKGROUND_RUNTIME_KEY];
  }
}

function registerBackgroundListeners() {
  addExtensionListener(browser.contextMenus.onClicked, handleContextMenuClicked);
  addExtensionListener(browser.runtime.onMessage, handleRuntimeMessage);
  addExtensionListener(browser.storage.onChanged, handleStorageChanged);
  addExtensionListener(browser.runtime.onInstalled, handleInstalled);
}

backgroundRuntime.cleanup = disposeBackgroundRuntime;

registerBackgroundListeners();

void applyContextMenuSettings();
