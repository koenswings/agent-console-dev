/**
 * Which Engine is the Console connected to? (cross-engine feedback, r30)
 *
 * The Console only reads the command log of the Engine it is connected to.
 * A command for another Engine (idea03/idea04 with static peers) never leaves
 * a trace there, so waiting for one would report a false "No response".
 *
 * The connected Engine is known when:
 *   1. a command we sent to Engine X left a trace in our own command log
 *      (learned — the strongest signal), or
 *   2. exactly one Engine in the store has the hostname the Console was
 *      opened on (e.g. http://idea01:8080 → engine hostname "idea01").
 * When neither applies (e.g. opened by IP) the target counts as remote: the
 * panel shows the neutral "Sent to …" state and still follows our own log,
 * so a local error trace turns red as before.
 */
import { createSignal } from 'solid-js';
import type { Store } from '../types/store';

/** Lower-case, no port, no trailing ".local" / dot. */
export const normHost = (h: string): string =>
  String(h).trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '').replace(/\.local$/, '');

const [connectedHost, setConnectedHostSignal] = createSignal<string | null>(null);
const [learnedEngineId, setLearnedEngineId] = createSignal<string | null>(null);

/** Set by App from the connection (the hostname the Console talks to). */
export const setConnectedEngineHost = (host: string | null | undefined): void => {
  setConnectedHostSignal(host ? normHost(host) : null);
  setLearnedEngineId(null);
};

/** Called when a command sent to `engineId` left a trace in our own command log. */
export const noteConnectedEngine = (engineId: string): void => {
  if (learnedEngineId() !== engineId) setLearnedEngineId(engineId);
};

/** For tests. */
export const resetConnectedEngine = (): void => {
  setConnectedHostSignal(null);
  setLearnedEngineId(null);
};

/** The connected Engine's ID, or null when unknown. */
export const connectedEngineId = (store: Store | null | undefined): string | null => {
  const learned = learnedEngineId();
  if (learned) return learned;
  const host = connectedHost();
  if (!host || !store) return null;
  const matches = Object.values(store.engineDB ?? {}).filter((e) => normHost(String(e.hostname)) === host);
  return matches.length === 1 ? String(matches[0].id) : null;
};

/** True unless `engineId` is known to be the connected Engine (unknown → remote). */
export const isRemoteEngine = (store: Store | null | undefined, engineId: string): boolean =>
  connectedEngineId(store) !== String(engineId);
