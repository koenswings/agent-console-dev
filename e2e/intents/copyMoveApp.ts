/**
 * copy_app / move_app — real multi-disk HTML5 drag + Copy/Move modal (idea#168).
 * Prefer A: both duration disks docked on overview (no demo remap).
 *
 * Engine preload (Axle):
 * - demoMode=false; Engine :8080 production web
 * - ≥2 docked disks: duration-kolibri-grade5a-001 + duration-nextcloud-grade5a-001
 * - Source disk has copyable instance card (kolibri-grade5a-001 or nextcloud-…)
 * - Target disk accepts drop (different diskId in NetworkTree)
 */
import type { Page } from '@playwright/test';
import type { IntentContext, IntentFn } from './types';
import { sel } from './selectors';
import { DURATION_FIXTURES } from './fixtures';

export interface CopyMovePair {
  sourceDiskId: string;
  targetDiskId: string;
  instanceId: string;
  op: 'copy' | 'move';
}

/** Resolve source/target/instance for duration fixtures (env overrides allowed). */
export function resolveCopyMovePair(
  ctx: Pick<IntentContext, 'diskId' | 'instanceId'>,
  op: 'copy' | 'move',
  env: NodeJS.ProcessEnv = process.env,
): CopyMovePair {
  const sourceDiskId =
    env.DURATION_COPY_SOURCE_DISK?.trim() ||
    ctx.diskId ||
    DURATION_FIXTURES.kolibri.diskId;

  const targetFromEnv = env.DURATION_COPY_TARGET_DISK?.trim();
  const targetDiskId =
    targetFromEnv ||
    (sourceDiskId === DURATION_FIXTURES.nextcloud.diskId
      ? DURATION_FIXTURES.kolibri.diskId
      : DURATION_FIXTURES.nextcloud.diskId);

  const instanceId =
    env.DURATION_COPY_INSTANCE_ID?.trim() ||
    ctx.instanceId ||
    (sourceDiskId === DURATION_FIXTURES.nextcloud.diskId
      ? DURATION_FIXTURES.nextcloud.instanceId
      : DURATION_FIXTURES.kolibri.instanceId);

  return { sourceDiskId, targetDiskId, instanceId, op };
}

const ensureOp = async (page: Page): Promise<void> => {
  await page
    .locator(sel.opOverview)
    .or(page.locator(sel.networkTree))
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
};

const preloadError = (intent: string, detail: string): Error =>
  new Error(
    `idea#168 ${intent}: ${detail} ` +
      `Engine preload: dock BOTH duration-kolibri-grade5a-001 AND duration-nextcloud-grade5a-001 ` +
      `on overview (Path A / infra_dock_fixture), demoMode=false, source disk must show a ` +
      `draggable instance card (data-copyable=true). No demo DISK001 remap.`,
  );

/**
 * HTML5 drag that Solid onDragStart can see (sets App dragData signal).
 * NetworkTree onDrop reads that signal — not dataTransfer alone.
 */
export async function dragInstanceOntoDisk(
  page: Page,
  instanceSel: string,
  targetDiskSel: string,
): Promise<void> {
  const source = page.locator(instanceSel).first();
  const target = page.locator(targetDiskSel).first();

  // 1) Playwright native dragTo (fires dragstart → Solid setDragData)
  try {
    await source.dragTo(target, { force: true, timeout: 12_000 });
  } catch {
    /* fall through to synthetic events */
  }

  if (await page.locator(sel.copyMoveModal).isVisible().catch(() => false)) return;

  // 2) Synthetic DragEvents on the same elements (still invoke Solid handlers)
  const ok = await page.evaluate(
    ({ src, dst }) => {
      const sourceEl = document.querySelector(src);
      const targetEl = document.querySelector(dst);
      if (!sourceEl || !targetEl) return false;
      const dt = new DataTransfer();
      const fire = (el: Element, type: string) => {
        el.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }),
        );
      };
      fire(sourceEl, 'dragstart');
      fire(targetEl, 'dragenter');
      fire(targetEl, 'dragover');
      fire(targetEl, 'drop');
      fire(sourceEl, 'dragend');
      return true;
    },
    { src: instanceSel, dst: targetDiskSel },
  );
  if (!ok) {
    throw new Error('dragInstanceOntoDisk: source or target element not in DOM');
  }
}

const runCopyOrMove = async (ctx: IntentContext, op: 'copy' | 'move'): Promise<void> => {
  const intent = op === 'copy' ? 'copy_app' : 'move_app';
  const { page } = ctx;
  await ensureOp(page);

  const pair = resolveCopyMovePair(ctx, op);
  if (pair.sourceDiskId === pair.targetDiskId) {
    throw preloadError(
      intent,
      `source and target diskId are the same (${pair.sourceDiskId}).`,
    );
  }

  const sourceDisk = page.locator(sel.disk(pair.sourceDiskId));
  const targetDisk = page.locator(sel.disk(pair.targetDiskId));

  if (!(await sourceDisk.isVisible().catch(() => false))) {
    throw preloadError(
      intent,
      `source disk ${pair.sourceDiskId} not visible on NetworkTree.`,
    );
  }
  if (!(await targetDisk.isVisible().catch(() => false))) {
    throw preloadError(
      intent,
      `target disk ${pair.targetDiskId} not visible — need ≥2 docked disks.`,
    );
  }

  // Select source disk so InstanceRow is in the right panel (DiskView Apps list)
  await sourceDisk.click();
  await page
    .locator(sel.diskView(pair.sourceDiskId))
    .or(page.locator(sel.instance(pair.instanceId)))
    .first()
    .waitFor({ state: 'visible', timeout: 12_000 })
    .catch(() => {});

  const instance = page.locator(sel.instance(pair.instanceId));
  if (!(await instance.isVisible().catch(() => false))) {
    // Try All apps list
    const allApps = page.locator(sel.networkAllApps);
    if (await allApps.count()) await allApps.click().catch(() => {});
    await instance.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  }
  if (!(await instance.isVisible().catch(() => false))) {
    throw preloadError(
      intent,
      `instance ${pair.instanceId} not visible on source disk ${pair.sourceDiskId} ` +
        `(need Running/Stopped instance card restored after dock).`,
    );
  }

  const copyable = await instance.getAttribute('data-copyable');
  if (copyable === 'false') {
    throw preloadError(
      intent,
      `instance ${pair.instanceId} is not copyable (missing storedOn / disk in store).`,
    );
  }

  // Modal may already be open from a prior drop
  if (!(await page.locator(sel.copyMoveModal).isVisible().catch(() => false))) {
    await dragInstanceOntoDisk(page, sel.instance(pair.instanceId), sel.disk(pair.targetDiskId));
  }

  const modal = page.locator(sel.copyMoveModal);
  try {
    await modal.waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    throw preloadError(
      intent,
      `copy-move-modal did not open after dragging ${pair.instanceId} onto ${pair.targetDiskId}. ` +
        `Confirm HTML5 drop target on NetworkTree disk row and that App dragData was set.`,
    );
  }

  const confirmBtn =
    op === 'copy' ? page.locator(sel.copyMoveCopy) : page.locator(sel.copyMoveMove);
  await confirmBtn.click();
  await modal.waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => {});
};

export const copy_app: IntentFn = async (ctx) => runCopyOrMove(ctx, 'copy');
export const move_app: IntentFn = async (ctx) => runCopyOrMove(ctx, 'move');
