/**
 * LoginDebug — step-by-step login debugger.
 * TEMPORARY — remove before shipping.
 */
import { createSignal, For, type Component } from 'solid-js';
import bcrypt from 'bcryptjs';
import { bcryptCompare } from '../store/bcryptCompare';
import type { Store } from '../types/store';

interface Props {
  store: Store | null;
  onClose: () => void;
}

interface Step {
  label: string;
  status: 'pending' | 'running' | 'ok' | 'error';
  detail: string;
}

const LoginDebug: Component<Props> = (props) => {
  const [username, setUsername] = createSignal('admin');
  const [password, setPassword] = createSignal('admin911!');
  const [steps, setSteps] = createSignal<Step[]>([]);
  const [stepIndex, setStepIndex] = createSignal(-1);
  const [done, setDone] = createSignal(false);
  const [log, setLog] = createSignal<string[]>([]);

  const addLog = (msg: string) => {
    console.log('[LoginDebug]', msg);
    setLog((prev) => [...prev, `${new Date().toISOString().slice(11, 23)} ${msg}`]);
  };

  const pushStep = (s: Step) => setSteps((prev) => [...prev, s]);
  const updateLast = (patch: Partial<Step>) =>
    setSteps((prev) => prev.map((s, i) => (i === prev.length - 1 ? { ...s, ...patch } : s)));

  const STEP_FNS: Array<() => Promise<boolean>> = [
    // 0 — check store
    async () => {
      pushStep({ label: '1. Store available?', status: 'running', detail: '...' });
      await tick();
      const s = props.store;
      if (!s) {
        updateLast({ status: 'error', detail: 'props.store is NULL — store not synced yet' });
        return false;
      }
      const keys = Object.keys(s);
      updateLast({ status: 'ok', detail: `Store keys: [${keys.join(', ')}]` });
      return true;
    },

    // 1 — check userDB
    async () => {
      pushStep({ label: '2. userDB contents?', status: 'running', detail: '...' });
      await tick();
      const db = props.store?.userDB ?? {};
      const users = Object.values(db);
      if (users.length === 0) {
        updateLast({ status: 'error', detail: 'userDB is empty — no users exist' });
        return false;
      }
      const summary = users.map((u) => {
        const uname = String(u.username);
        const hash = String(u.passwordHash);
        return `${uname} | hash=${hash.substring(0, 15)}… | len=${hash.length} | typeof=${typeof u.passwordHash} | ctor=${(u.passwordHash as any)?.constructor?.name}`;
      }).join('\n');
      updateLast({ status: 'ok', detail: summary });
      return true;
    },

    // 2 — find user
    async () => {
      pushStep({ label: '3. Find user by username?', status: 'running', detail: '...' });
      await tick();
      const db = props.store?.userDB ?? {};
      const users = Object.values(db);
      addLog(`Looking for username="${username()}" among [${users.map(u => String(u.username)).join(', ')}]`);
      const user = users.find((u) => String(u.username) === username());
      if (!user) {
        updateLast({ status: 'error', detail: `No user with username="${username()}" found` });
        return false;
      }
      const hash = String(user.passwordHash);
      updateLast({
        status: 'ok',
        detail: `Found: id=${user.id}\nhash="${hash}"\nhash.length=${hash.length}`,
      });
      return true;
    },

    // 3 — validate hash format
    async () => {
      pushStep({ label: '4. Hash format valid?', status: 'running', detail: '...' });
      await tick();
      const db = props.store?.userDB ?? {};
      const user = Object.values(db).find((u) => String(u.username) === username());
      const hash = String(user!.passwordHash);
      const valid = hash.length === 60 && hash.startsWith('$2');
      const cost = hash.startsWith('$2') ? parseInt(hash.split('$')[2]) : null;
      if (!valid) {
        updateLast({ status: 'error', detail: `BAD HASH: length=${hash.length}, starts="${hash.substring(0,4)}"` });
        return false;
      }
      updateLast({ status: 'ok', detail: `length=60 ✓  starts with $2 ✓  cost=${cost}` });
      return true;
    },

    // 4 — bcrypt.compareSync (main thread)
    async () => {
      const pwd = password();
      const db = props.store?.userDB ?? {};
      const user = Object.values(db).find((u) => String(u.username) === username());
      const hash = String(user!.passwordHash);
      pushStep({ label: '5. bcrypt.compareSync (main thread)…', status: 'running', detail: 'running — UI may freeze briefly' });
      await tick();
      addLog(`Starting compareSync password="${pwd}" hash="${hash.substring(0,20)}…"`);
      const t0 = Date.now();
      let result: boolean;
      let errorMsg = '';
      try {
        result = bcrypt.compareSync(pwd, hash);
      } catch (e) {
        errorMsg = String(e);
        result = false;
      }
      const elapsed = Date.now() - t0;
      addLog(`compareSync done: result=${result} elapsed=${elapsed}ms error=${errorMsg}`);
      if (errorMsg) {
        updateLast({ status: 'error', detail: `THREW: ${errorMsg}\nelapsed: ${elapsed}ms` });
        return false;
      }
      updateLast({
        status: result ? 'ok' : 'error',
        detail: `result=${result}  elapsed=${elapsed}ms`,
      });
      return result;
    },

    // 5 — bcrypt.compare (async/Promise)
    async () => {
      const pwd = password();
      const db = props.store?.userDB ?? {};
      const user = Object.values(db).find((u) => String(u.username) === username());
      const hash = String(user!.passwordHash);
      pushStep({ label: '6. bcrypt.compare async (Promise)…', status: 'running', detail: 'running async…' });
      await tick();
      addLog(`Starting async compare…`);
      const t0 = Date.now();
      let result: boolean;
      let errorMsg = '';
      try {
        result = await Promise.race([
          bcrypt.compare(pwd, hash),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('TIMEOUT 10s')), 10_000)),
        ]);
      } catch (e) {
        errorMsg = String(e);
        result = false;
      }
      const elapsed = Date.now() - t0;
      addLog(`async compare done: result=${result} elapsed=${elapsed}ms error=${errorMsg}`);
      if (errorMsg) {
        updateLast({ status: 'error', detail: `THREW/TIMEOUT: ${errorMsg}\nelapsed: ${elapsed}ms` });
        return false;
      }
      updateLast({
        status: result ? 'ok' : 'error',
        detail: `result=${result}  elapsed=${elapsed}ms`,
      });
      return result;
    },

    // 6 — bcryptCompare (the exact function LoginForm uses)
    async () => {
      const pwd = password();
      const db = props.store?.userDB ?? {};
      const user = Object.values(db).find((u) => String(u.username) === username());
      const hash = String(user!.passwordHash);
      pushStep({ label: '7. bcryptCompare() — exact LoginForm path…', status: 'running', detail: 'running…' });
      await tick();
      addLog('Calling bcryptCompare (same as LoginForm)…');
      const t0 = Date.now();
      let result: boolean;
      let errorMsg = '';
      try {
        result = await Promise.race([
          bcryptCompare(pwd, hash),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('TIMEOUT 15s')), 15_000)),
        ]);
      } catch (e) {
        errorMsg = String(e);
        result = false;
      }
      const elapsed = Date.now() - t0;
      addLog(`bcryptCompare done: result=${result} elapsed=${elapsed}ms error=${errorMsg}`);
      if (errorMsg) {
        updateLast({ status: 'error', detail: `FAILED/TIMEOUT: ${errorMsg}\nelapsed: ${elapsed}ms` });
        return false;
      }
      updateLast({
        status: result ? 'ok' : 'error',
        detail: `result=${result}  elapsed=${elapsed}ms`,
      });
      return result;
    },
  ];

  const tick = () => new Promise<void>((r) => setTimeout(r, 50));

  const runNext = async () => {
    const idx = stepIndex() + 1;
    if (idx >= STEP_FNS.length) { setDone(true); return; }
    setStepIndex(idx);
    addLog(`--- STEP ${idx + 1} ---`);
    const ok = await STEP_FNS[idx]();
    if (!ok && idx < 4) {
      addLog(`Step ${idx + 1} FAILED — subsequent steps may not run correctly`);
    }
    if (idx === STEP_FNS.length - 1) setDone(true);
  };

  const statusColor = (s: Step['status']) => ({
    pending: '#888',
    running: '#f90',
    ok: '#0c0',
    error: '#f33',
  }[s]);

  const box: any = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    zIndex: 9999, padding: '20px', overflowY: 'scroll', '-webkit-overflow-scrolling': 'touch',
  };
  const card: any = {
    background: '#111', color: '#eee', fontFamily: 'monospace', fontSize: '13px',
    borderRadius: '8px', padding: '20px', width: '100%', maxWidth: '700px',
    border: '2px solid #f90',
  };

  return (
    <div style={box}>
      <div style={card}>
        <h2 style={{ color: '#f90', marginTop: 0 }}>🔍 LOGIN DEBUGGER</h2>

        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '4px' }}>Username</label>
          <input value={username()} onInput={e => setUsername(e.currentTarget.value)}
            style={{ width: '100%', padding: '6px', background: '#222', color: '#eee', border: '1px solid #555', borderRadius: '4px', fontFamily: 'monospace' }} />
        </div>
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '4px' }}>Password</label>
          <input type="text" value={password()} onInput={e => setPassword(e.currentTarget.value)}
            style={{ width: '100%', padding: '6px', background: '#222', color: '#eee', border: '1px solid #555', borderRadius: '4px', fontFamily: 'monospace' }} />
        </div>

        <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
          <button onClick={runNext} disabled={done()}
            style={{ padding: '8px 20px', background: done() ? '#333' : '#f90', color: '#000', border: 'none', borderRadius: '4px', cursor: done() ? 'default' : 'pointer', fontWeight: 'bold', fontSize: '14px' }}>
            {done() ? '✓ Done' : stepIndex() === -1 ? '▶ Start' : `▶ Step ${stepIndex() + 2}`}
          </button>
          <button onClick={() => { setSteps([]); setStepIndex(-1); setDone(false); setLog([]); }}
            style={{ padding: '8px 16px', background: '#333', color: '#eee', border: '1px solid #555', borderRadius: '4px', cursor: 'pointer' }}>
            Reset
          </button>
          <button onClick={props.onClose}
            style={{ padding: '8px 16px', background: '#333', color: '#eee', border: '1px solid #555', borderRadius: '4px', cursor: 'pointer', marginLeft: 'auto' }}>
            Close
          </button>
        </div>

        {/* Steps */}
        <For each={steps()}>
          {(step) => (
            <div style={{ marginBottom: '10px', padding: '10px', background: '#1a1a1a', borderRadius: '4px', borderLeft: `4px solid ${statusColor(step.status)}` }}>
              <div style={{ fontWeight: 'bold', color: statusColor(step.status) }}>
                {step.status === 'running' ? '⏳ ' : step.status === 'ok' ? '✅ ' : step.status === 'error' ? '❌ ' : ''}{step.label}
              </div>
              <pre style={{ margin: '6px 0 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#ccc', fontSize: '12px' }}>{step.detail}</pre>
            </div>
          )}
        </For>

        {/* Raw log */}
        {log().length > 0 && (
          <div style={{ marginTop: '16px' }}>
            <div style={{ color: '#888', marginBottom: '4px' }}>Console log:</div>
            <pre style={{ background: '#0a0a0a', padding: '10px', borderRadius: '4px', maxHeight: '200px', overflowY: 'auto', fontSize: '11px', color: '#aaa', margin: 0 }}>
              {log().join('\n')}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};

export default LoginDebug;
