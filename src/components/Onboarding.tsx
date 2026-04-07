import { createSignal, onMount, Show, type Component } from 'solid-js';
import { discoverAllEngines, type DiscoveryResult } from '../store/discovery';
import EnginePickerPanel from './EnginePickerPanel';

export const STORAGE_KEY_HOSTNAME = 'engineHostname';
export const STORAGE_KEY_STORE_URL = 'storeUrl';
export const STORAGE_KEY_MODE = 'displayMode';
export const STORAGE_KEY_DEMO = 'demoMode';

export type DisplayMode = 'sidePanel' | 'popup' | 'window';

// ---------------------------------------------------------------------------
// Storage helpers — chrome.storage.local preferred; localStorage fallback
// ---------------------------------------------------------------------------

async function csGet(keys: string[]): Promise<Record<string, string>> {
  try {
    const r = await chrome.storage.local.get(keys);
    return r as Record<string, string>;
  } catch {
    const out: Record<string, string> = {};
    for (const k of keys) {
      const v = localStorage.getItem(k);
      if (v !== null) out[k] = v;
    }
    return out;
  }
}

async function csSet(data: Record<string, string | boolean>): Promise<void> {
  try {
    await chrome.storage.local.set(data);
  } catch {
    for (const [k, v] of Object.entries(data)) {
      localStorage.setItem(k, String(v));
    }
  }
}

export async function readStoredHostname(): Promise<string> {
  const r = await csGet([STORAGE_KEY_HOSTNAME]);
  return r[STORAGE_KEY_HOSTNAME] ?? '';
}

/** Save hostname and store URL to storage (used by auto-discovery in App.tsx). */
export async function saveHostnameAndStoreUrl(hostname: string, storeUrl: string): Promise<void> {
  await csSet({ [STORAGE_KEY_HOSTNAME]: hostname, [STORAGE_KEY_STORE_URL]: storeUrl });
}

export async function readStoredDemoMode(): Promise<boolean> {
  const r = await csGet([STORAGE_KEY_DEMO]);
  // Default: demo mode ON when no hostname configured yet
  if (STORAGE_KEY_DEMO in r) return r[STORAGE_KEY_DEMO] === 'true';
  const hostname = await readStoredHostname();
  return !hostname; // demo on by default until an engine is configured
}

// ---------------------------------------------------------------------------
// Onboarding / Settings component
// ---------------------------------------------------------------------------

interface OnboardingProps {
  onComplete: () => void;
  /** True while App.tsx background discovery is running */
  discovering?: boolean;
  /** Passed from App.tsx when background discovery already ran */
  discoveryResults?: DiscoveryResult[];
  onDiscoverySelect?: (result: DiscoveryResult) => void;
}

const Onboarding: Component<OnboardingProps> = (props) => {
  const [hostname, setHostname] = createSignal('');
  const [storeUrl, setStoreUrl] = createSignal('');
  const [displayMode, setDisplayMode] = createSignal<DisplayMode>('sidePanel');
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
    const r = await csGet([
      STORAGE_KEY_HOSTNAME,
      STORAGE_KEY_STORE_URL,
      STORAGE_KEY_MODE,
      STORAGE_KEY_DEMO,
    ]);
    setHostname(r[STORAGE_KEY_HOSTNAME] ?? '');
    setStoreUrl(r[STORAGE_KEY_STORE_URL] ?? '');
    setDisplayMode((r[STORAGE_KEY_MODE] as DisplayMode) ?? 'sidePanel');

    // Demo mode default: on if no hostname, off if hostname is set
    if (STORAGE_KEY_DEMO in r) {
      setDemoMode(r[STORAGE_KEY_DEMO] === 'true');
    } else {
      setDemoMode(!(r[STORAGE_KEY_HOSTNAME] ?? ''));
    }
  });

  // Save display mode immediately on change — no need to wait for form submit
  const handleModeChange = async (mode: DisplayMode) => {
    setDisplayMode(mode);
    await csSet({ [STORAGE_KEY_MODE]: mode });
  };

  // Save demo mode immediately on change
  const handleDemoChange = async (val: boolean) => {
    setDemoMode(val);
    await csSet({ [STORAGE_KEY_DEMO]: String(val) });
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    const h = hostname().trim();
    if (!h) return;

    setSaving(true);
    try {
      await csSet({
        [STORAGE_KEY_HOSTNAME]: h,
        [STORAGE_KEY_DEMO]: String(demoMode()),
        ...(storeUrl().trim() ? { [STORAGE_KEY_STORE_URL]: storeUrl().trim() } : {}),
      });
      // Remove store URL if cleared
      if (!storeUrl().trim()) {
        try { await chrome.storage.local.remove(STORAGE_KEY_STORE_URL); } catch {}
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
              if (props.onDiscoverySelect) {
                props.onDiscoverySelect(result);
              }
            }}
            onManual={() => setShowManual(true)}
          />
        </Show>

        {/* Form — shown when picker is not active */}
        <Show when={!showPicker()}>
        <form class="onboarding__form" onSubmit={handleSubmit}>

          {/* Demo mode — top of form, prominent */}
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

          {/* Engine hostname — shown but not required in demo mode */}
          <Show when={!demoMode()}>
            {/* Scan button */}
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
                  // 2+ results: picker takes over, no status text needed
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
                placeholder="appdocker01.local"
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
            {/* Store URL removed — fetched automatically from /api/store-url */}
          </Show>

          {/* Display mode — extension only, saved immediately */}
          <div class="form-field">
            <span class="form-field__label">Display mode</span>
            <span class="form-field__hint" style="margin-bottom: 8px">
              Saved immediately. Takes effect on next toolbar icon click.
            </span>
            <div class="mode-options">
              <label class="mode-option">
                <input
                  type="radio"
                  name="displayMode"
                  value="sidePanel"
                  checked={displayMode() === 'sidePanel'}
                  onChange={() => handleModeChange('sidePanel')}
                />
                <span class="mode-option__label">Side panel</span>
                <span class="mode-option__desc">
                  Docked to the right of the browser. Stays open across tabs.
                </span>
              </label>
              <label class="mode-option">
                <input
                  type="radio"
                  name="displayMode"
                  value="popup"
                  checked={displayMode() === 'popup'}
                  onChange={() => handleModeChange('popup')}
                />
                <span class="mode-option__label">Popup</span>
                <span class="mode-option__desc">
                  Opens on icon click, closes when you click away.
                </span>
              </label>
              <label class="mode-option">
                <input
                  type="radio"
                  name="displayMode"
                  value="window"
                  checked={displayMode() === 'window'}
                  onChange={() => handleModeChange('window')}
                />
                <span class="mode-option__label">Standalone window</span>
                <span class="mode-option__desc">
                  Opens as a separate Chrome window.
                </span>
              </label>
            </div>
          </div>

          <button
            class="onboarding__submit"
            type="submit"
            disabled={(!demoMode() && !hostname().trim()) || saving()}
          >
            {saving() ? 'Saving…' : 'Save & Connect'}
          </button>

        </form>
        </Show>{/* end !showPicker */}
      </div>
    </div>
  );
};

export default Onboarding;
