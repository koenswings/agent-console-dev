/**
 * Optional dashboard hide list (idea#212).
 *
 * An operator may place `hidden-instances.json` next to the Console build
 * (`dist/hidden-instances.json`), shaped `{ "hidden": ["<instanceId>", ...] }`.
 * The listed instances are left out of the Apps dashboard. Records stay in the
 * store and nothing is stopped; delete the file to show the cards again.
 * Without the file (or with an invalid one) nothing is hidden.
 */
export const HIDDEN_INSTANCES_PATH = '/hidden-instances.json';

/** Instance IDs from a parsed hide-list file; anything malformed yields []. */
export const parseHiddenInstances = (json: unknown): string[] => {
  const hidden = (json as { hidden?: unknown } | null)?.hidden;
  return Array.isArray(hidden) ? hidden.filter((id): id is string => typeof id === 'string') : [];
};

export type HiddenInstancesLoader = () => Promise<string[]>;

/** Fetches the hide list; a missing file, network error or bad JSON yields []. */
export const loadHiddenInstances = async (
  fetchFn: typeof fetch = fetch,
  path: string = HIDDEN_INSTANCES_PATH,
): Promise<string[]> => {
  try {
    const res = await fetchFn(path, { cache: 'no-store' });
    if (!res.ok) return [];
    return parseHiddenInstances(await res.json());
  } catch {
    return [];
  }
};

let shared: Promise<string[]> | null = null;

/**
 * The hide list, fetched once per page load and shared by every list that
 * filters on it (AppBrowser and MobileAppList).
 */
export const sharedHiddenInstances: HiddenInstancesLoader = () => {
  shared ??= loadHiddenInstances();
  return shared;
};

/** Test helper: forget the shared result so the next call fetches again. */
export const resetSharedHiddenInstances = (): void => {
  shared = null;
};
