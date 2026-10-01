/**
 * Operator deeper-path Intents (idea#166): eject / erase / start-stop /
 * account / settings / Files Disk edges that map to shipped Console UI.
 *
 * ACTIONS.md keys: eject_disk, stay_on_overview (dwell in stayOnOverview.ts).
 * Proposal snake_case for edges not yet listed in ACTIONS.md.
 */
import type { IntentFn } from './types';
import { sel } from './selectors';
import { DURATION_FIXTURES } from './fixtures';

/** Click eject-<diskId> → wait for eject-confirm (ACTIONS.md `eject_disk`). */
export const eject_disk: IntentFn = async ({ page, diskId }) => {
  await page.locator(sel.opOverview).or(page.locator(sel.networkTree)).first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  const id = diskId ?? DURATION_FIXTURES.kolibri.diskId;
  await page.locator(sel.eject(id)).click();
  await page.locator(sel.ejectConfirm).waitFor({ state: 'visible', timeout: 10_000 });
};

/** Confirm open eject dialog (proposal `confirm_eject`). */
export const confirm_eject: IntentFn = async ({ page }) => {
  await page.locator(sel.ejectConfirm).waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator(sel.ejectConfirmOk).click();
};

/** Cancel open eject dialog (proposal `cancel_eject`). */
export const cancel_eject: IntentFn = async ({ page }) => {
  await page.locator(sel.ejectConfirm).waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator(sel.ejectConfirmCancel).click();
};

/**
 * Open erase dialog from DiskView / EmptyDiskPanel (`erase_disk`).
 * Prefers the live "Erase this disk…" control — never hardcodes confirm label.
 */
export const erase_disk: IntentFn = async ({ page }) => {
  const btn = page.locator(sel.eraseThisDisk);
  await btn.waitFor({ state: 'visible', timeout: 15_000 });
  await btn.click();
  await page.locator(sel.eraseDialog).waitFor({ state: 'visible', timeout: 15_000 });
};

/** Cancel open erase dialog. */
export const cancel_erase: IntentFn = async ({ page }) => {
  await page.locator(sel.eraseDialog).waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator(sel.eraseCancel).click();
};

/**
 * Type the live summary label into erase-confirm-name, then confirm.
 * Label is read from the dialog (EraseDialog Type <strong>label</strong>).
 */
export const confirm_erase: IntentFn = async ({ page }) => {
  const dialog = page.locator(sel.eraseDialog);
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  const strong = dialog.locator('label[for="erase-confirm-name"] strong');
  await strong.waitFor({ state: 'visible', timeout: 30_000 });
  const label = (await strong.textContent())?.trim() ?? '';
  await page.locator(sel.eraseConfirmName).fill(label);
  await page.locator(sel.eraseConfirmOk).click();
};

/** Start instance by Kid (or ctx) instance id. */
export const start_instance: IntentFn = async ({ page, instanceId }) => {
  await page.locator(sel.opOverview).or(page.locator(sel.networkTree)).first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  const id = instanceId ?? DURATION_FIXTURES.kolibri.instanceId;
  await page.locator(sel.startInstance(id)).click();
};

/** Stop instance by Kid (or ctx) instance id. */
export const stop_instance: IntentFn = async ({ page, instanceId }) => {
  await page.locator(sel.opOverview).or(page.locator(sel.networkTree)).first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  const id = instanceId ?? DURATION_FIXTURES.kolibri.instanceId;
  await page.locator(sel.stopInstance(id)).click();
};

/** Open Account panel (op-entry). */
export const open_account: IntentFn = async ({ page }) => {
  await page.locator(sel.accountBtn).click();
  await page.locator(sel.opEntry).waitFor({ state: 'visible', timeout: 10_000 });
};

/** Close Account panel via status-bar toggle. */
export const close_account: IntentFn = async ({ page }) => {
  await page.locator(sel.opEntry).waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator(sel.accountBtn).click();
};

/** Open Settings panel. */
export const open_settings: IntentFn = async ({ page }) => {
  await page.locator(sel.settingsBtn).click();
  await page.locator(sel.settingsPanel).waitFor({ state: 'visible', timeout: 10_000 });
};

/** Close Settings panel via status-bar toggle. */
export const close_settings: IntentFn = async ({ page }) => {
  await page.locator(sel.settingsPanel).waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator(sel.settingsBtn).click();
};

/**
 * Demo Sign in — fill admin / admin911! when login-form is visible, submit.
 * Thin stub for operator entry after open_console_as_operator.
 */
export const sign_in: IntentFn = async ({ page }) => {
  const form = page.locator(sel.loginForm);
  await form.waitFor({ state: 'visible', timeout: 15_000 });
  const user = form.locator('input[autocomplete="username"]');
  const pass = form.locator('input[autocomplete="current-password"]');
  if (await user.count()) await user.fill('admin');
  if (await pass.count()) await pass.fill('admin911!');
  const submit = page.locator(sel.signIn);
  if (await submit.count()) await submit.click();
  else await form.locator('button[type="submit"]').click();
  // After login Account may stay open; operator overview is available underneath
  await page.locator(sel.opOverview).or(page.locator(sel.opEntry)).first()
    .waitFor({ state: 'visible', timeout: 15_000 });
};

/** Open "Make this a Files Disk" card on EmptyDiskPanel. */
export const make_files_disk: IntentFn = async ({ page }) => {
  await page.locator(sel.emptyDiskPanel).or(page.locator(sel.makeFilesDisk)).first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator(sel.makeFilesDisk).click();
};

/** Open Add Files flow on a Files / App / Backup DiskView. */
export const add_files: IntentFn = async ({ page }) => {
  await page.locator(sel.addFiles).waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator(sel.addFiles).click();
};
