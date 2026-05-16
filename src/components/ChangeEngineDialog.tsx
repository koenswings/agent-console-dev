/**
 * ChangeEngineDialog — modal for operators to change the connected engine.
 *
 * Features:
 * - Shows recently connected engines for one-click reconnect
 * - As-you-type probing: checks name.local + name01-09.local in parallel
 * - Manual scan via discoverAllEngines()
 * - Demo mode toggle (operator/developer option)
 */
import { createSignal, onMount, For, Show, type Component } from 'solid-js';
import { discoverAllEngines } from '../store/discovery';
import {
  readEngineHistory,
  addToEngineHistory,
} from '../store/storage';

interface ProbeResult {
  hostname: string;
  storeUrl: string;
}

async function probeHost(hostname: string, port = 80): Promise<ProbeResult | null> {
  try {
    const res = await fetch(`http://${hostname}:${port}/api/store-url`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const storeUrl = json?.url as string | undefined;
    if (!storeUrl || !storeUrl.startsWith('automerge:')) return null;
    return { hostname, storeUrl };
  } catch {
    return null;
  }
}

function parseHostPort(input: string): { host: string; port: number } {
  const m = input.match(/:([0-9]+)$/);
  const port = m ? parseInt(m[1], 10) : 80;
  const host = m ? input.slice(0, -m[0].length) : input;
  return { host, port };
}

/**
 * Build probe candidates for a bare name.
 * e.g. "appdocker" -> ["appdocker.local", "appdocker", "appdocker01.local", ...]
 * e.g. "appdocker03" -> ["appdocker03.local", "appdocker03", "appdocker01.local", ...]
 */
function buildProbeCandidates(bare: string): string[] {
  const base = bare.replace(/\d+$/, ''); // strip trailing digits
  const candidates: string[] = [`${bare}.local`, bare];
  for (let i = 1; i <= 9; i++) {
    const n = String(i).padStart(2, '0');
    const candidate = `${base}${n}.local`;
    if (candidate !== `${bare}.local`) candidates.push(candidate);
  }
  return [...new Set(candidates)];
}

function displayName(hostname: string): string {
  return hostname.replace(/\.local$/i, '');
}

export interface ChangeEngineDialogProps {
  currentHostname: string;
  demo: boolean;
  onConnect: (hostname: string, storeUrl: string) => void;
  onDemoMode: () => void;
  onCancel: () => void;
}

const ChangeEngineDialog: Component<ChangeEngineDialogProps> = (props) => {
  const [input, setInput] = createSignal('');
  const [suggestions, setSuggestions] = createSignal<ProbeResult[]>([]);
  const [history, setHistory] = createSignal<string[]>([]);
  const [scanning, setScanning] = createSignal(false);
  const [probing, setProbing] = createSignal(false);
  const [connecting, setConnecting] = createSignal(false);
  const [error, setError] = createSignal('');
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(async () => {
    setHistory(await readEngineHistory());
  });

  const runProbes = async (raw: string) => {
    if (!raw.trim()) { setSuggestions([]); return; }
    setProbing(true);
    const { host, port } = parseHostPort(raw.trim());
    const candidates = buildProbeCandidates(host);
    const results = await Promise.all(candidates.map((c) => probeHost(c, port)));
    setSuggestions(results.filter((r): r is ProbeResult => r !== null));
    setProbing(false);
  };

  const handleInput = (val: string) => {
    setInput(val);
    setSuggestions([]);
    setError('');
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runProbes(val), 300);
  };

  const handleScan = async () => {
    setScanning(true);
    setSuggestions([]);
    setError('');
    try {
      const results = await discoverAllEngines();
      setSuggestions(results);
      if (results.length === 0) setError('No engines found on the network.');
    } finally {
      setScanning(false);
    }
  };

  const connect = async (hostname: string, storeUrl: string) => {
    await addToEngineHistory(hostname);
    props.onConnect(hostname, storeUrl);
  };

  const handleConnectButton = async () => {
    const raw = input().trim();
    if (!raw) return;
    setConnecting(true);
    setError('');
    const { host, port } = parseHostPort(raw);
    let result: ProbeResult | null = null;
    try {
      result = await probeHost(`${host}.local`, port) ?? await probeHost(host, port);
    } finally {
      setConnecting(false);
    }
    if (!result) {
      setError(`Could not reach "${raw}". Check the name and try again.`);
      return;
    }
    await connect(result.hostname, result.storeUrl);
  };

  const handleHistoryClick = async (bare: string) => {
    setInput(bare);
    setSuggestions([]);
    setError('');
    const result = await probeHost(`${bare}.local`) ?? await probeHost(bare);
    if (result) {
      await connect(result.hostname, result.storeUrl);
    } else {
      setError(`Could not reach "${bare}". It may be offline.`);
    }
  };

  return (
    <div
      class="change-engine-dialog"
      onClick={(e) => { if (e.target === e.currentTarget) props.onCancel(); }}
    >
      <div class="change-engine-dialog__card">
        <h2 class="change-engine-dialog__title">Change Engine</h2>

        {/* Previously connected */}
        <Show when={history().length > 0 && !input()}>
          <div class="change-engine-dialog__history">
            <p class="change-engine-dialog__section-label">Previously connected</p>
            <For each={history()}>
              {(bare) => (
                <button
                  class="change-engine-dialog__history-item"
                  onClick={() => handleHistoryClick(bare)}
                >
                  {bare}
                </button>
              )}
            </For>
          </div>
        </Show>

        {/* Hostname input + connect button */}
        <div class="change-engine-dialog__input-row">
          <input
            class="change-engine-dialog__input"
            type="text"
            placeholder="Engine name or host:port, e.g. appdocker01 or 192.168.1.10:8080"
            value={input()}
            onInput={(e) => handleInput(e.currentTarget.value)}
            autocomplete="off"
            spellcheck={false}
          />
          <button
            class="btn btn--primary"
            onClick={handleConnectButton}
            disabled={!input().trim() || connecting()}
          >
            {connecting() ? 'Connecting…' : 'Connect'}
          </button>
        </div>

        {/* Live probe feedback */}
        <Show when={probing()}>
          <p class="change-engine-dialog__probing">Checking…</p>
        </Show>
        <Show when={suggestions().length > 0}>
          <div class="change-engine-dialog__suggestions">
            <For each={suggestions()}>
              {(s) => (
                <div class="change-engine-dialog__suggestion-item">
                  <span class="change-engine-dialog__suggestion-name">{displayName(s.hostname)}</span>
                  <button class="btn btn--small" onClick={() => connect(s.hostname, s.storeUrl)}>
                    Connect
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* Error */}
        <Show when={error()}>
          <p class="change-engine-dialog__error">{error()}</p>
        </Show>

        {/* Scan */}
        <button
          class="btn btn--secondary change-engine-dialog__scan-btn"
          onClick={handleScan}
          disabled={scanning()}
        >
          {scanning() ? 'Scanning…' : 'Scan network for engines'}
        </button>

        {/* Cancel */}
        <button class="change-engine-dialog__cancel" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
};

export default ChangeEngineDialog;
