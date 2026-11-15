/**
 * Preview vs Engine connection resolution (idea#168 / duration --live).
 *
 * Production web (Engine :8080 Console) must NEVER use bootPreview / mock disks,
 * even if localStorage `previewMode` (or a leftover `demoMode`) is stale `'true'`.
 * Duration Intents use Kid fixture IDs (duration-kolibri-grade5a-001) — remapping
 * to DISK001 is forbidden.
 */

export interface ResolvePreviewModeInput {
  /** Result of isProductionWebMode() — Engine-served Console. */
  productionWeb: boolean;
  /** localStorage / chrome.storage previewMode (or migrated demoMode) === 'true'. */
  storedPreview: boolean;
  /**
   * URL search string or URLSearchParams (`?preview=0` / `?preview=false` / `?preview=1`).
   * The legacy `?demo=` param is still honoured as a fallback when `preview` is absent.
   * Ignored for enabling preview when productionWeb is true.
   */
  searchParams?: string | URLSearchParams;
}

export interface ResolvePreviewModeResult {
  /** Whether to createMockConnection (true) or createEngineConnection (false). */
  isPreview: boolean;
  /** Persist previewMode=false (clear stale / honor ?preview=0). */
  persistFalse: boolean;
  /** Persist previewMode=true (honor ?preview=1 in non-production only). */
  persistTrue: boolean;
}

function parseSearch(search?: string | URLSearchParams): URLSearchParams {
  if (!search) return new URLSearchParams();
  if (typeof search !== 'string') return search;
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
}

function paramFlag(params: URLSearchParams, name: string): string {
  return (params.get(name) ?? '').toLowerCase();
}

/**
 * Decide preview mode for initConnection.
 * Production web → always false (and clear stored when it was true).
 * Else: ?preview=0|false (or legacy ?demo=0|false) clears;
 * ?preview=1|true (or legacy ?demo=1|true) enables; else use stored.
 * `preview` wins when both params are present.
 */
export function resolvePreviewMode(input: ResolvePreviewModeInput): ResolvePreviewModeResult {
  const params = parseSearch(input.searchParams);
  const raw = paramFlag(params, 'preview') || paramFlag(params, 'demo');

  if (input.productionWeb) {
    // Never allow ?preview=1 / ?demo=1 on Engine-hosted Console
    return {
      isPreview: false,
      persistFalse: input.storedPreview || raw === '1' || raw === 'true',
      persistTrue: false,
    };
  }

  if (raw === '0' || raw === 'false') {
    return { isPreview: false, persistFalse: true, persistTrue: false };
  }
  if (raw === '1' || raw === 'true') {
    return { isPreview: true, persistFalse: false, persistTrue: true };
  }

  return {
    isPreview: input.storedPreview,
    persistFalse: false,
    persistTrue: false,
  };
}
