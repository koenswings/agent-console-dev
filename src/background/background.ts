/**
 * IDEA Console — Chrome Extension background service worker (Manifest V3).
 *
 * Responsibilities:
 *   1. Open the side panel when the extension icon is clicked.
 *   2. Keep the side panel available across sessions.
 */

// Open the side panel on extension icon click
chrome.action.onClicked.addListener((tab) => {
  if (!tab.windowId) return;
  chrome.sidePanel.open({ windowId: tab.windowId }).catch((err) => {
    console.error('[background] Failed to open side panel:', err);
  });
});

// Ensure the side panel is set up correctly on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setOptions({
      enabled: true,
      path: 'index.html',
    })
    .catch((err) => {
      console.error('[background] Failed to configure side panel:', err);
    });
});
