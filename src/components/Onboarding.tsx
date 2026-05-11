import { createSignal, createEffect, onMount, Show, For, type Component } from 'solid-js';
import {
  discoverAllEngines,
  discoverEnginesByPrefix,
  extractHostnameBase,
  DISCOVERY_REFRESH_INTERVAL_MS,
  type DiscoveryResult,
} from '../store/discovery';

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
 */
export function normaliseHostname(raw: string): string {
  const h = raw.trim();
  if (!h) return h;
  if (/^[\d.]+$/.test(h)) return h;
  return h.replace(/\.local$/i, '') + '.local';
}

// ---------------------------------------------------------------------------
// OnboardingCard — unified discovery + connection panel
// ---------------------------------------------------------------------------

interface OnboardingProps {
  onComplete: () => void;
  onReconnect?: () => void;
  /** True while App.tsx background discovery is running */
  discovering?: boolean;
  /** Passed from App.tsx when background discovery already ran */
  discoveryResults?: DiscoveryResult[];
  onDiscoverySelect?: (result: DiscoveryResult) => void;
}

type ScanState = 'scanning' | 'done' | 'refreshing';

const Onboarding: Component<OnboardingProps> = (props) => {
  const [results, setResults] = createSignal<DiscoveryResult[]>([]);
  const [scanState, setScanState] = createSignal<ScanState>('scanning');
  const [showManual, setShowManual] = createSignal(false);
  const [manualInput, setManualInput] = createSignal('');
  const [manualConnecting, setManualConnecting] = createSignal(false);
  const [manualError, setManualError] = createSignal<string | null>(null);

  // Merge results: keep existing order, append new hostnames
  const mergeResults = (fresh: DiscoveryResult[]) => {
    setResults((prev) => {
      const known = new Set(prev.map((r) => r.hostname));
      const merged = [...prev];
      for (const r of fresh) {
        if (!known.has(r.hostname)) merged.push(r);
      }
      return merged;
    });
  };

  // Initial scan on mount
  const runScan = async () => {
    setScanState('scanning');
    setResults([]);
    const found = await discoverAllEngines();
    mergeResults(found);
    setScanState('done');
  };

  onMount(async () => {
    await runScan();
  });

  // Background refresh every 10s while the panel is shown
  createEffect(() => {
    const interval = setInterval(async () => {
      setScanState('refreshing');
      const fresh = await discoverAllEngines();
      mergeResults(fresh);
      setScanState('done');
    }, DISCOVERY_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  });

  // Sync with parent-provided discovery results (from App.tsx background scan)
  createEffect(() => {
    const parentResults = props.discoveryResults;
    if (parentResults && parentResults.length > 0) mergeResults(parentResults);
  });

  const handleConnect = (result: DiscoveryResult) => {
    if (props.onDiscoverySelect) {
      props.onDiscoverySelect(result);
    }
  };

  const handleManualConnect = async () => {
    const raw = manualInput().trim();
    if (!raw) return;
    setManualError(null);
    setManualConnecting(true);

    try {
      const base = extractHostnameBase(raw);

      if (base) {
        // Probe siblings using the extracted prefix
        const siblings = await discoverEnginesByPrefix(base.prefix, base.hasDotLocal);
        const normalised = normaliseHostname(raw);

        // Check if the entered host itself is in the results
        const enteredResult = siblings.find(
          (r) => r.hostname === normalised || r.hostname === raw.trim()
        );

        if (siblings.length === 0 || (siblings.length === 1 && enteredResult)) {
          // No siblings found (or only the host itself) — connect directly
          const directResult = enteredResult ?? siblings[0];
          if (directResult) {
            setShowManual(false);
            handleConnect(directResult);
          } else {
            // Probe the entered hostname directly as a last resort
            const res = await fetch(`http://${normalised}/api/store-url`, {
              signal: AbortSignal.timeout(5000),
            });
            if (res.ok) {
              const json = await res.json() as { url?: string };
              if (json.url) {
                setShowManual(false);
                handleConnect({ hostname: normalised, storeUrl: json.url });
              } else {
                setManualError('Engine found but no store URL returned.');
              }
            } else {
              setManualError('Could not reach engine. Check the hostname.');
            }
          }
        } else {
          // Multiple siblings found — merge into results and let user pick
          mergeResults(siblings);
          setShowManual(false);
        }
      } else {
        // IP address or no number — probe directly
        const normalised = normaliseHostname(raw);
        const res = await fetch(`http://${normalised}/api/store-url`, {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const json = await res.json() as { url?: string };
          if (json.url) {
            setShowManual(false);
            handleConnect({ hostname: normalised, storeUrl: json.url });
          } else {
            setManualError('Engine found but no store URL returned.');
          }
        } else {
          setManualError('Could not reach engine. Check the hostname.');
        }
      }
    } catch {
      setManualError('Could not reach engine. Check the hostname.');
    } finally {
      setManualConnecting(false);
    }
  };

  return (
    <div class="onboarding">
      <div class="onboarding__card">
        <div class="onboarding__title-row">
          <h1 class="onboarding__title">IDEA Console</h1>
          <Show when={scanState() === "scanning" || scanState() === "refreshing"}>
            <span class="onboarding__corner-spinner" />
          </Show>
        </div>

        {/* Status label */}
        <p class="onboarding__scan-label">
          <Show when={scanState() === "scanning"}>Scanning for engines…</Show>
          <Show when={scanState() !== "scanning" && results().length === 0}>No engine found</Show>
          <Show when={results().length > 0}>{results().length} engine{results().length > 1 ? "s" : ""} found</Show>
        </p>

        {/* Engine list */}
        <Show when={results().length > 0}>
          <ul class="engine-picker__list">
            <For each={results()}>
              {(result) => (
                <li class="engine-picker__item">
                  <span class="engine-picker__hostname">{result.hostname.replace(/\.local$/i, '')}</span>
                  <button class="engine-picker__connect-btn" onClick={() => handleConnect(result)}>
                    Connect
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>

        {/* Inline manual entry — replaces the link in place */}
        <Show
          when={showManual()}
          fallback={
            <button
              class="onboarding__manual-link"
              onClick={() => { setShowManual(true); setManualInput(''); setManualError(null); }}
            >
              Enter hostname manually ›
            </button>
          }
        >
          <div class="onboarding__manual-row">
            <input
              class="form-field__input"
              type="text"
              placeholder="idea01 or 192.168.1.10"
              value={manualInput()}
              onInput={(e) => setManualInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleManualConnect();
                if (e.key === 'Escape') { setShowManual(false); setManualError(null); }
              }}
              autocomplete="off"
              spellcheck={false}
              autofocus
            />
            <button
              class="engine-picker__connect-btn"
              disabled={manualConnecting() || !manualInput().trim()}
              onClick={handleManualConnect}
            >
              <Show when={manualConnecting()}>
                <span class="onboarding__scan-spinner" />
              </Show>
              {manualConnecting() ? 'Connecting…' : 'Connect'}
            </button>
            <button
              class="onboarding__manual-cancel"
              onClick={() => { setShowManual(false); setManualError(null); }}
            >
              Cancel
            </button>
          </div>
          <Show when={manualError()}>
            <p class="onboarding__manual-error">{manualError()}</p>
          </Show>
        </Show>

      </div>
    </div>
  );
};

export default Onboarding;
