import { createSignal, onMount, Show, type Component } from 'solid-js';
import { discoverAllEngines, type DiscoveryResult } from '../store/discovery';
import EnginePickerPanel from './EnginePickerPanel';
import {
  csGet,
  csSet,
  STORAGE_KEY_HOSTNAME,
  STORAGE_KEY_STORE_URL,
  STORAGE_KEY_DEMO,
} from '../store/storage';

// Re-export storage helpers for backward compatibility with App.tsx
export {
  readStoredHostname,
  readStoredDemoMode,
  saveHostnameAndStoreUrl,
  saveDemoMode,
} from '../store/storage';

/**
 * Normalise a hostname entered by the user:
 * - If it looks like an IP address (digits and dots only), return as-is
 * - Otherwise strip any trailing .local and re-append it
 * e.g. "appdocker01" -> "appdocker01.local"
 *      "appdocker01.local" -> "appdocker01.local"
 *      "100.115.60.6" -> "100.115.60.6"
 */
export function normaliseHostname(raw: string): string {
  const h = raw.trim();
  if (!h) return h;
  if (/^[\d.]+$/.test(h)) return h;
  return h.replace(/\.local$/i, '') + '.local';
}

// ---------------------------------------------------------------------------
// Onboarding / Settings component
// ---------------------------------------------------------------------------

interface OnboardingProps {
  onComplete: () => void;
  /**
   * Called when a live setting (e.g. demo toggle) should trigger a reconnect
   * without closing the Settings panel. Falls back to onComplete if not provided.
   */
  onReconnect?: () => void;
  /** True while App.tsx background discovery is running */
  discovering?: boolean;
  /** Passed from App.tsx when background discovery already ran */
  discoveryResults?: DiscoveryResult[];
  onDiscoverySelect?: (result: DiscoveryResult) => void;
}

const Onboarding: Component<OnboardingProps> = (props) => {
  const [hostname, setHostname] = createSignal('');
  const [storeUrl, setStoreUrl] = createSignal('');
  const [demoMode, setDemoMode] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const [scanning, setScanning] = createSignal(false);
  const [scanStatus, setScanStatus] = createSignal<string | null>(null);
  const [localResults, setLocalResults] = createSignal<DiscoveryResult[]>([]);
  const [showManual, setShowManual] = createSignal(false);

  // All discovery results: prefer prop (from App.tsx background scan), else local
  const allResults = () => props.discoveryResults ?? localResults();
  // Show picker when 2+ results and not explicitly showing manual form
  const showPicker = () => !showManual() && !demoMode() && allResults().length >= 2;

  // Pre-fill with whatever is already stored
  onMount(async () => {
    const r = await csGet([STORAGE_KEY_HOSTNAME, STORAGE_KEY_STORE_URL, STORAGE_KEY_DEMO]);
    setHostname(r[STORAGE_KEY_HOSTNAME] ?? '');
    setStoreUrl(r[STORAGE_KEY_STORE_URL] ?? '');

    if (STORAGE_KEY_DEMO in r) {
      setDemoMode(r[STORAGE_KEY_DEMO] === 'true');
    } else {
      setDemoMode(!(r[STORAGE_KEY_HOSTNAME] ?? ''));
    }
  });

  // Save demo mode immediately on change and trigger App reconnect so status bar updates
  const handleDemoChange = async (val: boolean) => {
    setDemoMode(val);
    await csSet({ [STORAGE_KEY_DEMO]: String(val) });
    if (props.onReconnect) props.onReconnect();
    else props.onComplete();
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    const isDemo = demoMode();
    const h = isDemo ? '' : normaliseHostname(hostname());
    if (!isDemo && !h) return;
    if (h) setHostname(h);

    setSaving(true);
    try {
      await csSet({
        ...(h ? { [STORAGE_KEY_HOSTNAME]: h } : {}),
        [STORAGE_KEY_DEMO]: String(isDemo),
        ...(storeUrl().trim() ? { [STORAGE_KEY_STORE_URL]: storeUrl().trim() } : {}),
      });
      if (!storeUrl().trim()) {
        localStorage.removeItem(STORAGE_KEY_STORE_URL);
      }
      props.onComplete();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="onboarding">
      <div class="onboarding__card">
        <h1 class="onboarding__title">IDEA Console</h1>
        <p class="onboarding__subtitle">
          Configure the Engine connection and display preferences.
        </p>

        {/* Background discovery indicator */}
        <Show when={props.discovering && !showPicker()}>
          <div class="onboarding__discovering">
            <span class="onboarding__discovering-dot" />
            <span>Scanning for engine on the network…</span>
          </div>
        </Show>

        {/* Engine picker — shown when 2+ engines found */}
        <Show when={showPicker()}>
          <EnginePickerPanel
            results={allResults()}
            onSelect={(result) => {
              if (props.onDiscoverySelect) props.onDiscoverySelect(result);
            }}
            onManual={() => setShowManual(true)}
          />
        </Show>

        {/* Form — shown when picker is not active */}
        <Show when={!showPicker()}>
          <form class="onboarding__form" onSubmit={handleSubmit}>

            {/* Demo mode */}
            <div class="form-field">
              <label class="toggle-row">
                <span class="toggle-row__label">Demo mode</span>
                <input
                  type="checkbox"
                  checked={demoMode()}
                  onChange={(e) => handleDemoChange(e.currentTarget.checked)}
                />
              </label>
              <span class="form-field__hint">
                Show mock data — use this to explore the UI without a running Engine.
              </span>
            </div>

            {/* Engine hostname — only when not in demo mode */}
            <Show when={!demoMode()}>
              <div class="onboarding__scan">
                <button
                  type="button"
                  class={`onboarding__scan-btn ${scanning() ? 'onboarding__scan-btn--active' : ''}`}
                  disabled={scanning()}
                  onClick={async () => {
                    setScanning(true);
                    setScanStatus(null);
                    setShowManual(false);
                    const results = await discoverAllEngines();
                    setLocalResults(results);
                    setScanning(false);
                    if (results.length === 1) {
                      setHostname(results[0].hostname);
                      setStoreUrl(results[0].storeUrl);
                      setScanStatus(`Found: ${results[0].hostname}`);
                    } else if (results.length === 0) {
                      setScanStatus('No engine found — enter hostname manually');
                    }
                  }}
                >
                  <Show when={scanning()}>
                    <span class="onboarding__scan-spinner" />
                  </Show>
                  {scanning() ? 'Scanning…' : 'Scan for engine'}
                </button>
                <Show when={scanStatus() && !scanning()}>
                  <span class="onboarding__scan-status">{scanStatus()}</span>
                </Show>
              </div>

              <div class="form-field">
                <label class="form-field__label" for="engine-hostname">
                  Engine hostname
                </label>
                <input
                  id="engine-hostname"
                  class="form-field__input"
                  type="text"
                  placeholder="appdocker01 or 192.168.1.10"
                  value={hostname()}
                  onInput={(e) => setHostname(e.currentTarget.value)}
                  required
                  autocomplete="off"
                  spellcheck={false}
                />
                <span class="form-field__hint">
                  e.g. appdocker01.local or the Tailscale IP of the Engine
                </span>
              </div>
            </Show>

            <button
              class="onboarding__submit"
              type="submit"
              disabled={(!demoMode() && !hostname().trim()) || saving()}
            >
              {saving() ? 'Saving…' : 'Save & Connect'}
            </button>

          </form>
        </Show>
      </div>
    </div>
  );
};

export default Onboarding;
