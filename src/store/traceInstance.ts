/**
 * engine#399 / agent-engine-dev#403: which trace arg identifies an instance command.
 *
 * An Engine with `traceInstanceId` writes the resolved instance id under
 * `instanceId` and the display name (or null) under `instanceName`. An older
 * Engine writes the value the Console sent under `instanceName` (an id for
 * backupApp / restoreApp, a name for copyApp / moveApp / start / stop).
 * Always ask the Engine the command goes to (the trace producer).
 */
import { engineHasCapability, type EngineCapability } from './commands';
import type { TraceAltMatch, TraceArgKey } from './commandResult';
import type { Store } from '../types/store';

export const TRACE_INSTANCE_ID_CAPABILITY: EngineCapability = 'traceInstanceId';

export interface TraceInstanceMatch {
  argKey: TraceArgKey;
  argValue: string;
  /** Set when the instance was sent by name (engine#399 follow-up): the sent name also matches. */
  altMatch?: TraceAltMatch;
}

/**
 * The trace arg to match for an instance command sent to `engineId`:
 * `instanceId` + the id on an Engine with `traceInstanceId`, else
 * `instanceName` + the value sent (as before).
 *
 * When the instance is sent by NAME (`sentValue` is not the id), the sent name is a
 * second match value, guarded by `disk` (the instance's disk sent: diskId, or the copy/move source),
 * which must follow the name in the trace args:
 * - new Engine: `args.instanceId` = the name and `args.instanceName` null (the
 *   name did not resolve), or the name's tokens in a refusal before execution;
 * - older Engine: the name's tokens in a refusal before execution (a multi-word
 *   name arrives split on spaces), besides the usual `args.instanceName` = name.
 */
export const traceInstanceMatch = (
  store: Store | null | undefined,
  engineId: string | null | undefined,
  instanceId: string,
  sentValue: string,
  disk?: string | null,
): TraceInstanceMatch => {
  const fresh = engineHasCapability(engineId ? store?.engineDB?.[engineId] : null, TRACE_INSTANCE_ID_CAPABILITY);
  const base: TraceInstanceMatch = fresh
    ? { argKey: 'instanceId', argValue: String(instanceId) }
    : { argKey: 'instanceName', argValue: sentValue };
  if (sentValue === String(instanceId) || sentValue.trim() === '') return base;
  const followedBy = disk ? { followedBy: String(disk) } : {};
  return {
    ...base,
    altMatch: fresh
      ? { value: sentValue, argKey: 'instanceId', nullKey: 'instanceName', ...followedBy }
      : { value: sentValue, argKey: 'instanceName', ...followedBy },
  };
};
