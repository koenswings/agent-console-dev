/**
 * context.ts — Runtime context detection
 *
 * Detected once synchronously at module load. No async, no race conditions.
 * Import IS_EXTENSION wherever chrome.storage or extension-only UI is needed.
 */

// chrome.runtime.id is a non-empty string only inside a real Chrome extension
// (background, popup, sidepanel, content script). In regular web pages it is
// undefined even though chrome.runtime exists.
export const IS_EXTENSION: boolean =
  typeof chrome !== 'undefined' &&
  typeof chrome.runtime !== 'undefined' &&
  typeof chrome.runtime.id === 'string' &&
  chrome.runtime.id.length > 0;
