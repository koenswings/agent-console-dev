/**
 * idea#166 — Intent registry keys match Axle's locked YAML action names.
 * Engine-owned infra_* / enter_infra_fleet_walk must not appear here.
 */
import { describe, it, expect } from 'vitest';
import {
  CONSOLE_INTENT_NAMES,
  intentRegistry,
  getIntent,
} from '../e2e/intents';

const LOCKED_HUB = [
  'open_console_as_teacher',
  'open_console_as_learner',
  'open_console_as_operator',
  'return_to_start',
] as const;

const LOCKED_USAGE_MINIMAL = [
  'stay_on_teacher_overview',
  'stay_on_learner_overview',
] as const;

const ENGINE_OWNED = [
  'enter_infra_fleet_walk',
  'infra_undock_fixtures',
  'infra_dock_fixture',
  'infra_move_disk',
  'infra_reboot_engine',
] as const;

describe('Intent registry (idea#166)', () => {
  it('registers exactly the Console Hub + minimal usage Intents', () => {
    expect([...CONSOLE_INTENT_NAMES].sort()).toEqual(
      [...LOCKED_HUB, ...LOCKED_USAGE_MINIMAL].sort(),
    );
    expect(Object.keys(intentRegistry).sort()).toEqual([...CONSOLE_INTENT_NAMES].sort());
  });

  it('each registered Intent is a function', () => {
    for (const name of CONSOLE_INTENT_NAMES) {
      expect(typeof intentRegistry[name]).toBe('function');
      expect(getIntent(name)).toBe(intentRegistry[name]);
    }
  });

  it('does not register Engine-owned infra Intents', () => {
    for (const name of ENGINE_OWNED) {
      expect(getIntent(name)).toBeUndefined();
      expect(CONSOLE_INTENT_NAMES).not.toContain(name);
    }
  });
});
