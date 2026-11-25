/**
 * One way out for every Console command (agent-engine-dev#582).
 *
 * The path depends on the target Engine (commandPath):
 *   'signed'  — it has signedCommands1: POST /api/command through
 *               signedCommand.ts, with the Engine's confirmation dialog (428)
 *               and grants (409). Needs engine mode.
 *   'queue'   — written into the store queue as before: an Engine without
 *               signedCommands1 (it may have engineSignIn1: sign-in only).
 *   'blocked' — not sent: a signed-commands Engine on a page that cannot sign
 *               (legacy mode), or an Engine without the API at all while the
 *               page's Engine takes signed commands (#582 mixed versions).
 * authMode 'probing' → nothing is sent yet.
 *
 * Every call resolves with a SendResult. Anything but 'accepted' is also put
 * in the notice signal, so the operator sees it even where the caller does
 * not show results itself.
 */
import { createSignal } from 'solid-js';
import type { Engine, Store } from '../types/store';
import { authMode, authTransport, pageAuthEngineId, pageHasCapability, pageHasRelay } from './authMode';
import { engineHasCapability } from './commands';
import { commandGateFor, olderEngineMessage, sendSignedCommand, type CommandGate, type ConfirmRequest, type SendResult } from './signedCommand';
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

/** A signed-commands Engine that the page's Engine cannot pass commands on to (no relay yet). */
export const noRelayMessage = (engineName: string): string =>
  `Commands to ${engineName} can only be sent from ${engineName}'s own Console for now. Open it there.`;

export type CommandPath =
  | { kind: 'signed' }
  | { kind: 'queue' }
  | { kind: 'blocked'; message: string };

/** How a command to `engine` goes out right now (see the header). */
export const commandPath = (engine: Engine | null | undefined): CommandPath => {
  const m = authMode();
  if (m === 'probing') return { kind: 'blocked', message: STILL_CONNECTING };
  if (!engine) return m === 'engine' ? { kind: 'blocked', message: 'This Engine is not in the store.' } : { kind: 'queue' };
  const name = String(engine.hostname ?? engine.id);
  const signed = engineHasCapability(engine, 'signedCommands1');
  if (m === 'legacy') return signed ? { kind: 'blocked', message: newerEngineMessage(name) } : { kind: 'queue' };
  if (signed) {
    const gate = commandGateFor(engine);
    if (!gate.ok) return { kind: 'blocked', message: gate.message };
    if (String(engine.id) !== pageAuthEngineId() && !pageHasRelay()) {
      return { kind: 'blocked', message: noRelayMessage(name) };
    }
    return { kind: 'signed' };
  }
  if (engineHasCapability(engine, 'engineSignIn1')) return { kind: 'queue' };
  // No sign-in API on the target: the page's Engine takes signed commands, so
  // an unsigned path to the older Engine is not offered (#582 mixed versions).
  if (pageHasCapability('signedCommands1')) {
    return { kind: 'blocked', message: olderEngineMessage(name, String(engine.version ?? 'unknown')) };
  }
  return { kind: 'queue' };
};

/**
 * May the Console send commands to `engine` right now? Derived from the mode
 * and the store; used to switch command controls off with the message.
 */
export const commandGate = (engine: Engine | null | undefined): CommandGate => {
  const p = commandPath(engine);
  return p.kind === 'blocked' ? { ok: false, message: p.message } : { ok: true };
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
  const path = commandPath(readStore()?.engineDB?.[id]);
  const t = authTransport();
  if (path.kind === 'blocked') result = { kind: 'blocked', engineId: id, message: path.message };
  else if (path.kind === 'signed') {
    result = t
      ? await sendSignedCommand({ transport: t, engines: readStore()?.engineDB ?? {}, confirm: confirmWithDialog }, id, command)
      : { kind: 'error', code: 'NETWORK_ERROR', message: STILL_CONNECTING, status: null };
  } else if (!legacySend) result = { kind: 'error', code: 'NETWORK_ERROR', message: STILL_CONNECTING, status: null };
  else {
    legacySend(id, command);
    result = { kind: 'accepted', engineId: id, seq: null };
  }
  if (result.kind === 'signInRequired') onSignInRequired(result.engineIds);
  if (result.kind !== 'accepted' && result.kind !== 'cancelled') noticeFor(result);
  return result;
}
