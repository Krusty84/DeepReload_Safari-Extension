//
//  content-reload.js
//  DeepReload Extension
//  Handles reload messages and performs page or element resource refreshes.
//
//  Created by Sedoykin Alexey on 27/03/2026.
//

function shouldBustUrl(url) {
  if (!url) return false;

  const normalized = String(url).trim().toLowerCase();
  if (!normalized) return false;

  if (normalized.startsWith("data:")) return false;
  if (normalized.startsWith("blob:")) return false;
  if (normalized.startsWith("javascript:")) return false;
  if (normalized.startsWith("about:")) return false;

  return true;
}

function rewriteUrlString(rawValue, timestamp) {
  if (typeof rawValue !== "string" || !rawValue.includes("url(")) {
    return rawValue;
  }

  return rawValue.replace(/url\((['"]?)(.*?)\1\)/gi, (match, quote, rawUrl) => {
    if (!shouldBustUrl(rawUrl)) return match;
    const updatedUrl = bustCacheUrl(rawUrl, timestamp);
    if (updatedUrl === rawUrl) return match;
    return `url("${updatedUrl}")`;
  });
}

function bustCacheUrl(url, timestamp) {
  if (!shouldBustUrl(url)) return url;

  try {
    const parsed = new URL(url, document.baseURI);
    if (!BUSTABLE_PROTOCOLS.has(parsed.protocol)) return url;
    parsed.searchParams.set("deepreload", String(timestamp));
    return parsed.toString();
  } catch {
    return url;
  }
}

function bustSrcset(srcset, timestamp) {
  if (!srcset) return srcset;

  const candidates = srcset.split(",");
  const rewritten = candidates.map((candidate) => {
    const trimmed = candidate.trim();
    if (!trimmed) return trimmed;

    const separator = trimmed.search(/\s/);
    if (separator === -1) {
      return bustCacheUrl(trimmed, timestamp);
    }

    const candidateUrl = trimmed.slice(0, separator);
    const descriptor = trimmed.slice(separator);
    return `${bustCacheUrl(candidateUrl, timestamp)}${descriptor}`;
  });

  return rewritten.join(", ");
}

function rewriteInlineStyleUrlProperty(style, property, timestamp) {
  if (!style || !style[property]) return false;

  const original = style[property];
  const rewritten = rewriteUrlString(original, timestamp);

  if (rewritten === original) return false;

  style[property] = rewritten;
  return true;
}

function elementHasReloadableStyleUrls(element) {
  if (!(element instanceof Element)) return false;

  const inlineStyle = element instanceof HTMLElement || element instanceof SVGElement
    ? element.style
    : null;
  const computedStyle = typeof getComputedStyle === "function" ? getComputedStyle(element) : null;

  return URL_STYLE_PROPERTIES.some((property) => {
    const inlineValue = inlineStyle?.[property];
    if (typeof inlineValue === "string" && inlineValue.includes("url(")) {
      return true;
    }

    const computedValue = computedStyle?.[property];
    return typeof computedValue === "string" && computedValue.includes("url(");
  });
}

function rewriteElementStyleUrls(element, timestamp) {
  if (!(element instanceof Element)) return false;

  const inlineStyle = element instanceof HTMLElement || element instanceof SVGElement
    ? element.style
    : null;
  const computedStyle = typeof getComputedStyle === "function" ? getComputedStyle(element) : null;

  let changed = false;

  URL_STYLE_PROPERTIES.forEach((property) => {
    if (inlineStyle && rewriteInlineStyleUrlProperty(inlineStyle, property, timestamp)) {
      changed = true;
      return;
    }

    const computedValue = computedStyle?.[property];
    if (typeof computedValue !== "string" || !computedValue.includes("url(")) {
      return;
    }

    const rewrittenComputed = rewriteUrlString(computedValue, timestamp);
    if (rewrittenComputed === computedValue || !inlineStyle) {
      return;
    }

    inlineStyle[property] = rewrittenComputed;
    changed = true;
  });

  return changed;
}

function rewriteElementTreeStyleUrls(rootElement, timestamp) {
  if (!(rootElement instanceof Element)) return 0;

  const allElements = collectElementSubtree(rootElement);
  let updatedCount = 0;

  allElements.forEach((node) => {
    if (rewriteElementStyleUrls(node, timestamp)) {
      updatedCount++;
    }
  });

  return updatedCount;
}

function getSvgResourceAttribute(target) {
  if (!(target instanceof SVGElement)) return null;

  const href = target.getAttribute("href");
  if (href) {
    return { name: "href", value: href };
  }

  const xlinkHref = target.getAttributeNS("http://www.w3.org/1999/xlink", "href");
  if (xlinkHref) {
    return { name: "href", namespace: "http://www.w3.org/1999/xlink", value: xlinkHref };
  }

  return null;
}

function isReloadableMediaTarget(target) {
  if (!(target instanceof Element)) return false;

  const tagName = target.tagName;
  if (tagName === "IMG" || tagName === "VIDEO" || tagName === "AUDIO" || tagName === "IFRAME") {
    return true;
  }

  if (tagName === "OBJECT" && typeof target.data === "string" && shouldBustUrl(target.data)) {
    return true;
  }

  if (tagName === "EMBED" && typeof target.src === "string" && shouldBustUrl(target.src)) {
    return true;
  }

  return getSvgResourceAttribute(target) !== null;
}

function hasRefreshableContent(rootElement) {
  if (!(rootElement instanceof Element)) return false;

  return collectElementSubtree(rootElement).some((element) => (
    isReloadableMediaTarget(element) || elementHasReloadableStyleUrls(element)
  ));
}

function resolveNearestRefreshRoot(element) {
  let candidate = resolveElementTarget(element);

  while (candidate && !isPageSurfaceElement(candidate)) {
    if (hasRefreshableContent(candidate)) {
      return candidate;
    }

    candidate = getParentElementAcrossShadowBoundary(candidate);
  }

  return resolveElementTarget(element);
}

async function prepareWholePageReload(reportContext = null) {
  if (!isRuntimeActive()) {
    return {
      serviceWorkersUnregistered: 0,
      cacheStoresCleared: 0
    };
  }

  cleanupTransientReferences();

  const result = {
    serviceWorkersUnregistered: 0,
    cacheStoresCleared: 0
  };

  try {
    if ("serviceWorker" in navigator && typeof navigator.serviceWorker.getRegistrations === "function") {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        try {
          const removed = await registration.unregister();
          if (removed) result.serviceWorkersUnregistered++;
        } catch (error) {
          console.warn("Deep Reload: Failed to unregister Service Worker", error);
        }
      }
    }
  } catch (error) {
    console.warn("Deep Reload: Service Worker cleanup failed", error);
  }

  try {
    if ("caches" in window && typeof caches.keys === "function") {
      const keys = await caches.keys();
      for (const key of keys) {
        try {
          const removed = await caches.delete(key);
          if (removed) result.cacheStoresCleared++;
        } catch (error) {
          console.warn("Deep Reload: Failed to clear cache store", key, error);
        }
      }
    }
  } catch (error) {
    console.warn("Deep Reload: Cache API cleanup failed", error);
  }

  const normalizedReportContext = normalizeReportContext(reportContext);
  const report = {
    mode: normalizedReportContext?.mode || "Whole Page",
    serviceWorkersUnregistered: result.serviceWorkersUnregistered,
    cacheStoresCleared: result.cacheStoresCleared,
    createdAt: Date.now()
  };

  if (normalizedReportContext?.note) {
    report.note = normalizedReportContext.note;
  }

  if (normalizedReportContext?.suppressReport === true) {
    clearPendingPageReport();
  } else {
    savePendingPageReport(report);
    showNotification(report);
  }

  return result;
}

function handleRuntimeMessage(message) {
  if (!isRuntimeActive()) return;
  if (!isMessageObject(message)) return;

  if (message.action === "reloadElementUnderCursor") {
    if (!runtimeSettings.enableDeepReloadElement) {
      return {
        handled: false,
        fallbackToPageReload: false,
        reason: "element-reload-disabled"
      };
    }

    return reloadElementUnderCursor(resolveCurrentSelectedElement(), {
      automatic: message.automatic === true
    });
  }

  if (message.action === "toggleAutomaticReload") {
    return toggleAutomaticReload(message.mode, message.intervalMs);
  }

  if (message.action === "resetAutomaticReload") {
    return resetAutomaticReload();
  }

  if (message.action === "prepareWholePageReload") {
    if (!runtimeSettings.enableDeepReloadPage) {
      return {
        serviceWorkersUnregistered: 0,
        cacheStoresCleared: 0
      };
    }
    return prepareWholePageReload(message.reportContext);
  }
}

function handleStorageChanged(changes, areaName) {
  if (!isRuntimeActive()) return;
  if (areaName !== "local") return;

  const relevantSettings = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (!changes[key]) continue;
    relevantSettings[key] = changes[key].newValue;
  }

  if (Object.keys(relevantSettings).length === 0) return;
  applyRuntimeSettingsPatch(relevantSettings);
}

function registerRuntimeListeners() {
  addDomListener(document, "contextmenu", handleDocumentContextMenu, true);
  addDomListener(document, "mousedown", handleDocumentMouseDown, true);
  addDomListener(window, "scroll", handleHighlightViewportChange, { capture: true, passive: true });
  addDomListener(window, "resize", handleHighlightViewportChange, { passive: true });
  addDomListener(window, "pageshow", handleHighlightViewportChange);
  addDomListener(document, "visibilitychange", handleDocumentVisibilityChange);
  addExtensionListener(browser.runtime.onMessage, handleRuntimeMessage);
  addExtensionListener(browser.storage.onChanged, handleStorageChanged);
}

async function initializeRuntimeState() {
  await loadSettingsFromStorage();
  if (!isRuntimeActive()) return;
  consumePendingAutoPageBlink();
  restoreAutomaticPageReloadState();
  consumePendingPageReport();
}

function disposeContentRuntime() {
  if (contentRuntime.destroyed) {
    return;
  }

  contentRuntime.destroyed = true;

  stopAutomaticReload({ clearPersistedState: false });
  clearSelectedElement();

  if (reloadIndicatorTimer) {
    clearInterval(reloadIndicatorTimer);
    reloadIndicatorTimer = null;
  }
  reloadIndicatorHideTimer = clearManagedTimeout(reloadIndicatorHideTimer);
  debugReportHideTimer = clearManagedTimeout(debugReportHideTimer);
  debugReportFadeTimer = clearManagedTimeout(debugReportFadeTimer);
  clearAllManagedTimeouts();
  clearAutomaticReloadCountdownTimer();
  stopHighlightTracking();
  clearHighlightOverlayRoot();
  hideAutomaticReloadBanner();

  if (highlightOverlayRoot?.parentNode) {
    highlightOverlayRoot.parentNode.removeChild(highlightOverlayRoot);
  }
  if (automaticReloadBannerElement?.parentNode) {
    automaticReloadBannerElement.parentNode.removeChild(automaticReloadBannerElement);
  }
  if (reloadIndicatorElement?.parentNode) {
    reloadIndicatorElement.parentNode.removeChild(reloadIndicatorElement);
  }
  if (debugReportElement?.parentNode) {
    debugReportElement.parentNode.removeChild(debugReportElement);
  }

  highlightOverlayRoot = null;
  automaticReloadBannerElement = null;
  reloadIndicatorElement = null;
  debugReportElement = null;
  activeIndicatorSessionId = 0;

  const removers = contentRuntime.listenerRemovers.splice(0);
  removers.reverse().forEach((removeListener) => {
    try {
      removeListener();
    } catch (error) {
      console.warn("Deep Reload: Failed while disposing content listener", error);
    }
  });

  if (globalThis[CONTENT_RUNTIME_KEY] === contentRuntime) {
    delete globalThis[CONTENT_RUNTIME_KEY];
  }
}

contentRuntime.cleanup = disposeContentRuntime;

function waitForReloadCompletion(target) {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(finish, 8000);
    const tagName = target.tagName;
    const doneEvent = (tagName === "VIDEO" || tagName === "AUDIO") ? "loadeddata" : "load";

    function cleanup() {
      clearTimeout(timeoutId);
      target.removeEventListener(doneEvent, finish);
      target.removeEventListener("error", finish);
    }

    function finish() {
      cleanup();
      resolve();
    }

    target.addEventListener(doneEvent, finish, { once: true });
    target.addEventListener("error", finish, { once: true });
  });
}

function reloadMediaElement(target, timestamp) {
  if (!target) return null;

  const tagName = target.tagName;
  if (
    tagName !== "IMG" &&
    tagName !== "VIDEO" &&
    tagName !== "AUDIO" &&
    tagName !== "IFRAME" &&
    tagName !== "OBJECT" &&
    tagName !== "EMBED" &&
    !(target instanceof SVGElement)
  ) {
    return null;
  }

  let completion = null;
  const ensureCompletionTracking = () => {
    if (!completion) {
      completion = waitForReloadCompletion(target);
    }
  };

  let hasAnyUpdate = false;

  if (tagName === "IMG") {
    if (target.srcset) {
      const updatedSrcset = bustSrcset(target.srcset, timestamp);
      if (updatedSrcset !== target.srcset) {
        ensureCompletionTracking();
        target.srcset = updatedSrcset;
        hasAnyUpdate = true;
      }
    }

    if (target.src) {
      const updatedSrc = bustCacheUrl(target.src, timestamp);
      if (updatedSrc !== target.src) {
        ensureCompletionTracking();
        target.src = updatedSrc;
        hasAnyUpdate = true;
      }
    }

    const pictureSources = target.parentElement?.tagName === "PICTURE"
      ? target.parentElement.querySelectorAll("source")
      : [];

    pictureSources.forEach((sourceNode) => {
      if (sourceNode.srcset) {
        const updatedSrcset = bustSrcset(sourceNode.srcset, timestamp);
        if (updatedSrcset !== sourceNode.srcset) {
          ensureCompletionTracking();
          sourceNode.srcset = updatedSrcset;
          hasAnyUpdate = true;
        }
      }
      if (sourceNode.src) {
        const updatedSrc = bustCacheUrl(sourceNode.src, timestamp);
        if (updatedSrc !== sourceNode.src) {
          ensureCompletionTracking();
          sourceNode.src = updatedSrc;
          hasAnyUpdate = true;
        }
      }
    });
  }

  if (tagName === "VIDEO" || tagName === "AUDIO") {
    if (target.src) {
      const updatedSrc = bustCacheUrl(target.src, timestamp);
      if (updatedSrc !== target.src) {
        ensureCompletionTracking();
        target.src = updatedSrc;
        hasAnyUpdate = true;
      }
    }

    target.querySelectorAll("source").forEach((sourceNode) => {
      if (!sourceNode.src) return;
      const updatedSrc = bustCacheUrl(sourceNode.src, timestamp);
      if (updatedSrc !== sourceNode.src) {
        ensureCompletionTracking();
        sourceNode.src = updatedSrc;
        hasAnyUpdate = true;
      }
    });

    if (tagName === "VIDEO" && target.poster) {
      const updatedPoster = bustCacheUrl(target.poster, timestamp);
      if (updatedPoster !== target.poster) {
        ensureCompletionTracking();
        target.poster = updatedPoster;
        hasAnyUpdate = true;
      }
    }

    if (hasAnyUpdate) {
      target.load();
    }
  }

  if (tagName === "IFRAME" && target.src) {
    const updatedSrc = bustCacheUrl(target.src, timestamp);
    if (updatedSrc !== target.src) {
      ensureCompletionTracking();
      target.src = updatedSrc;
      hasAnyUpdate = true;
    }
  }

  if (tagName === "OBJECT" && typeof target.data === "string") {
    const updatedData = bustCacheUrl(target.data, timestamp);
    if (updatedData !== target.data) {
      completion = Promise.resolve();
      target.data = updatedData;
      hasAnyUpdate = true;
    }
  }

  if (tagName === "EMBED" && typeof target.src === "string") {
    const updatedSrc = bustCacheUrl(target.src, timestamp);
    if (updatedSrc !== target.src) {
      completion = Promise.resolve();
      target.src = updatedSrc;
      hasAnyUpdate = true;
    }
  }

  const svgResourceAttribute = getSvgResourceAttribute(target);
  if (svgResourceAttribute?.value) {
    const updatedHref = bustCacheUrl(svgResourceAttribute.value, timestamp);
    if (updatedHref !== svgResourceAttribute.value) {
      completion = Promise.resolve();
      if (svgResourceAttribute.namespace) {
        target.setAttributeNS(svgResourceAttribute.namespace, svgResourceAttribute.name, updatedHref);
      } else {
        target.setAttribute(svgResourceAttribute.name, updatedHref);
      }
      hasAnyUpdate = true;
    }
  }

  if (!hasAnyUpdate) return null;

  return completion;
}

async function reloadElementUnderCursor(element, options = {}) {
  if (!isRuntimeActive()) {
    return {
      handled: false,
      fallbackToPageReload: false,
      reason: "runtime-inactive"
    };
  }

  const automatic = options.automatic === true;
  const clickedElement = resolveElementTarget(element);
  const targetElement = resolveNearestRefreshRoot(clickedElement);
  const targetResolvedUpward =
    clickedElement instanceof Element &&
    targetElement instanceof Element &&
    targetElement !== clickedElement;
  const reloadTargetNote = targetResolvedUpward
    ? `Refreshed nearest reloadable ancestor: ${targetElement.tagName.toLowerCase()}`
    : null;

  if (!runtimeSettings.enableDeepReloadElement) {
    cleanupTransientReferences();
    return {
      handled: false,
      fallbackToPageReload: false,
      reason: "element-reload-disabled"
    };
  }

  if (!targetElement) {
    console.log("WholePage: No element found");
    cleanupTransientReferences();
    return {
      handled: false,
      fallbackToPageReload: true,
      reason: "no-element-under-cursor"
    };
  }

  if (!targetElement.isConnected) {
    cleanupTransientReferences();
    return {
      handled: false,
      fallbackToPageReload: true,
      reason: "element-no-longer-in-dom"
    };
  }

  if (isPageSurfaceElement(targetElement)) {
    cleanupTransientReferences();
    return {
      handled: false,
      fallbackToPageReload: true,
      reason: "page-surface-click"
    };
  }

  const reloadSessionId = ++activeReloadSessionId;
  showReloadIndicator(reloadSessionId);

  try {
    const timestamp = Date.now();
    let reloadedMediaCount = 0;
    // Command-only visuals should match the selected element, not the larger resolved reload ancestor.
    const preUpdateBlinkTarget =
      clickedElement instanceof Element && clickedElement.isConnected
        ? clickedElement
        : targetElement;
    const hasRefreshableTarget = hasRefreshableContent(targetElement);
    const shouldBlinkBeforeUpdate =
      !automatic &&
      usesCommandBlinkElementSelectionVisuals() &&
      hasRefreshableTarget;
    const shouldHighlightDuringUpdate =
      !automatic &&
      usesCommandPersistentElementSelectionVisuals() &&
      hasRefreshableTarget;

    if (shouldBlinkBeforeUpdate) {
      blinkElement(preUpdateBlinkTarget);
      await waitForManagedDelay(ELEMENT_SELECTION_BLINK_LEAD_IN_MS);
    }

    if (shouldHighlightDuringUpdate) {
      // The finally cleanup below removes this half-mode highlight when the reload flow completes.
      clearSelectionVisual();
      currentHighlightedElement = preUpdateBlinkTarget;
      syncHighlightOverlay();
    }

    const directReload = reloadMediaElement(targetElement, timestamp);
    if (directReload) {
      console.log(`WholePage: Reloaded ${targetElement.tagName}`);
      await directReload;
      if (automatic) {
        blinkElement(targetElement);
      }
      showNotification({
        mode: "Element Under Cursor",
        mediaReloaded: 1,
        inlineStylesUpdated: 0,
        note: reloadTargetNote
      });
      return {
        handled: true,
        fallbackToPageReload: false,
        reason: "single-media-reloaded"
      };
    }

    const refreshableElements = collectElementSubtree(targetElement).filter((elementNode) => (
      elementNode !== targetElement && isReloadableMediaTarget(elementNode)
    ));

    const completionPromises = [];

    refreshableElements.forEach((elementNode) => {
      const completion = reloadMediaElement(elementNode, timestamp);
      if (completion) {
        completionPromises.push(completion);
        reloadedMediaCount++;
      }
    });

    const updatedInlineStyleCount = rewriteElementTreeStyleUrls(targetElement, timestamp);
    const handledAnyReload = reloadedMediaCount > 0 || updatedInlineStyleCount > 0;

    console.log(
      `WholePage: Reloaded ${reloadedMediaCount} media elements and updated ${updatedInlineStyleCount} inline style blocks inside the selection`
    );

    if (!handledAnyReload) {
      if (!automatic) {
        showNotification({
          mode: "Element Under Cursor",
          mediaReloaded: 0,
          inlineStylesUpdated: 0,
          note: buildStaticElementRefreshNote(targetElement)
        });
      }

      return {
        handled: false,
        fallbackToPageReload: automatic,
        reason: automatic ? "no-reloadable-resources" : "static-element-not-refreshable",
        mediaReloaded: 0,
        inlineStylesUpdated: 0
      };
    }

    if (completionPromises.length > 0) {
      await Promise.allSettled(completionPromises);
    }

    if (automatic) {
      blinkElement(targetElement);
    }
    showNotification({
      mode: "Element Under Cursor",
      mediaReloaded: reloadedMediaCount,
      inlineStylesUpdated: updatedInlineStyleCount,
      note: reloadTargetNote
    });

    return {
      handled: true,
      fallbackToPageReload: false,
      reason: "container-reloaded",
      mediaReloaded: reloadedMediaCount,
      inlineStylesUpdated: updatedInlineStyleCount
    };
  } finally {
    hideReloadIndicatorIfCurrent(reloadSessionId);
    cleanupTransientReferences();
  }
}

registerRuntimeListeners();
void initializeRuntimeState();
