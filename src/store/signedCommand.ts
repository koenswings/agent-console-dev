/**
 * Commands through the Engine API (agent-engine-dev#582 §5).
 *
 * POST /api/command (or /api/engines/<id>/command through the relay) with the
 * Engine's session token. The Engine signs the entry into its own queue and
 * answers 202 { engineId, seq }; the result is followed in the command log by
 * that seq. Two extra rounds can happen before the 202:
 *   - 428 CONFIRM_REQUIRED: show the Engine's summary, then resend with
 *     confirmId + the typed confirmText;
 *   - 409 GRANT_REQUIRED: get a grant from each listed Engine, then resend
 *     with `grants`.
 * An Engine without `signedCommands1` gets nothing: its command controls are
 * switched off and the older-Engine message is shown instead.
 */
import { createSignal } from 'solid-js';
import type { Engine } from '../types/store';
import { apiCall, EngineApiError, type EngineApiTransport } from './engineApi';
import { requestGrant } from './engineAuth';
import { engineHasCapability } from './commands';
import { dropEngineSession, tokenFor } from './engineTokens';

/** Exact text for an Engine that runs an older version (§5). */
export const olderEngineMessage = (engineName: string, version: string): string =>
  `${engineName} runs an older Engine version (${version}). Commands to it are switched off until it is updated. Its apps and disks keep syncing.`;

/**
 * Engines the relay reported as ENGINE_VERSION_MISMATCH during this page,
 * with the version it reported. Covers an Engine whose store record still
 * claims the capability (for example right after a rollback).
 */
const [mismatched, setMismatched] = createSignal<Readonly<Record<string, string>>>({});

export const noteEngineVersionMismatch = (engineId: string, version: string): void => {
  const id = String(engineId);
  if (mismatched()[id] === version) return;
  setMismatched((prev) => ({ ...prev, [id]: version }));
};

/** For tests and a new connection. */
export const resetEngineVersionMismatches = (): void => { setMismatched({}); };

export type CommandGate = { ok: true } | { ok: false; message: string };

/**
 * May the Console send commands to `engine`? Derived from the store record and
 * any mismatch the relay reported; nothing is sent to find out.
 */
export const commandGateFor = (engine: Engine | null | undefined): CommandGate => {
  if (!engine) return { ok: false, message: 'This Engine is not in the store.' };
  const name = String(engine.hostname ?? engine.id);
  const reported = mismatched()[String(engine.id)];
  if (reported !== undefined) return { ok: false, message: olderEngineMessage(name, reported) };
  if (!engineHasCapability(engine, 'signedCommands1')) return { ok: false, message: olderEngineMessage(name, String(engine.version ?? 'unknown')) };
  return { ok: true };
};

/** What the Engine sent with 428 CONFIRM_REQUIRED. */
export interface ConfirmRequest {
  engineId: string;
  command: string;
  confirmId: string;
  summary: unknown;
  expiresInMs: number;
  /** Which value the operator types: the disk label, the card size or the app name. */
  confirmField: 'label' | 'sizeBytes' | 'appName' | string;
  message: string;
}

export interface SendDeps {
  transport: EngineApiTransport;
  /** Engine records by id (names for messages, capability gate). */
  engines: Readonly<Record<string, Engine>>;
  /**
   * Show the Engine's confirmation dialog. Resolve with the typed text, or
   * null when the operator cancels.
   */
  confirm?: (req: ConfirmRequest) => Promise<string | null>;
}

export type SendResult =
  /** Sent. `seq` is the Engine's queue number; null on the legacy path (written into the store). */
  | { kind: 'accepted'; engineId: string; seq: number | null }
  /** Nothing was sent: the Engine runs an older version, or is not in the store. */
  | { kind: 'blocked'; engineId: string; message: string }
  /** A sign-in is needed for these Engines (no token, or the token ended). */
  | { kind: 'signInRequired'; engineIds: string[] }
  | { kind: 'cancelled' }
  | { kind: 'error'; code: string; message: string; status: number | null };

/** Rounds before giving up (first send, confirm, grants, one spare). */
const MAX_ROUNDS = 4;

const engineName = (engines: SendDeps['engines'], id: string): string =>
  String(engines[id]?.hostname ?? id);

/**
 * The Engine that issued (or was asked for) a grant: `issuerEngineId` in the
 * error body (pixel-answers F1: the only field that names it), else `fallback`.
 */
export const grantIssuer = (err: EngineApiError, fallback: string): string => {
  const v = err.body.issuerEngineId;
  return typeof v === 'string' && v ? v : fallback;
};

/** Text for a failed grant request to `issuerId` (POST /auth/grant). */
export const grantErrorText = (err: EngineApiError, engines: SendDeps['engines'], issuerId: string): string => {
  const name = engineName(engines, grantIssuer(err, issuerId));
  switch (err.code) {
    case 'GRANT_INVALID':
    case 'GRANT_EXPIRED':
      return `Permission from ${name} expired. Start again.`;
    case 'ENGINE_UNREACHABLE':
    case 'NETWORK_ERROR':
      return `${name} cannot be reached right now, so it cannot give permission. Start again later.`;
    default:
      return `${name} did not give permission: ${err.message}`;
  }
};

/** 503 STORE_NOT_READY (pixel-answers F10): like an unreachable Engine, try again. */
export const storeNotReadyText = (engineName: string): string =>
  `${engineName} is still starting and is not ready for commands yet. Try again in a moment.`;

/** 422 COMMAND_REFUSED reason local-only (createInstance, pixel-answers F8). */
export const localOnlyText = (engineName: string): string =>
  `This can only be run on ${engineName} itself, not from the Console. To add an app, install it from the app list.`;

/** Console text for an error code (§5 error table). */
export const commandErrorText = (err: EngineApiError, engines: SendDeps['engines'], engineId: string): string => {
  switch (err.code) {
    case 'CONFIRM_INVALID':
      return 'The confirmation expired or did not match. Start again.';
    case 'GRANT_INVALID':
    case 'GRANT_EXPIRED':
      return `Permission from ${engineName(engines, grantIssuer(err, engineId))} expired. Start again.`;
    case 'ENGINE_UNKNOWN':
      return 'This Engine is not in the store.';
    case 'BODY_TOO_LARGE':
      return 'That command is too long for the Engine.';
    case 'ENGINE_UNREACHABLE':
      return `${engineName(engines, engineId)} cannot be reached right now.`;
    case 'STORE_NOT_READY':
      return storeNotReadyText(engineName(engines, engineId));
    case 'COMMAND_REFUSED':
      return err.body.reason === 'local-only' ? localOnlyText(engineName(engines, engineId)) : err.message;
    case 'NETWORK_ERROR':
      return `${engineName(engines, engineId)} cannot be reached right now.`;
    default:
      return err.message;
  }
};

const isTokenGone = (e: EngineApiError): boolean =>
  e.code === 'TOKEN_INVALID' || e.code === 'TOKEN_EXPIRED' || e.code === 'AUTH_REQUIRED';

/**
 * Send `command` (the plain command string, as today) to `engineId`.
 * Never throws; every outcome is a SendResult.
 */
export async function sendSignedCommand(deps: SendDeps, engineId: string, command: string): Promise<SendResult> {
  const id = String(engineId);
  const gate = commandGateFor(deps.engines[id]);
  if (!gate.ok) return { kind: 'blocked', engineId: id, message: gate.message };

  const body: { command: string; confirmId?: string; confirmText?: string; grants?: Record<string, string> } = { command };
  let confirmed = false;
  let granted = false;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const token = tokenFor(id);
    if (!token) return { kind: 'signInRequired', engineIds: [id] };
    try {
      const { data } = await apiCall<{ engineId: string; seq: number }>(deps.transport, '/command', {
        engineId: id, token, body,
      });
      return { kind: 'accepted', engineId: String(data?.engineId ?? id), seq: Number(data?.seq) };
    } catch (err) {
      const e = err instanceof EngineApiError ? err : new EngineApiError(null, 'UNKNOWN', String(err));

      if (isTokenGone(e)) {
        dropEngineSession(id);
        return { kind: 'signInRequired', engineIds: [id] };
      }

      if (e.code === 'ENGINE_VERSION_MISMATCH') {
        const version = typeof e.body.version === 'string' ? e.body.version : 'unknown';
        noteEngineVersionMismatch(id, version);
        return { kind: 'blocked', engineId: id, message: olderEngineMessage(engineName(deps.engines, id), version) };
      }

      if (e.code === 'CONFIRM_REQUIRED' && !confirmed && deps.confirm) {
        const req: ConfirmRequest = {
          engineId: id,
          command,
          confirmId: String(e.body.confirmId ?? ''),
          summary: e.body.summary ?? null,
          expiresInMs: Number(e.body.expiresInMs ?? 0),
          confirmField: String(e.body.confirmField ?? ''),
          message: e.message,
        };
        const typed = await deps.confirm(req);
        if (typed === null) return { kind: 'cancelled' };
        body.confirmId = req.confirmId;
        body.confirmText = typed;
        confirmed = true;
        continue;
      }

      if (e.code === 'GRANT_REQUIRED' && !granted) {
        const from = Array.isArray(e.body.engineIds) ? e.body.engineIds.map(String) : [];
        const missing = from.filter((f) => !tokenFor(f));
        if (missing.length > 0) return { kind: 'signInRequired', engineIds: missing };
        const blocked = from.map((f) => ({ f, gate: commandGateFor(deps.engines[f]) })).find((x) => !x.gate.ok);
        if (blocked && !blocked.gate.ok) return { kind: 'blocked', engineId: blocked.f, message: blocked.gate.message };
        const grants: Record<string, string> = { ...(body.grants ?? {}) };
        for (const f of from) {
          try {
            grants[f] = (await requestGrant(deps.transport, f, id)).grant;
          } catch (gErr) {
            const ge = gErr instanceof EngineApiError ? gErr : new EngineApiError(null, 'UNKNOWN', String(gErr));
            if (isTokenGone(ge)) return { kind: 'signInRequired', engineIds: [f] };
            if (ge.code === 'ENGINE_VERSION_MISMATCH') {
              const v = typeof ge.body.version === 'string' ? ge.body.version : 'unknown';
              noteEngineVersionMismatch(f, v);
              return { kind: 'blocked', engineId: f, message: olderEngineMessage(engineName(deps.engines, f), v) };
            }
            return { kind: 'error', code: ge.code, message: grantErrorText(ge, deps.engines, f), status: ge.status };
          }
        }
        body.grants = grants;
        granted = true;
        continue;
      }

      return { kind: 'error', code: e.code, message: commandErrorText(e, deps.engines, id), status: e.status };
    }
  }
  return { kind: 'error', code: 'UNKNOWN', message: 'The Engine kept asking for another step. Start again.', status: null };
}
