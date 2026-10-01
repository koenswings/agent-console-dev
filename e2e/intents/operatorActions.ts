/**
 * Operator Intents (idea#166/#168): real Console click sequences for eject /
 * erase / start-stop / account / settings / Files Disk edges.
 *
 * ACTIONS.md: eject_disk, stay_on_overview (dwell in stayOnOverview.ts).
 * Proposal snake_case for remaining operator edges.
 */
import type { IntentFn } from './types';
import { sel } from './selectors';
import { DURATION_FIXTURES } from './fixtures';

/** Click eject-<diskId> → wait for eject-confirm (ACTIONS.md `eject_disk`). */
export const eject_disk: IntentFn = async ({ page, diskId }) => {
  await page.locator(sel.opOverview).or(page.locator(sel.networkTree)).first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  const id = diskId ?? DURATION_FIXTURES.kolibri.diskId;
  const btn = page.locator(sel.eject(id));
  await btn.waitFor({ state: 'visible', timeout: 15_000 });
  await btn.click();
  await page.locator(sel.ejectConfirm).waitFor({ state: 'visible', timeout: 10_000 });
};

export const confirm_eject: IntentFn = async ({ page }) => {
  await page.locator(sel.ejectConfirm).waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator(sel.ejectConfirmOk).click();
  await page.locator(sel.ejectConfirm).waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
};

export const cancel_eject: IntentFn = async ({ page }) => {
  await page.locator(sel.ejectConfirm).waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator(sel.ejectConfirmCancel).click();
  await page.locator(sel.ejectConfirm).waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
};

export const erase_disk: IntentFn = async ({ page }) => {
  const btn = page.locator(sel.eraseThisDisk);
  await btn.waitFor({ state: 'visible', timeout: 15_000 });
  await btn.click();
  await page.locator(sel.eraseDialog).waitFor({ state: 'visible', timeout: 15_000 });
};

export const cancel_erase: IntentFn = async ({ page }) => {
  await page.locator(sel.eraseDialog).waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator(sel.eraseCancel).click();
  await page.locator(sel.eraseDialog).waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
};

/** Type live summary label into erase-confirm-name, then confirm. */
export const confirm_erase: IntentFn = async ({ page }) => {
  const dialog = page.locator(sel.eraseDialog);
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  const strong = dialog.locator('label[for="erase-confirm-name"] strong');
  await strong.waitFor({ state: 'visible', timeout: 30_000 });
  const label = (await strong.textContent())?.trim() ?? '';
  await page.locator(sel.eraseConfirmName).fill(label);
  await page.locator(sel.eraseConfirmOk).click();
};

export const start_instance: IntentFn = async ({ page, instanceId }) => {
  await page.locator(sel.opOverview).or(page.locator(sel.networkTree)).first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  const id = instanceId ?? DURATION_FIXTURES.kolibri.instanceId;
  const btn = page.locator(sel.startInstance(id));
  await btn.waitFor({ state: 'visible', timeout: 15_000 });
  await btn.click();
};

export const stop_instance: IntentFn = async ({ page, instanceId }) => {
  await page.locator(sel.opOverview).or(page.locator(sel.networkTree)).first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  const id = instanceId ?? DURATION_FIXTURES.kolibri.instanceId;
  const btn = page.locator(sel.stopInstance(id));
  await btn.waitFor({ state: 'visible', timeout: 15_000 });
  await btn.click();
};

export const open_account: IntentFn = async ({ page }) => {
  await page.locator(sel.accountBtn).click();
  await page.locator(sel.opEntry).waitFor({ state: 'visible', timeout: 10_000 });
};

export const close_account: IntentFn = async ({ page }) => {
  await page.locator(sel.opEntry).waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator(sel.accountBtn).click();
};

export const open_settings: IntentFn = async ({ page }) => {
  await page.locator(sel.settingsBtn).click();
  await page.locator(sel.settingsPanel).waitFor({ state: 'visible', timeout: 10_000 });
};

export const close_settings: IntentFn = async ({ page }) => {
  await page.locator(sel.settingsPanel).waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator(sel.settingsBtn).click();
};

/**
 * Sign in (proposal) — fill demo admin, submit, land on op_overview + NetworkTree.
 */
export const sign_in: IntentFn = async ({ page }) => {
  // Ensure Account panel open
  if (!(await page.locator(sel.loginForm).isVisible().catch(() => false))) {
    await page.locator(sel.accountBtn).click();
  }
  const form = page.locator(sel.loginForm);
  await form.waitFor({ state: 'visible', timeout: 15_000 });
  await form.locator('input[autocomplete="username"]').fill('admin');
  await form.locator('input[autocomplete="current-password"]').fill('admin911!');
  const submit = page.locator(sel.signIn);
  if (await submit.count()) await submit.click();
  else await form.locator('button[type="submit"]').click();

  // Close Account overlay if still open so operator layout is usable
  const entry = page.locator(sel.opEntry);
  if (await entry.isVisible().catch(() => false)) {
    await page.locator(sel.accountBtn).click().catch(() => {});
  }
  await page.locator(sel.opOverview).waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator(sel.networkTree).waitFor({ state: 'visible', timeout: 10_000 });
};

/**
 * Make Files Disk (proposal) — EmptyDiskPanel card → share name → submit.
 */
export const make_files_disk: IntentFn = async ({ page }) => {
  await page.locator(sel.emptyDiskPanel).or(page.locator(sel.makeFilesDisk)).first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  if (await page.locator(sel.makeFilesDisk).count()) {
    await page.locator(sel.makeFilesDisk).click();
  }
  const share = page.locator(sel.filesShareName);
  await share.waitFor({ state: 'visible', timeout: 10_000 });
  // Default "School Files" is fine; ensure non-empty then submit
  const v = await share.inputValue();
  if (!v.trim()) await share.fill('School Files');
  await page.locator(sel.filesShareSubmit).click();
};

/**
 * Add Files role (proposal snake_case) — DiskView Add Files → share name → submit.
 */
export const add_files_role: IntentFn = async ({ page }) => {
  const addBtn = page.locator(sel.addFiles);
  if (await addBtn.count()) {
    await addBtn.click();
  }
  const share = page.locator(sel.filesShareName);
  await share.waitFor({ state: 'visible', timeout: 15_000 });
  const v = await share.inputValue();
  if (!v.trim()) await share.fill('School Files');
  await page.locator(sel.filesShareSubmit).click();
};

/** @deprecated Alias — prefer add_files_role (proposal title). */
export const add_files = add_files_role;
