/**
 * Preview mode: an in-page stand-in for the Engine sign-in and command API
 * (agent-engine-dev#582 §5), so the demo runs the same code path as a real
 * Engine. No network. The demo operator is admin / admin911! (as before).
 *
 * The page's Engine is ENGINE_1; other Engines answer through the "relay".
 * An Engine without signedCommands1 in the store answers as an older Engine
 * (ENGINE_VERSION_MISMATCH), like the real relay.
 */
import type { Store } from '../types/store';
import type { EngineApiTransport, FetchFn } from '../store/engineApi';
import { engineHasCapability } from '../store/commands';
import { loginProofFromHash } from '../store/loginProof';

interface MockOperator { id: string; username: string; passwordHash: string; created: number }

interface MockEngineApiDeps {
  selfEngineId: string;
  store: () => Store | null;
  send: (engineId: string, command: string) => void;
  /** Operators every Engine starts with. */
  operators: readonly MockOperator[];
}

/** Fixed salt for unknown usernames (same format and cost as real ones). */
const FAKE_SALT = '$2b$10$abcdefghijklmnopqrstuu';
/** Setup code in preview, when an Engine has no operator. */
export const MOCK_SETUP_CODE = 'DEMO-2026';

const json = (status: number, body?: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const err = (status: number, error: string, message: string, extra: Record<string, unknown> = {}): Response =>
  json(status, { error, message, ...extra });

let counter = 0;
const rid = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(++counter).toString(36)}`;

export function createMockEngineFetch(deps: MockEngineApiDeps): FetchFn {
  const operators = new Map<string, MockOperator[]>();
  const sessions = new Map<string, { engineId: string; operator: MockOperator }>();
  const challenges = new Map<string, { engineId: string; nonce: string; username: string }>();
  const confirms = new Map<string, { engineId: string; command: string; text: string }>();
  const seqs = new Map<string, number>();

  const opsOf = (engineId: string): MockOperator[] => {
    let list = operators.get(engineId);
    if (!list) {
      list = deps.operators.map((o) => ({ ...o }));
      operators.set(engineId, list);
    }
    return list;
  };

  const sessionFrom = (engineId: string, headers: Record<string, string>): MockOperator | null => {
    const auth = headers.Authorization ?? headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const s = sessions.get(token);
    return s && s.engineId === engineId ? s.operator : null;
  };

  const newSession = (engineId: string, op: MockOperator): Response => {
    const token = rid('tok');
    sessions.set(token, { engineId, operator: op });
    return json(200, { token, expiresInMs: 15 * 60_000, operator: { id: op.id, username: op.username } });
  };

  /** The Engine's own summary for the commands that need a second confirmation. */
  const confirmFor = (engineId: string, command: string): { summary: Record<string, unknown>; field: string; text: string } | null => {
    const [name, ...args] = command.split(' ');
    const store = deps.store();
    if (name === 'eraseDisk') {
      const disk = store?.diskDB?.[args[0]];
      if (!disk) return null;
      const apps = Object.values(store?.instanceDB ?? {}).filter((i) => String(i.storedOn) === String(disk.id)).map((i) => String(i.name));
      return {
        summary: { command: name, targetId: String(disk.id), label: String(disk.name), sizeBytes: disk.sizeBytes ?? 0, device: disk.device ?? null, apps },
        field: 'label',
        text: String(disk.name),
      };
    }
    if (name === 'flashCard') {
      return {
        summary: { command: name, candidateId: args[0], sizeBytes: Number(args[2]), model: null, version: args[1] },
        field: 'sizeBytes',
        text: String(Number(args[2])),
      };
    }
    return null;
  };

  const handle = (engineId: string, path: string, method: string, headers: Record<string, string>, body: Record<string, unknown>): Response => {
    const store = deps.store();
    const engine = store?.engineDB?.[engineId];
    if (!engine) return err(404, 'ENGINE_UNKNOWN', 'This Engine is not in the store.');
    if (engineId !== deps.selfEngineId && !engineHasCapability(engine, 'signedCommands1')) {
      return err(409, 'ENGINE_VERSION_MISMATCH', 'Older Engine', { version: String(engine.version) });
    }
    const ops = opsOf(engineId);

    if (path === '/auth/info') {
      return json(200, {
        engineId, engineName: String(engine.hostname), version: String(engine.version), authVersion: 1,
        setupRequired: ops.length === 0, capabilities: engine.capabilities ?? [],
      });
    }
    if (path === '/auth/setup') {
      if (ops.length > 0) return err(409, 'SETUP_DONE', 'Setup is done.');
      if (String(body.setupCode) !== MOCK_SETUP_CODE) return err(403, 'SETUP_CODE_INVALID', 'Wrong code.');
      const op = { id: rid('op'), username: String(body.username), passwordHash: String(body.passwordHash), created: Date.now() };
      ops.push(op);
      const r = newSession(engineId, op);
      return new Response(r.body, { status: 201, headers: r.headers });
    }
    if (path === '/auth/challenge') {
      if (ops.length === 0) return err(403, 'SETUP_REQUIRED', 'Setup required.');
      const op = ops.find((o) => o.username === String(body.username));
      const challengeId = rid('ch');
      const nonce = rid('n');
      challenges.set(challengeId, { engineId, nonce, username: String(body.username) });
      return json(200, { challengeId, salt: op ? op.passwordHash.slice(0, 29) : FAKE_SALT, nonce, expiresInMs: 60_000 });
    }
    if (path === '/auth/login') {
      const ch = challenges.get(String(body.challengeId));
      challenges.delete(String(body.challengeId));
      const op = ops.find((o) => o.username === String(body.username));
      if (!ch || ch.engineId !== engineId || !op || loginProofFromHash(op.passwordHash, engineId, String(body.challengeId), ch.nonce) !== body.proof) {
        return err(401, 'LOGIN_FAILED', 'Wrong username or password.');
      }
      return newSession(engineId, op);
    }

    const me = sessionFrom(engineId, headers);
    if (!me) return err(401, 'TOKEN_INVALID', 'Sign in again.');

    if (path === '/auth/renew') return json(200, { expiresInMs: 15 * 60_000 });
    if (path === '/auth/logout') {
      for (const [k, s] of sessions) if (s.engineId === engineId && s.operator.id === me.id) sessions.delete(k);
      return json(204);
    }
    if (path === '/auth/operators' && method === 'GET') {
      return json(200, { operators: ops.map(({ id, username, created }) => ({ id, username, created })) });
    }
    if (path === '/auth/operators' && method === 'POST') {
      if (ops.some((o) => o.username === String(body.username))) return err(409, 'OPERATOR_EXISTS', 'That username is already taken.');
      const op = { id: rid('op'), username: String(body.username), passwordHash: String(body.passwordHash), created: Date.now() };
      ops.push(op);
      return json(201, { operator: { id: op.id, username: op.username, created: op.created } });
    }
    if (path.startsWith('/auth/operators/') && method === 'DELETE') {
      const id = decodeURIComponent(path.slice('/auth/operators/'.length));
      const i = ops.findIndex((o) => o.id === id);
      if (i < 0) return err(404, 'OPERATOR_UNKNOWN', 'No such operator.');
      if (ops.length <= 1) return err(409, 'LAST_OPERATOR', 'The last operator cannot be removed.');
      ops.splice(i, 1);
      return json(204);
    }
    if (path === '/auth/password') {
      const ch = challenges.get(String(body.challengeId));
      challenges.delete(String(body.challengeId));
      if (!ch || loginProofFromHash(me.passwordHash, engineId, String(body.challengeId), ch.nonce) !== body.proof) {
        return err(401, 'LOGIN_FAILED', 'Wrong password.');
      }
      me.passwordHash = String(body.newPasswordHash);
      return json(204);
    }
    if (path === '/auth/grant') return json(200, { grant: `v1.${engineId}.${String(body.toEngineId)}.${rid('g')}.mock`, expiresInMs: 6 * 3_600_000 });
    if (path === '/command') {
      const command = String(body.command ?? '');
      const need = confirmFor(engineId, command);
      if (need) {
        const id = body.confirmId ? String(body.confirmId) : '';
        const c = id ? confirms.get(id) : undefined;
        if (!c) {
          const confirmId = rid('cf');
          confirms.set(confirmId, { engineId, command, text: need.text });
          return err(428, 'CONFIRM_REQUIRED', 'Confirm on the Engine.', { confirmId, summary: need.summary, expiresInMs: 60_000, confirmField: need.field });
        }
        confirms.delete(id);
        if (c.command !== command || c.engineId !== engineId || String(body.confirmText ?? '') !== c.text) {
          return err(409, 'CONFIRM_INVALID', 'The confirmation did not match.');
        }
      }
      const seq = (seqs.get(engineId) ?? 0) + 1;
      seqs.set(engineId, seq);
      deps.send(engineId, command);
      return json(202, { engineId, seq });
    }
    return err(404, 'BAD_REQUEST', `No such call: ${method} ${path}`);
  };

  return async (input, init) => {
    const m = String(input).replace(/^https?:\/\/[^/]+/, '').match(/^\/api(?:\/engines\/([^/]+))?(\/.*)$/);
    if (!m) return err(404, 'BAD_REQUEST', 'Not an API path');
    const engineId = m[1] ? decodeURIComponent(m[1]) : deps.selfEngineId;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    let body: Record<string, unknown> = {};
    try { body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}; } catch { body = {}; }
    return handle(engineId, m[2], init?.method ?? 'GET', headers, body);
  };
}

/** The preview connection's API transport. */
export const createMockApiTransport = (deps: MockEngineApiDeps): EngineApiTransport => ({
  origin: '',
  selfEngineId: null,
  fetch: createMockEngineFetch(deps),
});
