/**
 * Last ejectDisk command outcome, as a durable DOM marker (console#235).
 *
 * EjectConfirm unmounts as soon as Eject is clicked, before the Engine
 * answers, so a hidden dialog is not success. confirm_eject reads this
 * marker and whether the disk left the NetworkTree.
 */
export const EJECT_COMMAND_RESULT_TESTID = 'eject-command-result';

export type EjectCommandResultOutcome = {
  status: 'ok' | 'error' | 'timeout';
  targetId: string;
  message?: string;
};

export type EjectCommandResultMarker = {
  seq: number;
  status: string;
  targetId: string;
  error: string | null;
};

const selector = `[data-testid="${EJECT_COMMAND_RESULT_TESTID}"]`;

const node = (): HTMLElement | null =>
  typeof document === 'undefined' ? null : document.querySelector<HTMLElement>(selector);

export const clearEjectCommandResult = (): void => {
  node()?.remove();
};

export const publishEjectCommandResult = (outcome: EjectCommandResultOutcome): void => {
  if (typeof document === 'undefined') return;
  let el = node();
  const prevSeq = Number(el?.getAttribute('data-seq') ?? '0') || 0;
  if (!el) {
    el = document.createElement('div');
    el.setAttribute('data-testid', EJECT_COMMAND_RESULT_TESTID);
    el.setAttribute('hidden', '');
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
  }
  el.setAttribute('data-seq', String(prevSeq + 1));
  el.setAttribute('data-status', outcome.status);
  el.setAttribute('data-target-id', outcome.targetId);
  if (outcome.status === 'error' || outcome.status === 'timeout') {
    el.setAttribute('data-error', outcome.message?.trim() || 'Eject failed.');
  } else {
    el.removeAttribute('data-error');
  }
};

export const readEjectCommandResult = (): EjectCommandResultMarker | null => {
  const el = node();
  if (!el) return null;
  const status = el.getAttribute('data-status');
  if (!status) return null;
  return {
    seq: Number(el.getAttribute('data-seq') ?? '0') || 0,
    status,
    targetId: el.getAttribute('data-target-id') ?? '',
    error: el.getAttribute('data-error'),
  };
};
