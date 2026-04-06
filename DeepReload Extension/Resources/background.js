//
//  background.js
//  DeepReload Extension
//
//  Created by Sedoykin Alexey on 27/03/2026.
//

const BUSTABLE_PROTOCOLS = new Set(["http:", "https:"]);
const MENU_WHOLE_PAGE_ID = "whole-page";
const MENU_ELEMENT_UNDER_CURSOR_ID = "element-under-cursor";
const MENU_AUTOMATIC_ROOT_ID = "automatic-root";
const MENU_AUTOMATIC_WHOLE_PAGE_ID = "automatic-whole-page";
const MENU_AUTOMATIC_ELEMENT_UNDER_CURSOR_ID = "automatic-element-under-cursor";
const MENU_AUTOMATIC_RESET_ID = "automatic-reset";
const AUTO_RELOAD_INTERVAL_MIN_SEC = 5;
const AUTO_RELOAD_INTERVAL_MAX_SEC = 3600;

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
let contextMenuUpdatePromise = Promise.resolve();
const BACKGROUND_RUNTIME_KEY = "__wholepage_background_runtime__";
const existingBackgroundRuntime = globalThis[BACKGROUND_RUNTIME_KEY];

if (existingBackgroundRuntime && typeof existingBackgroundRuntime.cleanup === "function") {
  try {
    existingBackgroundRuntime.cleanup();
  } catch (error) {
    console.warn("WholePage: Failed to clean up previous background runtime", error);
  }
}

const backgroundRuntime = {
  destroyed: false,
  listenerRemovers: [],
  cleanup: null
};

globalThis[BACKGROUND_RUNTIME_KEY] = backgroundRuntime;

function isBackgroundRuntimeActive() {
  return globalThis[BACKGROUND_RUNTIME_KEY] === backgroundRuntime && backgroundRuntime.destroyed !== true;
}

function addExtensionListener(eventSource, handler) {
  eventSource.addListener(handler);
  backgroundRuntime.listenerRemovers.push(() => {
    try {
      if (eventSource.hasListener?.(handler)) {
        eventSource.removeListener(handler);
      }
    } catch (error) {
      console.warn("WholePage: Failed to remove background listener", error);
    }
  });
}

function isMessageObject(value) {
  return value !== null && typeof value === "object";
}

function clampAutoReloadIntervalSec(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.autoReloadIntervalSec;
  return Math.min(AUTO_RELOAD_INTERVAL_MAX_SEC, Math.max(AUTO_RELOAD_INTERVAL_MIN_SEC, parsed));
}

function normalizeSettings(rawSettings) {
  return {
    enableDeepReloadPage: rawSettings.enableDeepReloadPage !== false,
    enableDeepReloadElement: rawSettings.enableDeepReloadElement !== false,
    enableAutoReloadFallback: rawSettings.enableAutoReloadFallback === true,
    autoReloadIntervalSec: clampAutoReloadIntervalSec(rawSettings.autoReloadIntervalSec),
    enableToastNotification: rawSettings.enableToastNotification !== false,
    toastDurationMs: Number.parseInt(rawSettings.toastDurationMs, 10) || DEFAULT_SETTINGS.toastDurationMs
  };
}

async function readSettings() {
  const stored = await browser.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  return normalizeSettings(stored);
}

async function replaceCurrentTabUrl(tabId, url) {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      func: (nextUrl) => {
        window.location.replace(nextUrl);
      },
      args: [url]
    });
    return true;
  } catch (error) {
    console.warn("WholePage: location.replace execution failed", error);
    return false;
  }
}

function buildCacheBustedUrl(rawUrl, timestamp) {
  if (!rawUrl) return null;

  try {
    const parsed = new URL(rawUrl);
    if (!BUSTABLE_PROTOCOLS.has(parsed.protocol)) return null;
    parsed.searchParams.set("deepreload", String(timestamp));
    return parsed.toString();
  } catch {
    return null;
  }
}

async function applyContextMenuSettingsInner() {
  const settings = await readSettings();
  if (!isBackgroundRuntimeActive()) return;

  await browser.contextMenus.removeAll();
  if (!isBackgroundRuntimeActive()) return;

  browser.contextMenus.create({
    id: MENU_WHOLE_PAGE_ID,
    title: "Whole Page",
    contexts: ["all"],
    enabled: settings.enableDeepReloadPage
  });

  browser.contextMenus.create({
    id: MENU_ELEMENT_UNDER_CURSOR_ID,
    title: "Element Under Cursor",
    contexts: ["all"],
    enabled: settings.enableDeepReloadElement
  });

  if (settings.enableAutoReloadFallback) {
    browser.contextMenus.create({
      id: MENU_AUTOMATIC_ROOT_ID,
      title: "Automatic",
      contexts: ["all"],
      enabled: settings.enableDeepReloadPage || settings.enableDeepReloadElement
    });

    browser.contextMenus.create({
      id: MENU_AUTOMATIC_WHOLE_PAGE_ID,
      parentId: MENU_AUTOMATIC_ROOT_ID,
      title: "Whole Page",
      contexts: ["all"],
      enabled: settings.enableDeepReloadPage
    });

    browser.contextMenus.create({
      id: MENU_AUTOMATIC_ELEMENT_UNDER_CURSOR_ID,
      parentId: MENU_AUTOMATIC_ROOT_ID,
      title: "Element Under Cursor",
      contexts: ["all"],
      enabled: settings.enableDeepReloadElement
    });

    browser.contextMenus.create({
      id: MENU_AUTOMATIC_RESET_ID,
      parentId: MENU_AUTOMATIC_ROOT_ID,
      title: "Reset",
      contexts: ["all"],
      enabled: true
    });
  }
}

function applyContextMenuSettings() {
  contextMenuUpdatePromise = contextMenuUpdatePromise
    .then(() => applyContextMenuSettingsInner())
    .catch((error) => {
      console.warn("WholePage: Failed to apply context menu settings", error);
    });

  return contextMenuUpdatePromise;
}

async function handleWholePageReload(tab, reportContext = null) {
  // Best-effort cleanup in the page context before full reload.
  try {
    const cleanupResult = await browser.tabs.sendMessage(tab.id, {
      action: "prepareWholePageReload",
      reportContext
    });
    if (cleanupResult) {
      console.log(
        `WholePage: Service workers unregistered=${cleanupResult.serviceWorkersUnregistered}, cache stores cleared=${cleanupResult.cacheStoresCleared}`
      );
    }
  } catch (error) {
    console.warn("WholePage: prepareWholePageReload message failed", error);
  }

  const cacheBustedUrl = buildCacheBustedUrl(tab.url, Date.now());

  if (cacheBustedUrl) {
    try {
      const replaced = await replaceCurrentTabUrl(tab.id, cacheBustedUrl);
      if (replaced) {
        return true;
      }

      await browser.tabs.update(tab.id, { url: cacheBustedUrl });
      return true;
    } catch (updateError) {
      console.warn("WholePage: cache-busted navigation failed, fallback to tabs.reload", updateError);
      try {
        await browser.tabs.reload(tab.id, { bypassCache: true });
        return true;
      } catch (reloadError) {
        console.warn("WholePage: tabs.reload failed after cache-busted navigation fallback", reloadError);
        return false;
      }
    }
  }

  // Fallback for unsupported URL schemes.
  try {
    await browser.tabs.reload(tab.id, { bypassCache: true });
    return true;
  } catch (error) {
    console.warn("WholePage: tabs.reload failed", error);
    return false;
  }
}

async function handleElementUnderCursorReload(tab) {
  // Tell content script to force-reload the element that was right-clicked
  try {
    return await browser.tabs.sendMessage(tab.id, { action: "reloadElementUnderCursor" });
  } catch (error) {
    console.warn("WholePage: reloadElementUnderCursor message failed", error);
    return {
      handled: false,
      fallbackToPageReload: true,
      reason: "content-script-unavailable"
    };
  }
}

async function toggleAutomaticReload(tab, mode, settings) {
  try {
    return await browser.tabs.sendMessage(tab.id, {
      action: "toggleAutomaticReload",
      mode,
      intervalMs: settings.autoReloadIntervalSec * 1000
    });
  } catch (error) {
    console.warn("WholePage: toggleAutomaticReload message failed", error);
    return null;
  }
}

async function resetAutomaticReload(tab) {
  try {
    return await browser.tabs.sendMessage(tab.id, {
      action: "resetAutomaticReload"
    });
  } catch (error) {
    console.warn("WholePage: resetAutomaticReload message failed", error);
    return null;
  }
}

async function handleContextMenuClicked(info, tab) {
  if (!isBackgroundRuntimeActive()) return;
  if (!tab || typeof tab.id !== "number") return;

  let settings;
  try {
    settings = await readSettings();
  } catch (error) {
    console.warn("WholePage: Failed to read settings on menu click", error);
    settings = normalizeSettings(DEFAULT_SETTINGS);
  }
  if (!isBackgroundRuntimeActive()) return;

  if (info.menuItemId === MENU_WHOLE_PAGE_ID) {
    if (!settings.enableDeepReloadPage) return;
    await handleWholePageReload(tab);
    return;
  }

  if (info.menuItemId === MENU_ELEMENT_UNDER_CURSOR_ID) {
    if (!settings.enableDeepReloadElement) return;
    const elementResult = await handleElementUnderCursorReload(tab);
    if (settings.enableAutoReloadFallback && elementResult?.fallbackToPageReload === true) {
      await handleWholePageReload(tab, {
        mode: "Element Under Cursor",
        note: "Fallback reloaded Whole Page"
      });
    }
    return;
  }

  if (info.menuItemId === MENU_AUTOMATIC_WHOLE_PAGE_ID) {
    if (!settings.enableDeepReloadPage) return;
    await toggleAutomaticReload(tab, "page", settings);
    return;
  }

  if (info.menuItemId === MENU_AUTOMATIC_ELEMENT_UNDER_CURSOR_ID) {
    if (!settings.enableDeepReloadElement) return;
    await toggleAutomaticReload(tab, "element", settings);
    return;
  }

  if (info.menuItemId === MENU_AUTOMATIC_RESET_ID) {
    await resetAutomaticReload(tab);
    return;
  }
}

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
      console.warn("WholePage: Failed to read settings for automatic whole-page reload", error);
      settings = normalizeSettings(DEFAULT_SETTINGS);
    }
    if (!isBackgroundRuntimeActive()) {
      return { triggered: false, reason: "runtime-inactive" };
    }

    if (!settings.enableDeepReloadPage) {
      return { triggered: false, reason: "page-reload-disabled" };
    }

    const didTrigger = await handleWholePageReload(sender.tab);
    return { triggered: didTrigger === true };
  })();
}

function handleStorageChanged(changes, areaName) {
  if (!isBackgroundRuntimeActive()) return;
  if (areaName !== "local") return;

  if (!("enableDeepReloadPage" in changes) &&
      !("enableDeepReloadElement" in changes) &&
      !("enableAutoReloadFallback" in changes)) {
    return;
  }

  void applyContextMenuSettings();
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
      console.warn("WholePage: Failed while disposing background listener", error);
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
