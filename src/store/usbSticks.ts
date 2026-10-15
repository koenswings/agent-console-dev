/**
 * Read-only USB sticks in the Console (idea#193 §5, §8.2a).
 *
 * A stick is published by its Engine in `Engine.usbSticks` and also stays in
 * `Engine.unformattedDisks` (same kernel device) so "Erase this disk…" keeps
 * working. The Console shows it as a light read-only row, links to the
 * channel builder on that Pi, and explains why nothing will be built.
 */
import type { Engine, Instance, Store, UnformattedDisk, UsbStickPublic } from '../types/store';
import { formatBytes } from './diskRoles';
import { buildAppUrl, type AppHostContext } from './appUrl';

/** x-app.name of the channel builder (idea#193 §8.2a: matched by name only). */
export const CHANNEL_BUILDER_APP_NAME = 'kolibri-channel-builder';

export const STICK_TEAMS_LINE = 'Visible in Nextcloud for teachers on this Pi';
export const STICK_FS_LINE = 'FAT32/exFAT stick, used read-only';
export const HINT_NO_BUILDER =
  'No channel builder on this Pi: dock the disk with the channel builder app to build automatically';
export const HINT_BUILDER_STOPPED =
  'Channel builder was stopped by an operator; start it to build from this stick';
export const BUILDER_LINK_TEXT = 'Open the channel builder';

const bareDevice = (d: string | null | undefined): string => String(d ?? '').replace(/^\/dev\//, '');

/** The stick's name without the 'USB: ' prefix (falls back to the label). */
export function stickName(s: UsbStickPublic): string {
  const n = String(s.displayName ?? '').replace(/^USB:\s*/, '').trim();
  return n || s.label || 'USB stick';
}

/** "USB stick: MARY-STICK (read-only, 3.2 GB)" (idea#193 §5). */
export function stickRowLabel(s: UsbStickPublic): string {
  return `USB stick: ${stickName(s)} (read-only, ${formatBytes(s.sizeBytes)})`;
}

/** The stick that is this unformatted candidate (same kernel device), if any. */
export function stickForCandidate(engine: Engine | undefined, u: UnformattedDisk | undefined): UsbStickPublic | undefined {
  if (!engine || !u) return undefined;
  const dev = bareDevice(u.device);
  if (!dev) return undefined;
  return (engine.usbSticks ?? []).find((s) => bareDevice(s.device) === dev);
}

/** The erase candidate for a stick (same kernel device), if the Engine listed one. */
export function candidateForStick(engine: Engine | undefined, s: UsbStickPublic): UnformattedDisk | undefined {
  const dev = bareDevice(s.device);
  return (engine?.unformattedDisks ?? []).find((u) => bareDevice(u.device) === dev);
}

/** Is this the channel builder app? Match by app name (x-app.name), or the id prefix when the app is not in appDB. */
function isBuilderInstance(store: Store, inst: Instance): boolean {
  const app = store.appDB?.[inst.instanceOf];
  if (app) return app.name === CHANNEL_BUILDER_APP_NAME;
  return String(inst.instanceOf).startsWith(`${CHANNEL_BUILDER_APP_NAME}-`);
}

/**
 * The channel builder instance docked on this Engine (idea#193 §8.2a): stored
 * on a disk docked to it; with several, the most recent `lastStarted`. Never
 * one from another Pi.
 */
export function channelBuilderOn(store: Store | null, engineId: string): Instance | undefined {
  if (!store) return undefined;
  const mine = Object.values(store.instanceDB ?? {}).filter((i) => {
    if (!i || !isBuilderInstance(store, i) || !i.storedOn) return false;
    return String(store.diskDB?.[i.storedOn]?.dockedTo ?? '') === engineId;
  });
  mine.sort((a, b) => (b.lastStarted ?? 0) - (a.lastStarted ?? 0));
  return mine[0];
}

export type StickBuilderState =
  | { kind: 'none' } // stick has no kolibri folder: nothing to say
  | { kind: 'no-builder'; hint: string }
  | { kind: 'stopped'; hint: string; instance: Instance }
  | { kind: 'running'; instance: Instance }
  | { kind: 'other'; instance: Instance }; // Docked/Starting/Error…: the Engine handles it

/** What the row says about the channel builder for this stick (idea#193 §5, §8.2a). */
export function stickBuilderState(store: Store | null, engineId: string, s: UsbStickPublic): StickBuilderState {
  const inst = channelBuilderOn(store, engineId);
  if (!s.hasKolibriFolder) return inst?.status === 'Running' ? { kind: 'running', instance: inst } : { kind: 'none' };
  if (!inst) return { kind: 'no-builder', hint: HINT_NO_BUILDER };
  if (inst.status === 'Stopped' || inst.status === 'Pauzed') return { kind: 'stopped', hint: HINT_BUILDER_STOPPED, instance: inst };
  if (inst.status === 'Running') return { kind: 'running', instance: inst };
  return { kind: 'other', instance: inst };
}

/** Link to the builder start page on this Pi (same host rules as App links, #139). */
export function builderUrl(engine: Engine, inst: Instance, ctx: AppHostContext): string {
  return buildAppUrl(engine, inst.port, ctx);
}
