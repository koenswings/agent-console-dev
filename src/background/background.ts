/**
 * IDEA Console — Chrome Extension background service worker (Manifest V3).
 *
 * Three display modes, switchable at runtime via the settings screen:
 *   - sidePanel  (default) — Chrome opens the panel natively on icon click
 *   - popup                — standard extension popup
 *   - window               — standalone Chrome window
 */

type DisplayMode = 'sidePanel' | 'popup' | 'window';
const STORAGE_KEY_MODE = 'displayMode';
const CONSOLE_URL = 'index.html';

const applyMode = async (mode: DisplayMode): Promise<void> => {
  if (mode === 'sidePanel') {
    // Let Chrome open the side panel directly on icon click — most reliable,
    // does not depend on the service worker being awake.
    await chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(console.error);
    await chrome.action.setPopup({ popup: '' }).catch(console.error);
  } else if (mode === 'popup') {
    await chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: false })
      .catch(console.error);
    await chrome.action.setPopup({ popup: CONSOLE_URL }).catch(console.error);
  } else if (mode === 'window') {
    await chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: false })
      .catch(console.error);
    await chrome.action.setPopup({ popup: '' }).catch(console.error);
  }
};

// Apply mode on install and on every service worker startup
const initMode = async (): Promise<void> => {
  const result = await chrome.storage.local.get(STORAGE_KEY_MODE);
  const mode: DisplayMode = (result[STORAGE_KEY_MODE] as DisplayMode) ?? 'sidePanel';
  await applyMode(mode);

  await chrome.sidePanel
    .setOptions({ enabled: true, path: CONSOLE_URL })
    .catch(console.error);
};

chrome.runtime.onInstalled.addListener(() => {
  initMode();
});

// Run on every service worker startup (not just install)
initMode();

// Handle toolbar icon click — only fires for 'window' mode
// (sidePanel uses setPanelBehavior; popup uses setPopup)
chrome.action.onClicked.addListener(async () => {
  const result = await chrome.storage.local.get(STORAGE_KEY_MODE);
  const mode: DisplayMode = (result[STORAGE_KEY_MODE] as DisplayMode) ?? 'sidePanel';

  if (mode === 'window') {
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
});

// React to mode changes saved from the settings screen
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEY_MODE]) {
    const mode = changes[STORAGE_KEY_MODE].newValue as DisplayMode;
    applyMode(mode);
  }
});
