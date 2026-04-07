//
//  content.js
//  DeepReload Extension
//
//  Created by Sedoykin Alexey on 27/03/2026.
//

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
let automaticReloadElementLocator = null;
let automaticReloadToken = 0;
const managedTimeoutIds = new Set();
const CONTENT_RUNTIME_KEY = "__wholepage_content_runtime__";
const existingContentRuntime = globalThis[CONTENT_RUNTIME_KEY];

if (existingContentRuntime && typeof existingContentRuntime.cleanup === "function") {
  try {
    existingContentRuntime.cleanup();
  } catch (error) {
    console.warn("WholePage: Failed to clean up previous content runtime", error);
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
const TOAST_DURATION_MIN_MS = 1000;
const TOAST_DURATION_MAX_MS = 15000;
const AUTO_RELOAD_INTERVAL_MIN_SEC = 5;
const AUTO_RELOAD_INTERVAL_MAX_SEC = 3600;
const AUTO_PAGE_BLINK_MAX_AGE_MS = 20000;
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
      console.warn("WholePage: Failed to remove extension listener", error);
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

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function resolveElementTarget(target) {
  if (target instanceof ShadowRoot) return target.host;
  if (target instanceof Element) return target;
  if (target instanceof Node && target.parentElement) return target.parentElement;
  return null;
}

function resolveEventElementTarget(event) {
  if (typeof event.composedPath === "function") {
    const path = event.composedPath();
    for (const entry of path) {
      const resolved = resolveElementTarget(entry);
      if (resolved) {
        return resolved;
      }
    }
  }

  return resolveElementTarget(event.target);
}

function getParentElementAcrossShadowBoundary(element) {
  if (!(element instanceof Element)) return null;
  if (element.parentElement) return element.parentElement;

  const rootNode = typeof element.getRootNode === "function" ? element.getRootNode() : null;
  if (rootNode instanceof ShadowRoot) {
    return rootNode.host;
  }

  return null;
}

function createElementLocator(element) {
  const resolvedElement = resolveElementTarget(element);
  if (!(resolvedElement instanceof Element)) return null;

  const segments = [];
  let current = resolvedElement;

  while (current && current !== document.documentElement) {
    if (current.parentElement) {
      const index = Array.prototype.indexOf.call(current.parentElement.children, current);
      if (index < 0) return null;

      segments.push({
        scope: "light",
        index,
        tagName: current.tagName
      });
      current = current.parentElement;
      continue;
    }

    const rootNode = typeof current.getRootNode === "function" ? current.getRootNode() : null;
    if (rootNode instanceof ShadowRoot && rootNode.host instanceof Element) {
      const index = Array.prototype.indexOf.call(rootNode.children, current);
      if (index < 0) return null;

      segments.push({
        scope: "shadow",
        index,
        tagName: current.tagName
      });
      current = rootNode.host;
      continue;
    }

    return null;
  }

  return {
    segments: segments.reverse()
  };
}

function resolveElementLocator(locator) {
  if (!locator || !Array.isArray(locator.segments)) return null;

  let current = document.documentElement;

  for (const segment of locator.segments) {
    if (!current) return null;

    if (segment.scope === "light") {
      current = current.children?.[segment.index] || null;
    } else if (segment.scope === "shadow") {
      current = current.shadowRoot?.children?.[segment.index] || null;
    } else {
      return null;
    }

    if (!(current instanceof Element)) {
      return null;
    }

    if (segment.tagName && current.tagName !== segment.tagName) {
      return null;
    }
  }

  return current instanceof Element ? current : null;
}

function resolveCurrentSelectedElement() {
  if (currentHighlightedElement instanceof Element && currentHighlightedElement.isConnected) {
    return currentHighlightedElement;
  }

  return resolveElementLocator(lastSelectedElementLocator);
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

function hexToRgb(hexColor) {
  const normalized = normalizeHighlightColor(hexColor).slice(1);
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
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
    if (automaticReloadMode === "element") {
      stopAutomaticReload();
    }
  }

  if (!runtimeSettings.enableDeepReloadPage && automaticReloadMode === "page") {
    stopAutomaticReload();
  }

  if (!runtimeSettings.enableElementHighlight) {
    removeHighlight();
  }

  if (!runtimeSettings.enableAutoReloadFallback) {
    stopAutomaticReload();
  }

  if (runtimeSettings.enableDeepReloadElement && runtimeSettings.enableElementHighlight && currentHighlightedElement) {
    syncHighlightOverlay();
  }
}

async function loadSettingsFromStorage() {
  try {
    const stored = await browser.storage.local.get(Object.keys(DEFAULT_SETTINGS));
    if (!isRuntimeActive()) return;
    applyRuntimeSettingsPatch(stored);
  } catch (error) {
    console.warn("WholePage: Failed to load runtime settings", error);
    if (!isRuntimeActive()) return;
    applyRuntimeSettingsPatch(DEFAULT_SETTINGS);
  }
}

function ensureHighlightOverlayRoot() {
  if (highlightOverlayRoot && highlightOverlayRoot.isConnected) {
    return highlightOverlayRoot;
  }

  const root = document.createElement("div");
  root.setAttribute("data-wholepage-highlight-overlay", "true");
  root.style.position = "fixed";
  root.style.inset = "0";
  root.style.zIndex = "2147483647";
  root.style.pointerEvents = "none";
  root.style.display = "none";
  root.style.contain = "layout style paint";

  document.documentElement.appendChild(root);
  highlightOverlayRoot = root;
  return root;
}

function clearHighlightOverlayRoot() {
  if (!highlightOverlayRoot) return;
  highlightOverlayRoot.replaceChildren();
  highlightOverlayRoot.style.display = "none";
}

function disconnectHighlightResizeObserver() {
  if (!highlightResizeObserver) return;
  highlightResizeObserver.disconnect();
  highlightResizeObserver = null;
}

function stopHighlightTracking() {
  if (highlightOverlayFrameId) {
    cancelAnimationFrame(highlightOverlayFrameId);
    highlightOverlayFrameId = 0;
  }
  disconnectHighlightResizeObserver();
}

function collectHighlightRects(element) {
  if (!(element instanceof Element)) return [];

  const clientRects = typeof element.getClientRects === "function"
    ? Array.from(element.getClientRects())
    : [];

  const filteredClientRects = clientRects.filter((rect) => (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0.5 &&
    rect.height > 0.5
  ));

  if (filteredClientRects.length > 0) {
    if (filteredClientRects.length > HIGHLIGHT_MAX_RECT_COUNT) {
      const boundingRect = element.getBoundingClientRect();
      return [boundingRect].filter((rect) => rect.width > 0.5 && rect.height > 0.5);
    }

    return filteredClientRects;
  }

  if (typeof element.getBoundingClientRect === "function") {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0.5 && rect.height > 0.5) {
      return [rect];
    }
  }

  return [];
}

function collectElementSubtree(rootElement) {
  if (!(rootElement instanceof Element)) return [];

  const elements = [];
  const stack = [rootElement];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!(current instanceof Element)) continue;

    elements.push(current);

    if (current.shadowRoot) {
      const shadowChildren = Array.from(current.shadowRoot.children);
      for (let index = shadowChildren.length - 1; index >= 0; index -= 1) {
        stack.push(shadowChildren[index]);
      }
    }

    const lightChildren = Array.from(current.children);
    for (let index = lightChildren.length - 1; index >= 0; index -= 1) {
      stack.push(lightChildren[index]);
    }
  }

  return elements;
}

function renderHighlightOverlay(element) {
  if (!(element instanceof Element) || !element.isConnected || !runtimeSettings.enableElementHighlight) {
    clearHighlightOverlayRoot();
    return;
  }

  const rects = collectHighlightRects(element);
  if (rects.length === 0) {
    clearHighlightOverlayRoot();
    return;
  }

  const overlayRoot = ensureHighlightOverlayRoot();
  const color = normalizeHighlightColor(runtimeSettings.highlightColor);
  const { r, g, b } = hexToRgb(color);
  const overlayFragments = rects.map((rect) => {
    const fragment = document.createElement("div");
    const left = Math.max(0, rect.left - HIGHLIGHT_OVERLAY_PADDING_PX);
    const top = Math.max(0, rect.top - HIGHLIGHT_OVERLAY_PADDING_PX);
    const width = rect.width + (HIGHLIGHT_OVERLAY_PADDING_PX * 2);
    const height = rect.height + (HIGHLIGHT_OVERLAY_PADDING_PX * 2);

    fragment.style.position = "fixed";
    fragment.style.left = `${left}px`;
    fragment.style.top = `${top}px`;
    fragment.style.width = `${width}px`;
    fragment.style.height = `${height}px`;
    fragment.style.boxSizing = "border-box";
    fragment.style.border = `${HIGHLIGHT_BORDER_WIDTH_PX}px solid ${color}`;
    fragment.style.borderRadius = "6px";
    fragment.style.background = `rgba(${r}, ${g}, ${b}, 0.12)`;
    fragment.style.boxShadow = `0 0 0 1px rgba(${r}, ${g}, ${b}, 0.24)`;
    fragment.style.pointerEvents = "none";

    return fragment;
  });

  overlayRoot.replaceChildren(...overlayFragments);
  overlayRoot.style.display = "block";
}

function syncHighlightOverlayNow() {
  if (!(currentHighlightedElement instanceof Element)) {
    clearHighlightOverlayRoot();
    stopHighlightTracking();
    return;
  }

  if (!currentHighlightedElement.isConnected) {
    clearSelectedElement();
    return;
  }

  renderHighlightOverlay(currentHighlightedElement);
}

function queueHighlightOverlaySync() {
  if (highlightOverlayFrameId || !isRuntimeActive()) {
    return;
  }

  highlightOverlayFrameId = requestAnimationFrame(() => {
    highlightOverlayFrameId = 0;

    if (!isRuntimeActive()) {
      return;
    }

    if (automaticReloadMode === "page") {
      clearHighlightOverlayRoot();
      return;
    }

    syncHighlightOverlayNow();
  });
}

function syncHighlightOverlay() {
  if (!(currentHighlightedElement instanceof Element)) {
    clearHighlightOverlayRoot();
    stopHighlightTracking();
    return;
  }

  if (!currentHighlightedElement.isConnected) {
    clearSelectedElement();
    return;
  }

  if ("ResizeObserver" in globalThis) {
    disconnectHighlightResizeObserver();
    highlightResizeObserver = new ResizeObserver(() => {
      queueHighlightOverlaySync();
    });
    highlightResizeObserver.observe(currentHighlightedElement);
  }

  queueHighlightOverlaySync();
}

// Remove highlight safely
function removeHighlight() {
  stopHighlightTracking();
  clearHighlightOverlayRoot();
  currentHighlightedElement = null;
}

function clearSelectedElementLocator() {
  lastSelectedElementLocator = null;
}

function clearSelectedElement() {
  clearSelectedElementLocator();
  removeHighlight();
}

function clearAutomaticElementLocator() {
  automaticReloadElementLocator = null;
}

function cleanupTransientReferences({ preserveAutomaticElementLocator = false } = {}) {
  clearSelectedElement();

  if (!preserveAutomaticElementLocator) {
    clearAutomaticElementLocator();
  }
}

function normalizeAutomaticReloadMode(mode) {
  if (mode === "page" || mode === "element") return mode;
  return null;
}

function clearAutomaticReloadTimer() {
  if (!automaticReloadTimer) return;
  clearTimeout(automaticReloadTimer);
  automaticReloadTimer = null;
}

function isAutomaticReloadActive(mode, intervalMs, token) {
  return (
    automaticReloadToken === token &&
    automaticReloadMode === mode &&
    automaticReloadIntervalMs === intervalMs
  );
}

function persistAutomaticReloadState() {
  try {
    if (automaticReloadMode === "page" && automaticReloadIntervalMs > 0) {
      sessionStorage.setItem(AUTO_RELOAD_STATE_STORAGE_KEY, JSON.stringify({
        mode: "page",
        intervalMs: automaticReloadIntervalMs,
        createdAt: Date.now()
      }));
      return;
    }

    sessionStorage.removeItem(AUTO_RELOAD_STATE_STORAGE_KEY);
  } catch (error) {
    console.warn("WholePage: Failed to persist automatic reload state", error);
  }
}

function stopAutomaticReload({ clearPersistedState = true } = {}) {
  const previousMode = automaticReloadMode;
  automaticReloadToken += 1;
  clearAutomaticReloadTimer();
  automaticReloadMode = null;
  automaticReloadIntervalMs = 0;
  clearAutomaticElementLocator();

  try {
    if (clearPersistedState || previousMode !== "page") {
      sessionStorage.removeItem(AUTO_RELOAD_STATE_STORAGE_KEY);
    }
    sessionStorage.removeItem(AUTO_PAGE_BLINK_STORAGE_KEY);
  } catch (error) {
    console.warn("WholePage: Failed to clear automatic reload state", error);
  }
}

function blinkBorderOverlay(left, top, width, height, color, borderWidth = 3, borderRadius = 8) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 1 || height <= 1) return;

  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.left = `${left}px`;
  overlay.style.top = `${top}px`;
  overlay.style.width = `${width}px`;
  overlay.style.height = `${height}px`;
  overlay.style.zIndex = "2147483647";
  overlay.style.pointerEvents = "none";
  overlay.style.border = `${borderWidth}px solid ${color}`;
  overlay.style.borderRadius = `${borderRadius}px`;
  overlay.style.boxSizing = "border-box";
  overlay.style.background = "transparent";
  overlay.style.opacity = "0";
  overlay.style.transition = "opacity 130ms ease";

  document.documentElement.appendChild(overlay);

  requestAnimationFrame(() => {
    overlay.style.opacity = "1";
    scheduleManagedTimeout(() => {
      overlay.style.opacity = "0";
      scheduleManagedTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 150);
    }, 140);
  });
}

function blinkPage() {
  const color = normalizeHighlightColor(runtimeSettings.highlightColor);
  blinkBorderOverlay(0, 0, window.innerWidth, window.innerHeight, color, 4, 0);
}

function blinkElement(element) {
  if (!(element instanceof Element)) return;
  const color = normalizeHighlightColor(runtimeSettings.highlightColor);
  const rects = collectHighlightRects(element);

  rects.forEach((rect) => {
    blinkBorderOverlay(rect.left, rect.top, rect.width, rect.height, color, HIGHLIGHT_BORDER_WIDTH_PX, 6);
  });
}

function consumePendingAutoPageBlink() {
  try {
    const raw = sessionStorage.getItem(AUTO_PAGE_BLINK_STORAGE_KEY);
    if (!raw) return;

    sessionStorage.removeItem(AUTO_PAGE_BLINK_STORAGE_KEY);
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== "object") return;
    if (typeof payload.createdAt !== "number") return;
    if (Date.now() - payload.createdAt > AUTO_PAGE_BLINK_MAX_AGE_MS) return;

    blinkPage();
  } catch (error) {
    console.warn("WholePage: Failed to consume auto page blink marker", error);
  }
}

function scheduleAutomaticReload(expectedToken = automaticReloadToken) {
  clearAutomaticReloadTimer();

  if (!automaticReloadMode || automaticReloadIntervalMs <= 0) return;

  const mode = automaticReloadMode;
  const intervalMs = automaticReloadIntervalMs;

  automaticReloadTimer = setTimeout(async () => {
    if (!isRuntimeActive()) return;
    if (!isAutomaticReloadActive(mode, intervalMs, expectedToken)) return;

    if (mode === "element") {
      try {
        if (runtimeSettings.enableDeepReloadElement) {
          const automaticTargetElement = resolveElementLocator(automaticReloadElementLocator);
          const result = await reloadElementUnderCursor(automaticTargetElement, { automatic: true });
          if (result?.handled !== true) {
            stopAutomaticReload();
            clearSelectedElement();
            showDebugReport({
              mode: "Automatic",
              note: `Stopped (${result?.reason || "element reload no longer possible"})`
            });
            return;
          }
        }
      } catch (error) {
        console.warn("WholePage: Automatic element reload failed", error);
      }
      if (isAutomaticReloadActive(mode, intervalMs, expectedToken)) {
        scheduleAutomaticReload(expectedToken);
      }
      return;
    }

    if (mode === "page") {
      if (!isAutomaticReloadActive(mode, intervalMs, expectedToken)) return;
      if (!runtimeSettings.enableDeepReloadPage) {
        stopAutomaticReload();
        return;
      }

      if (!isAutomaticReloadActive(mode, intervalMs, expectedToken)) return;
      try {
        sessionStorage.setItem(AUTO_PAGE_BLINK_STORAGE_KEY, JSON.stringify({ createdAt: Date.now() }));
        persistAutomaticReloadState();
      } catch (error) {
        console.warn("WholePage: Failed to set automatic whole-page reload markers", error);
      }

      if (!isAutomaticReloadActive(mode, intervalMs, expectedToken)) return;
      try {
        const triggerResult = await browser.runtime.sendMessage({ action: "triggerAutoWholePageReload" });
        if (triggerResult?.triggered !== true && isAutomaticReloadActive(mode, intervalMs, expectedToken)) {
          scheduleAutomaticReload(expectedToken);
        }
      } catch (error) {
        console.warn("WholePage: Failed to trigger automatic whole-page reload", error);
        if (isAutomaticReloadActive(mode, intervalMs, expectedToken)) {
          scheduleAutomaticReload(expectedToken);
        }
      }
    }
  }, intervalMs);
}

function startAutomaticReload(mode, intervalMs) {
  automaticReloadToken += 1;
  automaticReloadMode = mode;
  automaticReloadIntervalMs = intervalMs;
  if (mode !== "element") {
    clearAutomaticElementLocator();
  }
  persistAutomaticReloadState();
  scheduleAutomaticReload(automaticReloadToken);
}

function restoreAutomaticPageReloadState() {
  try {
    const raw = sessionStorage.getItem(AUTO_RELOAD_STATE_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    if (parsed.mode !== "page") return;

    const intervalSec = clampAutoReloadIntervalSec(Math.round(Number(parsed.intervalMs) / 1000));
    if (!runtimeSettings.enableAutoReloadFallback || !runtimeSettings.enableDeepReloadPage) {
      sessionStorage.removeItem(AUTO_RELOAD_STATE_STORAGE_KEY);
      return;
    }

    startAutomaticReload("page", intervalSec * 1000);
  } catch (error) {
    console.warn("WholePage: Failed to restore automatic reload state", error);
  }
}

function toggleAutomaticReload(mode, intervalMs) {
  const normalizedMode = normalizeAutomaticReloadMode(mode);
  if (!normalizedMode) {
    return { started: false, stopped: false, reason: "invalid-mode" };
  }

  if (!runtimeSettings.enableAutoReloadFallback) {
    return { started: false, stopped: false, reason: "automatic-disabled-in-settings" };
  }

  if (normalizedMode === "page" && !runtimeSettings.enableDeepReloadPage) {
    return { started: false, stopped: false, reason: "page-reload-disabled" };
  }

  if (normalizedMode === "element" && !runtimeSettings.enableDeepReloadElement) {
    return { started: false, stopped: false, reason: "element-reload-disabled" };
  }

  const nextElementTarget = normalizedMode === "element"
    ? resolveNearestRefreshRoot(resolveCurrentSelectedElement())
    : null;

  // Selecting a new automatic mode/target always replaces the previous one.
  if (automaticReloadMode) {
    stopAutomaticReload();
  }

  if (normalizedMode === "element") {
    if (!nextElementTarget || !nextElementTarget.isConnected || isPageSurfaceElement(nextElementTarget)) {
      return { started: false, stopped: false, reason: "no-element-under-cursor" };
    }
    automaticReloadElementLocator = createElementLocator(nextElementTarget);
    if (!automaticReloadElementLocator) {
      return { started: false, stopped: false, reason: "element-locator-unavailable" };
    }
    clearSelectedElementLocator();
    if (runtimeSettings.enableElementHighlight) {
      highlightElement(nextElementTarget);
    }
  } else {
    clearSelectedElement();
  }

  const normalizedIntervalSec = clampAutoReloadIntervalSec(Math.round(Number(intervalMs) / 1000));
  startAutomaticReload(normalizedMode, normalizedIntervalSec * 1000);
  showDebugReport({
    mode: "Automatic",
    note: `Started (${normalizedMode === "page" ? "Whole Page" : "Element Under Cursor"}) every ${normalizedIntervalSec}s`
  });

  return {
    started: true,
    stopped: false,
    mode: normalizedMode,
    intervalMs: normalizedIntervalSec * 1000
  };
}

function resetAutomaticReload() {
  stopAutomaticReload();
  clearSelectedElement();

  showDebugReport({
    mode: "Automatic",
    note: "Reset"
  });

  return { reset: true };
}

function ensureReloadIndicatorElement() {
  if (reloadIndicatorElement && reloadIndicatorElement.isConnected) {
    return reloadIndicatorElement;
  }

  const indicator = document.createElement('div');
  indicator.style.position = 'fixed';
  indicator.style.top = '14px';
  indicator.style.right = '14px';
  indicator.style.zIndex = '2147483647';
  indicator.style.padding = '6px 10px';
  indicator.style.borderRadius = '10px';
  indicator.style.backgroundColor = 'rgba(0, 0, 0, 0.82)';
  indicator.style.color = '#ffffff';
  indicator.style.font = '500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  indicator.style.letterSpacing = '0.2px';
  indicator.style.pointerEvents = 'none';
  indicator.style.boxShadow = '0 3px 10px rgba(0, 0, 0, 0.25)';
  indicator.style.opacity = '0';
  indicator.style.transition = 'opacity 0.15s ease';
  indicator.style.display = 'none';

  document.documentElement.appendChild(indicator);
  reloadIndicatorElement = indicator;

  return indicator;
}

function showReloadIndicator(reloadSessionId) {
  if (!runtimeSettings.enableToastNotification) return;

  activeIndicatorSessionId = reloadSessionId;
  reloadIndicatorHideTimer = clearManagedTimeout(reloadIndicatorHideTimer);

  if (reloadIndicatorTimer) {
    clearInterval(reloadIndicatorTimer);
    reloadIndicatorTimer = null;
  }

  const indicator = ensureReloadIndicatorElement();
  let dotCount = 0;

  const renderText = () => {
    const suffix = '.'.repeat(dotCount);
    indicator.textContent = `Reloading${suffix}`;
  };

  indicator.style.display = 'block';
  indicator.style.opacity = '1';
  renderText();

  reloadIndicatorTimer = setInterval(() => {
    if (activeIndicatorSessionId !== reloadSessionId) return;
    dotCount = (dotCount + 1) % 4;
    renderText();
  }, 320);
}

function hideReloadIndicatorIfCurrent(reloadSessionId) {
  if (activeIndicatorSessionId !== reloadSessionId) return;

  if (reloadIndicatorTimer) {
    clearInterval(reloadIndicatorTimer);
    reloadIndicatorTimer = null;
  }

  reloadIndicatorHideTimer = clearManagedTimeout(reloadIndicatorHideTimer);

  if (!reloadIndicatorElement) return;

  reloadIndicatorElement.style.opacity = '0';
  reloadIndicatorHideTimer = scheduleManagedTimeout(() => {
    if (!reloadIndicatorElement) return;
    if (activeIndicatorSessionId !== reloadSessionId) return;
    reloadIndicatorElement.style.display = 'none';
    activeIndicatorSessionId = 0;
  }, 160);
}

function ensureDebugReportElement() {
  if (debugReportElement && debugReportElement.isConnected) {
    return debugReportElement;
  }

  const panel = document.createElement("div");
  panel.style.position = "fixed";
  panel.style.top = "14px";
  panel.style.right = "14px";
  panel.style.zIndex = "2147483647";
  panel.style.maxWidth = "320px";
  panel.style.padding = "10px 12px";
  panel.style.borderRadius = "10px";
  panel.style.backgroundColor = "rgba(19, 23, 32, 0.92)";
  panel.style.color = "#eaf0ff";
  panel.style.font = '500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  panel.style.lineHeight = "1.4";
  panel.style.letterSpacing = "0.2px";
  panel.style.whiteSpace = "pre-line";
  panel.style.pointerEvents = "none";
  panel.style.boxShadow = "0 4px 14px rgba(0, 0, 0, 0.34)";
  panel.style.border = "1px solid rgba(255, 255, 255, 0.12)";
  panel.style.opacity = "0";
  panel.style.display = "none";
  panel.style.transition = "opacity 0.2s ease";

  document.documentElement.appendChild(panel);
  debugReportElement = panel;

  return panel;
}

function showDebugReport(report) {
  if (!report || !runtimeSettings.enableToastNotification) return;

  if (debugReportHideTimer) {
    debugReportHideTimer = clearManagedTimeout(debugReportHideTimer);
  }
  debugReportFadeTimer = clearManagedTimeout(debugReportFadeTimer);

  const panel = ensureDebugReportElement();
  const lines = ["Reload Report"];

  if (report.mode) lines.push(`Mode: ${report.mode}`);
  if (typeof report.mediaReloaded === "number") lines.push(`Media reloaded: ${report.mediaReloaded}`);
  if (typeof report.inlineStylesUpdated === "number") lines.push(`Inline style URLs updated: ${report.inlineStylesUpdated}`);
  if (typeof report.serviceWorkersUnregistered === "number") lines.push(`Service Workers unregistered: ${report.serviceWorkersUnregistered}`);
  if (typeof report.cacheStoresCleared === "number") lines.push(`Cache stores cleared: ${report.cacheStoresCleared}`);
  if (report.note) lines.push(`Note: ${report.note}`);

  panel.textContent = lines.join("\n");
  panel.style.display = "block";
  panel.style.opacity = "1";

  debugReportHideTimer = scheduleManagedTimeout(() => {
    if (!debugReportElement) return;
    debugReportElement.style.opacity = "0";
    debugReportFadeTimer = scheduleManagedTimeout(() => {
      if (!debugReportElement) return;
      debugReportElement.style.display = "none";
    }, 200);
  }, runtimeSettings.toastDurationMs);
}

function savePendingPageReport(report) {
  if (!runtimeSettings.enableToastNotification) return;

  try {
    sessionStorage.setItem(PENDING_REPORT_STORAGE_KEY, JSON.stringify(report));
  } catch (error) {
    console.warn("WholePage: Failed to persist pending report", error);
  }
}

function consumePendingPageReport() {
  try {
    const raw = sessionStorage.getItem(PENDING_REPORT_STORAGE_KEY);
    if (!raw) return;

    sessionStorage.removeItem(PENDING_REPORT_STORAGE_KEY);
    const report = JSON.parse(raw);
    if (!report || typeof report !== "object") return;
    if (typeof report.createdAt === "number") {
      if (Date.now() - report.createdAt > PENDING_REPORT_MAX_AGE_MS) return;
    }

    if (runtimeSettings.enableToastNotification) {
      showDebugReport(report);
    }
  } catch (error) {
    console.warn("WholePage: Failed to read pending report", error);
  }
}

function isPageSurfaceElement(element) {
  return element === document.body || element === document.documentElement;
}

function getElementDisplayName(element) {
  if (!(element instanceof Element) || typeof element.tagName !== "string") {
    return "element";
  }

  return element.tagName.toLowerCase();
}

function buildStaticElementRefreshNote(element) {
  const elementName = getElementDisplayName(element);
  return `The selected ${elementName} is static content and can't be refreshed individually. Refresh the whole page instead.`;
}

function highlightElement(element) {
  const resolvedElement = resolveElementTarget(element);

  if (!(resolvedElement instanceof Element) || isPageSurfaceElement(resolvedElement)) {
    removeHighlight();
    return;
  }
  if (!runtimeSettings.enableElementHighlight) {
    removeHighlight();
    return;
  }

  removeHighlight(); // clear previous

  currentHighlightedElement = resolvedElement;
  syncHighlightOverlay();
}

function shouldClearManualHighlightFromMouseEvent(event) {
  if (automaticReloadMode) return false;
  if (!(currentHighlightedElement instanceof Element)) return false;
  if (!currentHighlightedElement.isConnected) {
    clearSelectedElement();
    return false;
  }

  const eventTarget = resolveEventElementTarget(event);
  if (!(eventTarget instanceof Element)) {
    clearSelectedElement();
    return false;
  }

  const eventPath = typeof event.composedPath === "function" ? event.composedPath() : [];
  const clickedInsideHighlightedElement =
    eventTarget === currentHighlightedElement ||
    currentHighlightedElement.contains(eventTarget) ||
    eventPath.includes(currentHighlightedElement);

  if (!clickedInsideHighlightedElement) {
    return true;
  }

  // Keep right-click on the highlighted element available for the context menu flow.
  return event.button !== 2;
}

function handleDocumentContextMenu(e) {
  if (!runtimeSettings.enableDeepReloadElement) {
    clearSelectedElement();
    return;
  }

  const eventTargetElement = resolveEventElementTarget(e);

  // Preserve the active automatic element target while running.
  if (automaticReloadMode === "element" && automaticReloadElementLocator) {
    const automaticTargetElement = resolveElementLocator(automaticReloadElementLocator);
    if (runtimeSettings.enableElementHighlight) {
      highlightElement(automaticTargetElement);
    }
    return;
  }

  if (automaticReloadMode === "page") {
    removeHighlight();
    return;
  }

  lastSelectedElementLocator = createElementLocator(eventTargetElement);
  highlightElement(eventTargetElement);
}

function handleDocumentMouseDown(e) {
  if (!currentHighlightedElement && !lastSelectedElementLocator) return;
  if (!shouldClearManualHighlightFromMouseEvent(e)) return;
  clearSelectedElement();
}

function handleHighlightViewportChange() {
  if (!(currentHighlightedElement instanceof Element)) return;
  queueHighlightOverlaySync();
}

function handleDocumentVisibilityChange() {
  if (document.visibilityState !== "visible") return;
  handleHighlightViewportChange();
}

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
          console.warn("WholePage: Failed to unregister Service Worker", error);
        }
      }
    }
  } catch (error) {
    console.warn("WholePage: Service Worker cleanup failed", error);
  }

  try {
    if ("caches" in window && typeof caches.keys === "function") {
      const keys = await caches.keys();
      for (const key of keys) {
        try {
          const removed = await caches.delete(key);
          if (removed) result.cacheStoresCleared++;
        } catch (error) {
          console.warn("WholePage: Failed to clear cache store", key, error);
        }
      }
    }
  } catch (error) {
    console.warn("WholePage: Cache API cleanup failed", error);
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

  savePendingPageReport(report);
  showDebugReport(report);

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
  stopHighlightTracking();
  clearHighlightOverlayRoot();

  if (highlightOverlayRoot?.parentNode) {
    highlightOverlayRoot.parentNode.removeChild(highlightOverlayRoot);
  }
  if (reloadIndicatorElement?.parentNode) {
    reloadIndicatorElement.parentNode.removeChild(reloadIndicatorElement);
  }
  if (debugReportElement?.parentNode) {
    debugReportElement.parentNode.removeChild(debugReportElement);
  }

  highlightOverlayRoot = null;
  reloadIndicatorElement = null;
  debugReportElement = null;
  activeIndicatorSessionId = 0;

  const removers = contentRuntime.listenerRemovers.splice(0);
  removers.reverse().forEach((removeListener) => {
    try {
      removeListener();
    } catch (error) {
      console.warn("WholePage: Failed while disposing content listener", error);
    }
  });

  if (globalThis[CONTENT_RUNTIME_KEY] === contentRuntime) {
    delete globalThis[CONTENT_RUNTIME_KEY];
  }
}

contentRuntime.cleanup = disposeContentRuntime;

registerRuntimeListeners();
void initializeRuntimeState();

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

// Main reload function with completion-based highlight removal
async function reloadElementUnderCursor(element, options = {}) {
  if (!isRuntimeActive()) {
    return {
      handled: false,
      fallbackToPageReload: false,
      reason: "runtime-inactive"
    };
  }

  const automatic = options.automatic === true;
  const preserveAutomaticElementLocator = automatic && automaticReloadMode === "element";
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
    cleanupTransientReferences({ preserveAutomaticElementLocator });
    return {
      handled: false,
      fallbackToPageReload: false,
      reason: "element-reload-disabled"
    };
  }

  if (!targetElement) {
    console.log("WholePage: No element found");
    cleanupTransientReferences({ preserveAutomaticElementLocator });
    return {
      handled: false,
      fallbackToPageReload: true,
      reason: "no-element-under-cursor"
    };
  }

  if (!targetElement.isConnected) {
    cleanupTransientReferences({ preserveAutomaticElementLocator });
    return {
      handled: false,
      fallbackToPageReload: true,
      reason: "element-no-longer-in-dom"
    };
  }

  if (isPageSurfaceElement(targetElement)) {
    cleanupTransientReferences({ preserveAutomaticElementLocator });
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

    // Direct media
    const directReload = reloadMediaElement(targetElement, timestamp);
    if (directReload) {
      console.log(`WholePage: Reloaded ${targetElement.tagName}`);
      await directReload;
      if (automatic) {
        blinkElement(targetElement);
      }
      showDebugReport({
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

    // Container block
    const refreshableElements = collectElementSubtree(targetElement).filter((elementNode) => (
      elementNode !== targetElement && isReloadableMediaTarget(elementNode)
    ));

    const completionPromises = [];

    refreshableElements.forEach((el) => {
      const completion = reloadMediaElement(el, timestamp);
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
        showDebugReport({
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
    showDebugReport({
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
    cleanupTransientReferences({
      preserveAutomaticElementLocator
    });
  }
}
