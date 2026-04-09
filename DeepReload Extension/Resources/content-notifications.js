//
//  content-notifications.js
//  DeepReload Extension
//
//  Created by Sedoykin Alexey on 27/03/2026.
//

function ensureReloadIndicatorElement() {
  if (reloadIndicatorElement && reloadIndicatorElement.isConnected) {
    return reloadIndicatorElement;
  }

  const indicator = document.createElement("div");
  indicator.style.position = "fixed";
  indicator.style.top = "84px";
  indicator.style.right = "14px";
  indicator.style.zIndex = "2147483647";
  indicator.style.padding = "6px 10px";
  indicator.style.borderRadius = "10px";
  indicator.style.backgroundColor = "rgba(0, 0, 0, 0.82)";
  indicator.style.color = "#ffffff";
  indicator.style.font = '500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  indicator.style.letterSpacing = "0.2px";
  indicator.style.pointerEvents = "none";
  indicator.style.boxShadow = "0 3px 10px rgba(0, 0, 0, 0.25)";
  indicator.style.opacity = "0";
  indicator.style.transition = "opacity 0.15s ease";
  indicator.style.display = "none";

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
    const suffix = ".".repeat(dotCount);
    indicator.textContent = `Reloading${suffix}`;
  };

  indicator.style.display = "block";
  indicator.style.opacity = "1";
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

  reloadIndicatorElement.style.opacity = "0";
  reloadIndicatorHideTimer = scheduleManagedTimeout(() => {
    if (!reloadIndicatorElement) return;
    if (activeIndicatorSessionId !== reloadSessionId) return;
    reloadIndicatorElement.style.display = "none";
    activeIndicatorSessionId = 0;
  }, 160);
}

function ensureDebugReportElement() {
  if (debugReportElement && debugReportElement.isConnected) {
    return debugReportElement;
  }

  const panel = document.createElement("div");
  panel.style.position = "fixed";
  panel.style.top = "84px";
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

function showNotification(report) {
  if (!report || !runtimeSettings.enableToastNotification) return;

  if (debugReportHideTimer) {
    debugReportHideTimer = clearManagedTimeout(debugReportHideTimer);
  }
  debugReportFadeTimer = clearManagedTimeout(debugReportFadeTimer);

  const panel = ensureDebugReportElement();
  const lines = ["Deep Reload"];

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
  }, runtimeSettings.toastDurationSec * 1000);
}

function savePendingPageReport(report) {
  if (!runtimeSettings.enableToastNotification) return;

  try {
    sessionStorage.setItem(PENDING_REPORT_STORAGE_KEY, JSON.stringify(report));
  } catch (error) {
    console.warn("Deep Reload: Failed to persist pending report", error);
  }
}

function clearPendingPageReport() {
  try {
    sessionStorage.removeItem(PENDING_REPORT_STORAGE_KEY);
  } catch (error) {
    console.warn("Deep Reload: Failed to clear pending report", error);
  }
}

function consumePendingPageReport() {
  try {
    const raw = sessionStorage.getItem(PENDING_REPORT_STORAGE_KEY);
    if (!raw) return;

    sessionStorage.removeItem(PENDING_REPORT_STORAGE_KEY);
    const report = JSON.parse(raw);
    if (!report || typeof report !== "object") return;
    if (typeof report.createdAt === "number" && Date.now() - report.createdAt > PENDING_REPORT_MAX_AGE_MS) {
      return;
    }

    if (runtimeSettings.enableToastNotification) {
      showNotification(report);
    }
  } catch (error) {
    console.warn("Deep Reload: Failed to read pending report", error);
  }
}
