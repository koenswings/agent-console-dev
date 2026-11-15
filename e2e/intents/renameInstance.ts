/**
 * rename_instance — change an instance display name via rename-instance-*,
 * assert the new name, then rename it back so duration fixtures stay unchanged
 * (console#171, engine#220).
 *
 * Fails clearly when the Engine lacks the renameInstance capability (the
 * pencil control is hidden).
 */
import type { Page } from '@playwright/test';
import type { IntentFn } from './types';
import { sel } from './selectors';
import { resolveStartInstanceId } from './operatorActions';

export const RENAME_INSTANCE_ENV = 'DURATION_RENAME_INSTANCE_ID';
export const RENAME_TEMP_NAME_ENV = 'DURATION_RENAME_TEMP_NAME';
export const DEFAULT_RENAME_TEMP_NAME = 'Walk rename';

export function resolveRenameInstanceId(
  instanceId?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env[RENAME_INSTANCE_ENV]?.trim() || resolveStartInstanceId(instanceId, env);
}

export function resolveRenameTempName(
  original: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env[RENAME_TEMP_NAME_ENV]?.trim();
  if (raw && raw !== original) return raw;
  if (original !== DEFAULT_RENAME_TEMP_NAME) return DEFAULT_RENAME_TEMP_NAME;
  return `${DEFAULT_RENAME_TEMP_NAME} 2`;
}

export function missingRenameCapabilityMessage(instanceId: string, intent = 'rename_instance'): string {
  return (
    `idea#168 ${intent}: [data-testid="rename-instance-btn-${instanceId}"] is not visible — ` +
    `the Engine does not advertise the renameInstance capability. No soft-pass.`
  );
}

const ensureTree = async (page: Page): Promise<void> => {
  await page
    .locator(sel.opOverview)
    .or(page.locator(sel.networkTree))
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
};

const revealInstanceRow = async (page: Page, id: string, intent: string): Promise<void> => {
  const allApps = page.locator(sel.networkAllApps);
  if (await allApps.isVisible().catch(() => false)) {
    await allApps.click().catch(() => {});
  }
  const row = page.locator(sel.instance(id));
  if (!(await row.isVisible().catch(() => false))) {
    await row.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  }
  if (!(await row.isVisible().catch(() => false))) {
    throw new Error(
      `idea#168 ${intent}: instance row ${id} is not visible on overview/ALL APPS. No soft-pass.`,
    );
  }
  await row.click().catch(() => {});
};

const readDisplayedName = async (page: Page, id: string): Promise<string> => {
  const btn = page.locator(sel.renameInstanceBtn(id));
  const label = ((await btn.getAttribute('aria-label')) ?? '').trim();
  const fromBtn = label.startsWith('Rename ') ? label.slice('Rename '.length).trim() : '';
  if (fromBtn) return fromBtn;
  const row = page.locator(sel.instance(id));
  const text = ((await row.locator('.instance-row__name').textContent()) ?? '')
    .replace(/✎/g, '')
    .trim();
  return text;
};

const waitForDisplayedName = async (
  page: Page,
  id: string,
  expected: string,
  intent: string,
): Promise<void> => {
  const err = page.locator(`[data-testid="rename-instance-${id}-error"]`);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await err.isVisible().catch(() => false)) {
      const msg = ((await err.textContent()) ?? '').trim();
      throw new Error(`idea#168 ${intent}: rename failed — "${msg}". No soft-pass.`);
    }
    if (!(await page.locator(sel.renameInstanceInput(id)).isVisible().catch(() => false))) {
      const got = await readDisplayedName(page, id);
      if (got === expected) return;
    }
    await page.waitForTimeout(200);
  }
  const got = await readDisplayedName(page, id);
  throw new Error(
    `idea#168 ${intent}: expected the instance name to become "${expected}" ` +
      `but it was "${got || '(none)'}" after 60s. No soft-pass.`,
  );
};

const applyRename = async (
  page: Page,
  id: string,
  nextName: string,
  intent: string,
): Promise<void> => {
  const btn = page.locator(sel.renameInstanceBtn(id));
  await btn.waitFor({ state: 'visible', timeout: 10_000 });
  await btn.click();
  const input = page.locator(sel.renameInstanceInput(id));
  await input.waitFor({ state: 'visible', timeout: 10_000 });
  await input.fill(nextName);
  const problem = page.locator(sel.renameInstanceProblem(id));
  if (await problem.isVisible().catch(() => false)) {
    const msg = ((await problem.textContent()) ?? '').trim();
    throw new Error(
      `idea#168 ${intent}: name "${nextName}" was rejected — "${msg}". No soft-pass.`,
    );
  }
  const save = page.locator(sel.renameInstanceSave(id));
  if (await save.isDisabled().catch(() => true)) {
    throw new Error(
      `idea#168 ${intent}: Save stayed disabled for "${nextName}". No soft-pass.`,
    );
  }
  await save.click();
  await waitForDisplayedName(page, id, nextName, intent);
};

export const rename_instance: IntentFn = async ({ page, instanceId }) => {
  const intent = 'rename_instance';
  await ensureTree(page);
  const id = resolveRenameInstanceId(instanceId);
  await revealInstanceRow(page, id, intent);

  const btn = page.locator(sel.renameInstanceBtn(id));
  if (!(await btn.isVisible().catch(() => false))) {
    try {
      await btn.waitFor({ state: 'visible', timeout: 8_000 });
    } catch {
      /* fall through */
    }
  }
  if (!(await btn.isVisible().catch(() => false))) {
    throw new Error(missingRenameCapabilityMessage(id, intent));
  }

  const original = await readDisplayedName(page, id);
  if (!original) {
    throw new Error(
      `idea#168 ${intent}: could not read the current display name of ${id}. No soft-pass.`,
    );
  }
  const temp = resolveRenameTempName(original);
  await applyRename(page, id, temp, intent);
  await applyRename(page, id, original, intent);
};
