import { createSignal, type Component } from 'solid-js';

const STORAGE_KEY_HOSTNAME = 'engineHostname';
const STORAGE_KEY_STORE_URL = 'storeUrl';

interface OnboardingProps {
  onComplete: () => void;
}

const Onboarding: Component<OnboardingProps> = (props) => {
  const [hostname, setHostname] = createSignal('');
  const [storeUrl, setStoreUrl] = createSignal('');
  const [saving, setSaving] = createSignal(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    const h = hostname().trim();
    if (!h) return;

    setSaving(true);
    try {
      // Persist to localStorage (web mode fallback)
      localStorage.setItem(STORAGE_KEY_HOSTNAME, h);
      if (storeUrl().trim()) {
        localStorage.setItem(STORAGE_KEY_STORE_URL, storeUrl().trim());
      }

      // Persist to chrome.storage.local (extension mode)
      try {
        await chrome.storage.local.set({ [STORAGE_KEY_HOSTNAME]: h });
        if (storeUrl().trim()) {
          await chrome.storage.local.set({ [STORAGE_KEY_STORE_URL]: storeUrl().trim() });
        }
      } catch {
        // Not in extension context — localStorage is already set above
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
              Store URL <span style="color: var(--colour-text-dim)">(optional)</span>
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

          <button
            class="onboarding__submit"
            type="submit"
            disabled={!hostname().trim() || saving()}
          >
            {saving() ? 'Connecting…' : 'Save & Connect'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Onboarding;
