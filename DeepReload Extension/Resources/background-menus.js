//
//  background-menus.js
//  DeepReload Extension
//  Builds context menus and routes menu clicks to background actions.
//
//  Created by Sedoykin Alexey on 27/03/2026.
//

import {
  DEFAULT_SETTINGS,
  MENU_AUTOMATIC_RESET_ID,
  MENU_AUTOMATIC_ROOT_ID,
  MENU_AUTOMATIC_WHOLE_PAGE_ID,
  MENU_ELEMENT_UNDER_CURSOR_ID,
  MENU_WHOLE_PAGE_ID,
  isBackgroundRuntimeActive,
  normalizeSettings,
  readSettings
} from "./background-core.js";
import {
  handleElementUnderCursorReload,
  handleWholePageReload,
  resetAutomaticReload,
  toggleAutomaticReload
} from "./background-actions.js";

let contextMenuUpdatePromise = Promise.resolve();

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

  if (settings.enableDeepReloadElement) {
    browser.contextMenus.create({
      id: MENU_ELEMENT_UNDER_CURSOR_ID,
      title: "Element Under Cursor",
      contexts: ["all"],
      enabled: true
    });
  }

  if (settings.enableAutoReloadFallback) {
    browser.contextMenus.create({
      id: MENU_AUTOMATIC_ROOT_ID,
      title: "Automatic Whole Page",
      contexts: ["all"],
      enabled: settings.enableDeepReloadPage
    });

    browser.contextMenus.create({
      id: MENU_AUTOMATIC_WHOLE_PAGE_ID,
      parentId: MENU_AUTOMATIC_ROOT_ID,
      title: "Start",
      contexts: ["all"],
      enabled: settings.enableDeepReloadPage
    });

    browser.contextMenus.create({
      id: MENU_AUTOMATIC_RESET_ID,
      parentId: MENU_AUTOMATIC_ROOT_ID,
      title: "Stop",
      contexts: ["all"],
      enabled: true
    });
  }
}

export function applyContextMenuSettings() {
  contextMenuUpdatePromise = contextMenuUpdatePromise
    .then(() => applyContextMenuSettingsInner())
    .catch((error) => {
      console.warn("Deep Reload: Failed to apply context menu settings", error);
    });

  return contextMenuUpdatePromise;
}

export async function handleContextMenuClicked(info, tab) {
  if (!isBackgroundRuntimeActive()) return;
  if (!tab || typeof tab.id !== "number") return;

  let settings;
  try {
    settings = await readSettings();
  } catch (error) {
    console.warn("Deep Reload: Failed to read settings on menu click", error);
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
    await handleElementUnderCursorReload(tab);
    return;
  }

  if (info.menuItemId === MENU_AUTOMATIC_WHOLE_PAGE_ID) {
    if (!settings.enableDeepReloadPage) return;
    await toggleAutomaticReload(tab, settings);
    return;
  }

  if (info.menuItemId === MENU_AUTOMATIC_RESET_ID) {
    await resetAutomaticReload(tab);
  }
}

export function handleStorageChanged(changes, areaName) {
  if (!isBackgroundRuntimeActive()) return;
  if (areaName !== "local") return;

  if (!("enableDeepReloadPage" in changes) &&
      !("enableDeepReloadElement" in changes) &&
      !("enableAutoReloadFallback" in changes)) {
    return;
  }

  void applyContextMenuSettings();
}
