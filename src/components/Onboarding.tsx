import { createSignal, onMount, Show, type Component } from 'solid-js';

export const STORAGE_KEY_HOSTNAME = 'engineHostname';
export const STORAGE_KEY_STORE_URL = 'storeUrl';
export const STORAGE_KEY_MODE = 'displayMode';

export type DisplayMode = 'sidePanel' | 'popup' | 'window';

export const readStoredHostname = (): string =>
  localStorage.getItem(STORAGE_KEY_HOSTNAME) ?? '';

export const readStoredStoreUrl = (): string =>
  localStorage.getItem(STORAGE_KEY_STORE_URL) ?? '';

export const clearStoredSettings = (): void => {
  localStorage.removeItem(STORAGE_KEY_HOSTNAME);
  localStorage.removeItem(STORAGE_KEY_STORE_URL);
  try {
    chrome.storage.local.remove([STORAGE_KEY_HOSTNAME, STORAGE_KEY_STORE_URL]);
  } catch {
    // not in extension context
  }
};

const isExtension = (): boolean => {
  try {
    return typeof chrome !== 'undefined' && !!chrome.storage?.local;
  } catch {
    return false;
  }
};

interface OnboardingProps {
  onComplete: () => void;
}

const Onboarding: Component<OnboardingProps> = (props) => {
  const [hostname, setHostname] = createSignal('');
  const [storeUrl, setStoreUrl] = createSignal('');
  const [displayMode, setDisplayMode] = createSignal<DisplayMode>('sidePanel');
  const [saving, setSaving] = createSignal(false);
  const [inExtension, setInExtension] = createSignal(false);

  // Pre-fill with whatever is already stored
  onMount(async () => {
    let h = readStoredHostname();
    let u = readStoredStoreUrl();

    if (isExtension()) {
      setInExtension(true);
      try {
        const result = await chrome.storage.local.get([
          STORAGE_KEY_HOSTNAME,
          STORAGE_KEY_STORE_URL,
          STORAGE_KEY_MODE,
        ]);
        if (!h) h = (result[STORAGE_KEY_HOSTNAME] as string) ?? '';
        if (!u) u = (result[STORAGE_KEY_STORE_URL] as string) ?? '';
        const mode = (result[STORAGE_KEY_MODE] as DisplayMode) ?? 'sidePanel';
        setDisplayMode(mode);
      } catch {
        // not in extension context
      }
    }

    setHostname(h);
    setStoreUrl(u);
  });

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    const h = hostname().trim();
    if (!h) return;

    setSaving(true);
    try {
      // Persist hostname + store URL to localStorage (web mode)
      localStorage.setItem(STORAGE_KEY_HOSTNAME, h);
      if (storeUrl().trim()) {
        localStorage.setItem(STORAGE_KEY_STORE_URL, storeUrl().trim());
      } else {
        localStorage.removeItem(STORAGE_KEY_STORE_URL);
      }

      // Persist all settings to chrome.storage.local (extension mode)
      if (isExtension()) {
        try {
          const toStore: Record<string, string> = {
            [STORAGE_KEY_HOSTNAME]: h,
            [STORAGE_KEY_MODE]: displayMode(),
          };
          if (storeUrl().trim()) {
            toStore[STORAGE_KEY_STORE_URL] = storeUrl().trim();
          }
          await chrome.storage.local.set(toStore);
          if (!storeUrl().trim()) {
            await chrome.storage.local.remove(STORAGE_KEY_STORE_URL);
          }
        } catch {
          // not in extension context
        }
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
          Enter the hostname of the Engine you want to connect to.
          <br />
          The Console will connect via WebSocket on port 4321.
        </p>
        <form class="onboarding__form" onSubmit={handleSubmit}>
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
              e.g. appdocker01.local or the IP address of the Engine
            </span>
          </div>

          <div class="form-field">
            <label class="form-field__label" for="store-url">
              Store URL{' '}
              <span style="color: var(--colour-text-dim)">(optional)</span>
            </label>
            <input
              id="store-url"
              class="form-field__input"
              type="text"
              placeholder="automerge:xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              value={storeUrl()}
              onInput={(e) => setStoreUrl(e.currentTarget.value)}
              autocomplete="off"
              spellcheck={false}
            />
            <span class="form-field__hint">
              Paste the Automerge document URL from the Engine
            </span>
          </div>

          {/* Display mode — extension only */}
          <Show when={inExtension()}>
            <div class="form-field">
              <span class="form-field__label">Display mode</span>
              <span class="form-field__hint" style="margin-bottom: 8px">
                Takes effect next time you click the toolbar icon.
              </span>
              <div class="mode-options">
                <label class="mode-option">
                  <input
                    type="radio"
                    name="displayMode"
                    value="sidePanel"
                    checked={displayMode() === 'sidePanel'}
                    onChange={() => setDisplayMode('sidePanel')}
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
                    onChange={() => setDisplayMode('popup')}
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
                    onChange={() => setDisplayMode('window')}
                  />
                  <span class="mode-option__label">Standalone window</span>
                  <span class="mode-option__desc">
                    Opens as a separate Chrome window. App-style.
                  </span>
                </label>
              </div>
            </div>
          </Show>

          <button
            class="onboarding__submit"
            type="submit"
            disabled={!hostname().trim() || saving()}
          >
            {saving() ? 'Saving…' : 'Save & Connect'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Onboarding;
