/**
 * IDEA Console — Chrome Extension background service worker (Manifest V3).
 *
 * Handles three display modes, switchable at runtime via the settings screen:
 *   - sidePanel   (default) — docked panel on the right of the browser
 *   - popup                 — small popup window on toolbar icon click
 *   - window                — standalone Chrome window (app-style)
 */

type DisplayMode = 'sidePanel' | 'popup' | 'window';
const STORAGE_KEY_MODE = 'displayMode';
const CONSOLE_URL = 'index.html';

const applyMode = (mode: DisplayMode): void => {
  if (mode === 'popup') {
    // Popup mode: let Chrome handle opening; disable onClicked
    chrome.action.setPopup({ popup: CONSOLE_URL }).catch(console.error);
  } else {
    // Side panel or window: clear popup so onClicked fires
    chrome.action.setPopup({ popup: '' }).catch(console.error);
  }
};

// Apply the current mode on install / service worker restart
chrome.runtime.onInstalled.addListener(async () => {
  const result = await chrome.storage.local.get(STORAGE_KEY_MODE);
  const mode: DisplayMode = (result[STORAGE_KEY_MODE] as DisplayMode) ?? 'sidePanel';
  applyMode(mode);

  // Ensure side panel is configured
  chrome.sidePanel
    .setOptions({ enabled: true, path: CONSOLE_URL })
    .catch(console.error);
});

// Re-apply mode when service worker restarts (not just on install)
(async () => {
  const result = await chrome.storage.local.get(STORAGE_KEY_MODE);
  const mode: DisplayMode = (result[STORAGE_KEY_MODE] as DisplayMode) ?? 'sidePanel';
  applyMode(mode);
})();

// Handle toolbar icon click (fires only when popup is NOT set)
chrome.action.onClicked.addListener(async (tab) => {
  const result = await chrome.storage.local.get(STORAGE_KEY_MODE);
  const mode: DisplayMode = (result[STORAGE_KEY_MODE] as DisplayMode) ?? 'sidePanel';

  if (mode === 'sidePanel') {
    if (tab.windowId) {
      chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
    }
  } else if (mode === 'window') {
    chrome.windows
      .create({
        url: chrome.runtime.getURL(CONSOLE_URL),
        type: 'popup',
        width: 960,
        height: 680,
        focused: true,
      })
      .catch(console.error);
  }
  // 'popup' mode is handled by setPopup above — onClicked won't fire in that case
});

// React to mode changes saved from the settings screen
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEY_MODE]) {
    const mode = changes[STORAGE_KEY_MODE].newValue as DisplayMode;
    applyMode(mode);
  }
});
