/**
 * Demo vs Engine connection resolution (idea#168 / duration --live).
 *
 * Production web (Engine :8080 Console) must NEVER use bootDemo / mock disks,
 * even if localStorage `demoMode` is stale `'true'`. Duration Intents use Kid
 * fixture IDs (duration-kolibri-grade5a-001) — remapping to DISK001 is forbidden.
 */

export interface ResolveDemoModeInput {
  /** Result of isProductionWebMode() — Engine-served Console. */
  productionWeb: boolean;
  /** localStorage / chrome.storage demoMode === 'true'. */
  storedDemo: boolean;
  /**
   * URL search string or URLSearchParams (`?demo=0` / `?demo=false` / `?demo=1`).
   * Ignored for enabling demo when productionWeb is true.
   */
  searchParams?: string | URLSearchParams;
}

export interface ResolveDemoModeResult {
  /** Whether to createMockConnection (true) or createEngineConnection (false). */
  isDemo: boolean;
  /** Persist demoMode=false (clear stale / honor ?demo=0). */
  persistFalse: boolean;
  /** Persist demoMode=true (honor ?demo=1 in non-production only). */
  persistTrue: boolean;
}

function parseSearch(search?: string | URLSearchParams): URLSearchParams {
  if (!search) return new URLSearchParams();
  if (typeof search !== 'string') return search;
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
}

/**
 * Decide demo mode for initConnection.
 * Production web → always false (and clear stored when it was true).
 * Else: ?demo=0|false clears; ?demo=1|true enables; else use stored.
 */
export function resolveDemoMode(input: ResolveDemoModeInput): ResolveDemoModeResult {
  const params = parseSearch(input.searchParams);
  const raw = (params.get('demo') ?? '').toLowerCase();

  if (input.productionWeb) {
    // Never allow ?demo=1 on Engine-hosted Console
    return {
      isDemo: false,
      persistFalse: input.storedDemo || raw === '1' || raw === 'true',
      persistTrue: false,
    };
  }

  if (raw === '0' || raw === 'false') {
    return { isDemo: false, persistFalse: true, persistTrue: false };
  }
  if (raw === '1' || raw === 'true') {
    return { isDemo: true, persistFalse: false, persistTrue: true };
  }

  return {
    isDemo: input.storedDemo,
    persistFalse: false,
    persistTrue: false,
  };
}
