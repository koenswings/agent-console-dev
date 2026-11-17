/**
 * Last eraseDisk command outcome, as a durable DOM marker (console#233).
 *
 * EraseDialog unmounts on onErasedEmpty as soon as the disk is Empty, so
 * [data-testid="erase-complete"] may never stay visible. The marker lives on
 * document.body and is what confirm_erase reads after the dialog closes.
 */
export const ERASE_COMMAND_RESULT_TESTID = 'erase-command-result';

export type EraseCommandResultOutcome = {
  status: 'ok' | 'error';
  targetId: string;
  diskId?: string | null;
  message?: string;
};

export type EraseCommandResultMarker = {
  seq: number;
  status: string;
  targetId: string;
  diskId: string | null;
  error: string | null;
};

const selector = `[data-testid="${ERASE_COMMAND_RESULT_TESTID}"]`;

const node = (): HTMLElement | null =>
  typeof document === 'undefined' ? null : document.querySelector<HTMLElement>(selector);

/** Remove a previous eraseDisk outcome so the next confirm is not stale. */
export const clearEraseCommandResult = (): void => {
  node()?.remove();
};

/** Publish the Engine eraseDisk command-log outcome for the walk Intent. */
export const publishEraseCommandResult = (outcome: EraseCommandResultOutcome): void => {
  if (typeof document === 'undefined') return;
  let el = node();
  const prevSeq = Number(el?.getAttribute('data-seq') ?? '0') || 0;
  if (!el) {
    el = document.createElement('div');
    el.setAttribute('data-testid', ERASE_COMMAND_RESULT_TESTID);
    el.setAttribute('hidden', '');
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
  }
  el.setAttribute('data-seq', String(prevSeq + 1));
  el.setAttribute('data-status', outcome.status);
  el.setAttribute('data-target-id', outcome.targetId);
  if (outcome.status === 'ok' && outcome.diskId) {
    el.setAttribute('data-disk-id', outcome.diskId);
  } else {
    el.removeAttribute('data-disk-id');
  }
  if (outcome.status === 'error') {
    el.setAttribute('data-error', outcome.message?.trim() || 'Erase failed.');
  } else {
    el.removeAttribute('data-error');
  }
};

export const readEraseCommandResult = (): EraseCommandResultMarker | null => {
  const el = node();
  if (!el) return null;
  const status = el.getAttribute('data-status');
  if (!status) return null;
  return {
    seq: Number(el.getAttribute('data-seq') ?? '0') || 0,
    status,
    targetId: el.getAttribute('data-target-id') ?? '',
    diskId: el.getAttribute('data-disk-id'),
    error: el.getAttribute('data-error'),
  };
};
