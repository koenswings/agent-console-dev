/**
 * return_to_start — dismiss open modals / panels, land on Console start surface.
 * Prefer A: loud-fail if overview never appears (no soft .catch dwell).
 */
import type { IntentFn } from './types';
import { sel } from './selectors';

export const return_to_start: IntentFn = async ({ page }) => {
  // Dismiss erase / eject dialogs if open (Cancel)
  for (const dialog of [sel.eraseDialog, sel.ejectConfirm]) {
    const loc = page.locator(dialog);
    if (await loc.isVisible().catch(() => false)) {
      const cancel = loc
        .locator(
          `${sel.eraseCancel}, ${sel.ejectConfirmCancel}, button:has-text("Cancel"), button:has-text("Close")`,
        )
        .first();
      if (await cancel.count()) await cancel.click().catch(() => {});
      try {
        await loc.waitFor({ state: 'hidden', timeout: 10_000 });
      } catch {
        throw new Error(
          `idea#168 return_to_start: ${dialog} still visible after Cancel — Prefer A loud-fail.`,
        );
      }
    }
  }

  // ConnectionManagement
  if (await page.locator(sel.connectionManagement).isVisible().catch(() => false)) {
    const cmBtn = page.locator(sel.connectionMgmtBtn);
    if (await cmBtn.count()) await cmBtn.click().catch(() => {});
    else await page.locator('.status-bar__connection-btn').click().catch(() => {});
  }

  // Settings
  if (await page.locator(sel.settingsPanel).isVisible().catch(() => false)) {
    await page.locator(sel.settingsBtn).click().catch(() => {});
  }

  // Account / op-entry
  if (await page.locator(sel.opEntry).isVisible().catch(() => false)) {
    await page.locator(sel.accountBtn).click().catch(() => {});
  }

  const overview = page.locator(sel.consoleOverview);
  const op = page.locator(sel.opOverview);
  const tree = page.locator(sel.networkTree);
  try {
    await overview.or(op).or(tree).first().waitFor({ state: 'visible', timeout: 15_000 });
  } catch {
    throw new Error(
      'idea#168 return_to_start: no console-overview / op-overview / network-tree after dismissing overlays. ' +
        'Prefer A — Console start surface missing.',
    );
  }
};
