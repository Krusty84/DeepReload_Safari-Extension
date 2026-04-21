//
//  background-actions.js
//  DeepReload Extension
//  Performs tab-level reload, navigation, and content-script action dispatch.
//
//  Created by Sedoykin Alexey on 27/03/2026.
//

import { BUSTABLE_PROTOCOLS } from "./background-core.js";

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
    console.warn("Deep Reload: location.replace execution failed", error);
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

export async function handleWholePageReload(tab, reportContext = null) {
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
    console.warn("Deep Reload: prepareWholePageReload message failed", error);
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
      console.warn("Deep Reload: cache-busted navigation failed, fallback to tabs.reload", updateError);
      try {
        await browser.tabs.reload(tab.id, { bypassCache: true });
        return true;
      } catch (reloadError) {
        console.warn("Deep Reload: tabs.reload failed after cache-busted navigation fallback", reloadError);
        return false;
      }
    }
  }

  try {
    await browser.tabs.reload(tab.id, { bypassCache: true });
    return true;
  } catch (error) {
    console.warn("Deep Reload: tabs.reload failed", error);
    return false;
  }
}

export async function handleElementUnderCursorReload(tab) {
  try {
    return await browser.tabs.sendMessage(tab.id, { action: "reloadElementUnderCursor" });
  } catch (error) {
    console.warn("Deep Reload: reloadElementUnderCursor message failed", error);
    return {
      handled: false,
      fallbackToPageReload: true,
      reason: "content-script-unavailable"
    };
  }
}

export async function toggleAutomaticReload(tab, settings) {
  try {
    return await browser.tabs.sendMessage(tab.id, {
      action: "toggleAutomaticReload",
      mode: "page",
      intervalMs: settings.autoReloadIntervalSec * 1000
    });
  } catch (error) {
    console.warn("Deep Reload: toggleAutomaticReload message failed", error);
    return null;
  }
}

export async function resetAutomaticReload(tab) {
  try {
    return await browser.tabs.sendMessage(tab.id, {
      action: "resetAutomaticReload"
    });
  } catch (error) {
    console.warn("Deep Reload: resetAutomaticReload message failed", error);
    return null;
  }
}
