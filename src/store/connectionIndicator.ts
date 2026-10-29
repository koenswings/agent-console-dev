/**
 * connectionIndicator.ts: what the status-bar dot and label show
 * (agent-engine-dev#168). A connection whose socket was lost keeps its last
 * store, so `connected` stays true; socketState says the socket is being
 * redialled and the status bar shows that instead of the Engine name.
 */
import type { SocketState } from './socketLiveness';

export const RECONNECTING_LABEL = 'Connection lost, reconnecting…';

export interface IndicatorInput {
  connected: boolean;
  socketState: SocketState;
  demo: boolean;
  discovering: boolean;
  hostname: string | null;
  engineName: () => string;
}

export interface Indicator { dotClass: string; label: string }

export const connectionIndicator = (i: IndicatorInput): Indicator => {
  if (i.connected && i.socketState === 'reconnecting') {
    return { dotClass: 'status-bar__dot--reconnecting', label: RECONNECTING_LABEL };
  }
  if (i.connected) return { dotClass: 'status-bar__dot--connected', label: i.engineName() };
  const searching = i.discovering || (!!i.hostname && !i.demo);
  const dotClass = searching ? 'status-bar__dot--searching' : 'status-bar__dot--disconnected';
  if (i.demo) return { dotClass, label: '' };
  if (i.discovering) return { dotClass, label: 'Scanning for engines...' };
  if (i.hostname) return { dotClass, label: 'Connecting…' };
  return { dotClass, label: 'No engine found' };
};
