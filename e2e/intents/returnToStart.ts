/**
 * return_to_start — dismiss open modals / panels, leave operator mode if needed
 * (idea#166, duration-tests.md Return-to-start + Design Review: dismiss modals).
 *
 * Live erase/eject labels: never hardcode confirm text; read from the dialog
 * (EraseDialog uses summary.label; EjectConfirm uses disk.name) when confirming
 * in later Phase 3 Intents.
 */
import type { IntentFn } from './types';
import { sel } from './selectors';

export const return_to_start: IntentFn = async ({ page }) => {
  // Dismiss erase / eject dialogs if open (Cancel / Close)
  for (const dialog of [sel.eraseDialog, sel.ejectConfirm]) {
    const loc = page.locator(dialog);
    if (await loc.count()) {
      const cancel = loc.getByRole('button', { name: /cancel|close/i }).first();
      if (await cancel.count()) await cancel.click();
    }
  }
  // Close Account / Settings if showing
  const opEntry = page.locator(sel.opEntry);
  if (await opEntry.isVisible().catch(() => false)) {
    const account = page.locator(sel.accountBtn);
    if (await account.count()) await account.click();
  }
  // Prefer user-mode overview as the Console "start" surface for usage walks
  const overview = page.locator(sel.consoleOverview);
  if (await overview.count()) {
    await overview.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  }
};
