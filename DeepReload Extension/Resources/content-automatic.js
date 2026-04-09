//
//  content-automatic.js
//  DeepReload Extension
//
//  Created by Sedoykin Alexey on 27/03/2026.
//

function normalizeAutomaticReloadMode(mode) {
  return mode === "page" ? "page" : null;
}

function clearAutomaticReloadTimer() {
  if (!automaticReloadTimer) return;
  clearTimeout(automaticReloadTimer);
  automaticReloadTimer = null;
}

function clearAutomaticReloadCountdownTimer() {
  if (!automaticReloadCountdownTimer) return;
  clearInterval(automaticReloadCountdownTimer);
  automaticReloadCountdownTimer = null;
}

function isAutomaticReloadActive(mode, intervalMs, token) {
  return (
    automaticReloadToken === token &&
    automaticReloadMode === mode &&
    automaticReloadIntervalMs === intervalMs
  );
}

function ensureAutomaticReloadBannerElement() {
  if (automaticReloadBannerElement && automaticReloadBannerElement.isConnected) {
    return automaticReloadBannerElement;
  }

  const banner = document.createElement("div");
  banner.setAttribute("data-wholepage-automatic-banner", "true");
  banner.style.position = "fixed";
  banner.style.top = "14px";
  banner.style.right = "14px";
  banner.style.zIndex = "2147483647";
  banner.style.maxWidth = "340px";
  banner.style.padding = "10px 12px";
  banner.style.borderRadius = "12px";
  banner.style.background = "rgba(15, 19, 27, 0.92)";
  banner.style.color = "#f5f8ff";
  banner.style.font = '500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  banner.style.lineHeight = "1.45";
  banner.style.letterSpacing = "0.2px";
  banner.style.whiteSpace = "pre-line";
  banner.style.pointerEvents = "none";
  banner.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.28)";
  banner.style.border = "1px solid rgba(255, 255, 255, 0.14)";
  banner.style.opacity = "0";
  banner.style.display = "none";
  banner.style.transition = "opacity 0.18s ease";

  document.documentElement.appendChild(banner);
  automaticReloadBannerElement = banner;
  return banner;
}

function formatAutomaticReloadCountdown(remainingMs) {
  const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(remainingSec / 60);
  const seconds = remainingSec % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function renderAutomaticReloadBanner() {
  if (automaticReloadMode !== "page" || automaticReloadIntervalMs <= 0 || automaticReloadNextAtMs <= 0) {
    if (automaticReloadBannerElement) {
      automaticReloadBannerElement.style.opacity = "0";
      automaticReloadBannerElement.style.display = "none";
    }
    return;
  }

  const banner = ensureAutomaticReloadBannerElement();
  const remainingMs = Math.max(0, automaticReloadNextAtMs - Date.now());
  const countdownText = formatAutomaticReloadCountdown(remainingMs);
  banner.textContent = `Automatic Whole Page refresh is on.\nNext refresh in ${countdownText}.`;
  banner.style.display = "block";
  banner.style.opacity = "1";
}

function startAutomaticReloadCountdown() {
  clearAutomaticReloadCountdownTimer();
  renderAutomaticReloadBanner();

  if (automaticReloadMode !== "page" || automaticReloadIntervalMs <= 0 || automaticReloadNextAtMs <= 0) {
    return;
  }

  automaticReloadCountdownTimer = setInterval(() => {
    if (!isRuntimeActive()) return;
    renderAutomaticReloadBanner();
  }, AUTOMATIC_RELOAD_BANNER_UPDATE_MS);
}

function hideAutomaticReloadBanner() {
  clearAutomaticReloadCountdownTimer();

  if (!automaticReloadBannerElement) return;
  automaticReloadBannerElement.style.opacity = "0";
  automaticReloadBannerElement.style.display = "none";
}

function persistAutomaticReloadState() {
  try {
    if (automaticReloadMode === "page" && automaticReloadIntervalMs > 0) {
      sessionStorage.setItem(AUTO_RELOAD_STATE_STORAGE_KEY, JSON.stringify({
        mode: "page",
        intervalMs: automaticReloadIntervalMs,
        nextReloadAt: automaticReloadNextAtMs,
        createdAt: Date.now()
      }));
      return;
    }

    sessionStorage.removeItem(AUTO_RELOAD_STATE_STORAGE_KEY);
  } catch (error) {
    console.warn("Deep Reload: Failed to persist automatic reload state", error);
  }
}

function stopAutomaticReload({ clearPersistedState = true } = {}) {
  const previousMode = automaticReloadMode;
  automaticReloadToken += 1;
  clearAutomaticReloadTimer();
  clearAutomaticReloadCountdownTimer();
  automaticReloadMode = null;
  automaticReloadIntervalMs = 0;
  automaticReloadNextAtMs = 0;
  hideAutomaticReloadBanner();

  try {
    if (clearPersistedState || previousMode !== "page") {
      sessionStorage.removeItem(AUTO_RELOAD_STATE_STORAGE_KEY);
    }
    sessionStorage.removeItem(AUTO_PAGE_BLINK_STORAGE_KEY);
  } catch (error) {
    console.warn("Deep Reload: Failed to clear automatic reload state", error);
  }
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
    console.warn("Deep Reload: Failed to consume auto page blink marker", error);
  }
}

function scheduleAutomaticReload(expectedToken = automaticReloadToken, nextReloadAtMs = Date.now() + automaticReloadIntervalMs) {
  clearAutomaticReloadTimer();

  if (automaticReloadMode !== "page" || automaticReloadIntervalMs <= 0) {
    hideAutomaticReloadBanner();
    return;
  }

  const mode = automaticReloadMode;
  const intervalMs = automaticReloadIntervalMs;
  automaticReloadNextAtMs = Number.isFinite(nextReloadAtMs) ? nextReloadAtMs : Date.now() + intervalMs;
  persistAutomaticReloadState();
  startAutomaticReloadCountdown();

  automaticReloadTimer = setTimeout(async () => {
    if (!isRuntimeActive()) return;
    if (!isAutomaticReloadActive(mode, intervalMs, expectedToken)) return;
    if (!runtimeSettings.enableDeepReloadPage) {
      stopAutomaticReload();
      return;
    }

    if (!isAutomaticReloadActive(mode, intervalMs, expectedToken)) return;
    hideAutomaticReloadBanner();
    try {
      automaticReloadNextAtMs = Date.now() + intervalMs;
      sessionStorage.setItem(AUTO_PAGE_BLINK_STORAGE_KEY, JSON.stringify({ createdAt: Date.now() }));
      persistAutomaticReloadState();
    } catch (error) {
      console.warn("Deep Reload: Failed to set automatic whole-page reload markers", error);
    }

    if (!isAutomaticReloadActive(mode, intervalMs, expectedToken)) return;
    try {
      const triggerResult = await browser.runtime.sendMessage({ action: "triggerAutoWholePageReload" });
      if (triggerResult?.triggered !== true && isAutomaticReloadActive(mode, intervalMs, expectedToken)) {
        scheduleAutomaticReload(expectedToken);
      }
    } catch (error) {
      console.warn("Deep Reload: Failed to trigger automatic whole-page reload", error);
      if (isAutomaticReloadActive(mode, intervalMs, expectedToken)) {
        scheduleAutomaticReload(expectedToken);
      }
    }
  }, Math.max(0, automaticReloadNextAtMs - Date.now()));
}

function startAutomaticReload(intervalMs, nextReloadAtMs = Date.now() + intervalMs) {
  automaticReloadToken += 1;
  automaticReloadMode = "page";
  automaticReloadIntervalMs = intervalMs;
  automaticReloadNextAtMs = Number.isFinite(nextReloadAtMs) ? nextReloadAtMs : Date.now() + intervalMs;
  scheduleAutomaticReload(automaticReloadToken, automaticReloadNextAtMs);
}

function restoreAutomaticPageReloadState() {
  try {
    const raw = sessionStorage.getItem(AUTO_RELOAD_STATE_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    if (parsed.mode !== "page") return;

    const intervalSec = clampAutoReloadIntervalSec(Math.round(Number(parsed.intervalMs) / 1000));
    const storedNextReloadAt = Number(parsed.nextReloadAt);
    const nextReloadAtMs = Number.isFinite(storedNextReloadAt)
      ? Math.max(Date.now(), storedNextReloadAt)
      : Date.now() + (intervalSec * 1000);
    if (!runtimeSettings.enableAutoReloadFallback || !runtimeSettings.enableDeepReloadPage) {
      sessionStorage.removeItem(AUTO_RELOAD_STATE_STORAGE_KEY);
      return;
    }

    startAutomaticReload(intervalSec * 1000, nextReloadAtMs);
  } catch (error) {
    console.warn("Deep Reload: Failed to restore automatic reload state", error);
  }
}

function toggleAutomaticReload(mode, intervalMs) {
  const normalizedMode = normalizeAutomaticReloadMode(mode);
  if (!normalizedMode) {
    return { started: false, stopped: false, reason: "automatic-page-only" };
  }

  if (!runtimeSettings.enableAutoReloadFallback) {
    return { started: false, stopped: false, reason: "automatic-disabled-in-settings" };
  }

  if (normalizedMode === "page" && !runtimeSettings.enableDeepReloadPage) {
    return { started: false, stopped: false, reason: "page-reload-disabled" };
  }

  if (automaticReloadMode) {
    stopAutomaticReload();
  }

  clearSelectedElement();

  const normalizedIntervalSec = clampAutoReloadIntervalSec(Math.round(Number(intervalMs) / 1000));
  startAutomaticReload(normalizedIntervalSec * 1000);
  showNotification({
    mode: "Automatic",
    note: `Started (Whole Page) every ${normalizedIntervalSec}s`
  });

  return {
    started: true,
    stopped: false,
    mode: "page",
    intervalMs: normalizedIntervalSec * 1000
  };
}

function resetAutomaticReload() {
  stopAutomaticReload();
  clearSelectedElement();

  showNotification({
    mode: "Automatic",
    note: "Stopped"
  });

  return { reset: true };
}
