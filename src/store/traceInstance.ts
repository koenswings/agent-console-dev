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
import type { TraceArgKey } from './commandResult';
import type { Store } from '../types/store';

export const TRACE_INSTANCE_ID_CAPABILITY: EngineCapability = 'traceInstanceId';

export interface TraceInstanceMatch {
  argKey: TraceArgKey;
  argValue: string;
}

/**
 * The trace arg to match for an instance command sent to `engineId`:
 * `instanceId` + the id on an Engine with `traceInstanceId`, else
 * `instanceName` + the value sent (as before).
 */
export const traceInstanceMatch = (
  store: Store | null | undefined,
  engineId: string | null | undefined,
  instanceId: string,
  sentValue: string,
): TraceInstanceMatch =>
  engineHasCapability(engineId ? store?.engineDB?.[engineId] : null, TRACE_INSTANCE_ID_CAPABILITY)
    ? { argKey: 'instanceId', argValue: String(instanceId) }
    : { argKey: 'instanceName', argValue: sentValue };
