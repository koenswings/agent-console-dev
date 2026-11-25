/**
 * One way out for every Console command (agent-engine-dev#582).
 *
 *   authMode 'engine'  → POST /api/command through signedCommand.ts, with the
 *                        Engine's confirmation dialog (428) and grants (409).
 *   authMode 'legacy'  → written into the store as before (the page's Engine
 *                        predates #582). A target that only takes signed
 *                        commands is not written to: it would refuse it.
 *   authMode 'probing' → nothing is sent yet.
 *
 * Every call resolves with a SendResult. Anything but 'accepted' is also put
 * in the notice signal, so the operator sees it even where the caller does
 * not show results itself.
 */
import { createSignal } from 'solid-js';
import type { Engine, Store } from '../types/store';
import { authMode, authTransport } from './authMode';
import { engineHasCapability } from './commands';
import { commandGateFor, sendSignedCommand, type CommandGate, type ConfirmRequest, type SendResult } from './signedCommand';
import { requestEngineConfirm } from './engineConfirm';

type LegacySend = (engineId: string, command: string) => void;

let legacySend: LegacySend | null = null;
let readStore: () => Store | null = () => null;
let onSignInRequired: (engineIds: string[]) => void = () => undefined;

/** Wire the router to the current connection (App). */
export const configureCommandRouter = (opts: {
  legacySend: LegacySend | null;
  store: () => Store | null;
  onSignInRequired?: (engineIds: string[]) => void;
}): void => {
  legacySend = opts.legacySend;
  readStore = opts.store;
  onSignInRequired = opts.onSignInRequired ?? (() => undefined);
};

/** Message for a target that only takes signed commands, on a page served by an older Engine. */
export const newerEngineMessage = (engineName: string): string =>
  `${engineName} only takes commands from a signed-in operator on a newer Console. Open ${engineName}'s own Console to manage it.`;

const STILL_CONNECTING = 'Still connecting to the Engine. Try again in a moment.';

/**
 * May the Console send commands to `engine` right now? Derived from the mode
 * and the store; used to switch command controls off with the message.
 */
export const commandGate = (engine: Engine | null | undefined): CommandGate => {
  const m = authMode();
  if (m === 'engine') return commandGateFor(engine);
  if (m === 'probing') return { ok: false, message: STILL_CONNECTING };
  if (engine && engineHasCapability(engine, 'signedCommands1')) {
    return { ok: false, message: newerEngineMessage(String(engine.hostname ?? engine.id)) };
  }
  return { ok: true };
};

/** The gate for an Engine id in the current store. */
export const commandGateForId = (engineId: string | null | undefined): CommandGate =>
  engineId ? commandGate(readStore()?.engineDB?.[engineId]) : { ok: true };

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

export interface CommandNotice {
  id: number;
  engineId: string | null;
  kind: 'blocked' | 'signInRequired' | 'error';
  message: string;
}

const [notices, setNotices] = createSignal<readonly CommandNotice[]>([]);
let nextNoticeId = 1;

/** Command results the operator has not dismissed yet (newest last, at most 3). */
export const commandNotices = notices;

export const dismissCommandNotice = (id: number): void => {
  setNotices((prev) => prev.filter((n) => n.id !== id));
};

export const clearCommandNotices = (): void => { setNotices([]); };

const pushNotice = (n: Omit<CommandNotice, 'id'>): void => {
  setNotices((prev) => {
    const same = prev.find((p) => p.engineId === n.engineId && p.message === n.message);
    if (same) return prev;
    return [...prev, { ...n, id: nextNoticeId++ }].slice(-3);
  });
};

const nameOf = (engineId: string): string => String(readStore()?.engineDB?.[engineId]?.hostname ?? engineId);

/** Show the result of a command that was not accepted. */
export const noticeFor = (r: SendResult): void => {
  if (r.kind === 'blocked') pushNotice({ engineId: r.engineId, kind: 'blocked', message: r.message });
  else if (r.kind === 'signInRequired') {
    const names = r.engineIds.map(nameOf).join(', ');
    pushNotice({ engineId: r.engineIds[0] ?? null, kind: 'signInRequired', message: `Sign in again to send commands to ${names}.` });
  } else if (r.kind === 'error') pushNotice({ engineId: null, kind: 'error', message: r.message });
};

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const confirmWithDialog = (req: ConfirmRequest): Promise<string | null> =>
  requestEngineConfirm(req, nameOf(req.engineId));

/** Send `command` to `engineId` on the path the mode selects. Never throws. */
export async function dispatchCommand(engineId: string, command: string): Promise<SendResult> {
  const id = String(engineId);
  let result: SendResult;
  const m = authMode();
  const t = authTransport();
  if (m === 'engine' && t) {
    result = await sendSignedCommand(
      { transport: t, engines: readStore()?.engineDB ?? {}, confirm: confirmWithDialog },
      id,
      command,
    );
  } else {
    const gate = commandGate(readStore()?.engineDB?.[id]);
    if (!gate.ok) result = { kind: 'blocked', engineId: id, message: gate.message };
    else if (!legacySend) result = { kind: 'error', code: 'NETWORK_ERROR', message: STILL_CONNECTING, status: null };
    else {
      legacySend(id, command);
      result = { kind: 'accepted', engineId: id, seq: null };
    }
  }
  if (result.kind === 'signInRequired') onSignInRequired(result.engineIds);
  if (result.kind !== 'accepted' && result.kind !== 'cancelled') noticeFor(result);
  return result;
}
