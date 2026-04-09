//
//  content-highlight.js
//  DeepReload Extension
//
//  Created by Sedoykin Alexey on 27/03/2026.
//

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

function cleanupTransientReferences() {
  clearSelectedElement();
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

  removeHighlight();

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

  return event.button !== 2;
}

function handleDocumentContextMenu(event) {
  if (!runtimeSettings.enableDeepReloadElement) {
    clearSelectedElement();
    return;
  }

  const eventTargetElement = resolveEventElementTarget(event);

  if (automaticReloadMode === "page") {
    removeHighlight();
    return;
  }

  lastSelectedElementLocator = createElementLocator(eventTargetElement);
  highlightElement(eventTargetElement);
}

function handleDocumentMouseDown(event) {
  if (!currentHighlightedElement && !lastSelectedElementLocator) return;
  if (!shouldClearManualHighlightFromMouseEvent(event)) return;
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
