/**
 * idea#166 — Intent registry keys match Axle ACTIONS.md / school-day.yaml.
 * Engine-owned infra_* / enter_infra_fleet_walk must not appear here.
 * Phase 3 open_* Intents bind to Kid stable fixture IDs (agent-app-dev#10).
 */
import { describe, it, expect } from 'vitest';
import {
  CONSOLE_INTENT_NAMES,
  intentRegistry,
  getIntent,
  DURATION_FIXTURES,
  sel,
} from '../e2e/intents';

const LOCKED = [
  'open_console_as_teacher',
  'open_console_as_learner',
  'open_console_as_operator',
  'return_to_start',
  'stay_on_teacher_overview',
  'stay_on_learner_overview',
  'open_kolibri_as_teacher',
  'open_kolibri_as_learner',
  'open_nextcloud_as_teacher',
  'open_nextcloud_as_learner',
  'open_disk_inventory',
  'open_instance_controls',
] as const;

const ENGINE_OWNED = [
  'enter_infra_fleet_walk',
  'infra_undock_fixtures',
  'infra_dock_fixture',
  'infra_move_disk',
  'infra_reboot_engine',
] as const;

describe('Intent registry (idea#166 Phase 3)', () => {
  it('registers Hub + dwell + Phase 3 open/operator Intents', () => {
    expect([...CONSOLE_INTENT_NAMES].sort()).toEqual([...LOCKED].sort());
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
    }
  });

  it('Kid fixture IDs match agent-app-dev#10 / walker-ref.yaml', () => {
    expect(DURATION_FIXTURES.kolibri).toEqual({
      diskId: 'duration-kolibri-grade5a-001',
      instanceId: 'kolibri-grade5a-001',
    });
    expect(DURATION_FIXTURES.nextcloud).toEqual({
      diskId: 'duration-nextcloud-grade5a-001',
      instanceId: 'nextcloud-grade5a-001',
    });
  });

  it('selectors encode Kid instance and disk ids', () => {
    expect(sel.instance('kolibri-grade5a-001')).toBe('[data-testid="instance-kolibri-grade5a-001"]');
    expect(sel.openInstance('nextcloud-grade5a-001')).toBe('[data-testid="open-instance-nextcloud-grade5a-001"]');
    expect(sel.disk('duration-kolibri-grade5a-001')).toBe('[data-testid="disk-duration-kolibri-grade5a-001"]');
  });
});
