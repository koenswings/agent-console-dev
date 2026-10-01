/**
 * idea#166 — Intent registry keys match Axle ACTIONS.md / school-day.yaml.
 * Engine-owned infra_* / enter_infra_fleet_walk must not appear here.
 * Phase 3–5 Intents bind to Kid stable fixture IDs (agent-app-dev#10).
 */
import { describe, it, expect } from 'vitest';
import {
  CONSOLE_INTENT_NAMES,
  intentRegistry,
  getIntent,
  DURATION_FIXTURES,
  uuidForms,
  sel,
} from '../e2e/intents';

const LOCKED = [
  'open_console_as_teacher',
  'open_console_as_learner',
  'open_console_as_operator',
  'return_to_start',
  'stay_on_teacher_overview',
  'stay_on_learner_overview',
  'stay_on_overview',
  'open_kolibri_as_teacher',
  'open_kolibri_as_learner',
  'open_nextcloud_as_teacher',
  'open_nextcloud_as_learner',
  'open_video',
  'open_exercise',
  'open_disk_inventory',
  'open_instance_controls',
  'eject_disk',
  'confirm_eject',
  'cancel_eject',
  'erase_disk',
  'confirm_erase',
  'cancel_erase',
  'start_instance',
  'stop_instance',
  'open_account',
  'close_account',
  'open_settings',
  'close_settings',
  'sign_in',
  'make_files_disk',
  'add_files',
] as const;

const ENGINE_OWNED = [
  'enter_infra_fleet_walk',
  'infra_undock_fixtures',
  'infra_dock_fixture',
  'infra_move_disk',
  'infra_reboot_engine',
] as const;

const DEFERRED = [
  'open_wikipedia_as_teacher',
  'open_wikipedia_as_learner',
  'keep_watching',
  'next_resource',
  'exit_lesson',
] as const;

describe('Intent registry (idea#166 Phase 5)', () => {
  it('registers Hub + dwell + Phase 3–5 Intents', () => {
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

  it('does not register deferred usage / Kiwix Intents', () => {
    for (const name of DEFERRED) {
      expect(getIntent(name)).toBeUndefined();
    }
  });

  it('Kid fixture IDs match CONTENT.seeded + CONTENT.live.json @2313112', () => {
    expect(DURATION_FIXTURES.kolibri.diskId).toBe('duration-kolibri-grade5a-001');
    expect(DURATION_FIXTURES.kolibri.instanceId).toBe('kolibri-grade5a-001');
    expect(DURATION_FIXTURES.kolibri.video.contentId).toBe('e60662de-b15c-52f9-b003-359f7d91f8fd');
    expect(DURATION_FIXTURES.kolibri.video.contentIdRaw).toBe('e60662deb15c52f9b003359f7d91f8fd');
    expect(DURATION_FIXTURES.kolibri.video.nodeId).toBe('4a1a1b92-3f6d-59eb-a94c-3f91f0011dd5');
    expect(DURATION_FIXTURES.kolibri.video.nodeIdRaw).toBe('4a1a1b923f6d59eba94c3f91f0011dd5');
    expect(DURATION_FIXTURES.kolibri.exercise.contentId).toBe('7eb9de46-96eb-53d0-bcc1-2fb270b96f03');
    expect(DURATION_FIXTURES.kolibri.exercise.contentIdRaw).toBe('7eb9de4696eb53d0bcc12fb270b96f03');
    expect(DURATION_FIXTURES.kolibri.live.facility.id).toBe('f0e1353e8c40d985faab5ead5c91d03f');
    expect(DURATION_FIXTURES.kolibri.live.class.id).toBe('a12df5408d20cbe5fd00c0cb036f48f6');
    expect(DURATION_FIXTURES.kolibri.live.lesson.id).toBe('2a955770551f7d583c31104f39653fdf');
    expect(DURATION_FIXTURES.kolibri.live.facility.idDashed).toBe('f0e1353e-8c40-d985-faab-5ead5c91d03f');
    expect(DURATION_FIXTURES.nextcloud).toEqual({
      diskId: 'duration-nextcloud-grade5a-001',
      instanceId: 'nextcloud-grade5a-001',
    });
  });

  it('uuidForms accepts dashed and undashed Morango IDs', () => {
    expect(uuidForms('e60662de-b15c-52f9-b003-359f7d91f8fd')).toEqual({
      dashed: 'e60662de-b15c-52f9-b003-359f7d91f8fd',
      raw: 'e60662deb15c52f9b003359f7d91f8fd',
    });
    expect(uuidForms('e60662deb15c52f9b003359f7d91f8fd').raw).toBe('e60662deb15c52f9b003359f7d91f8fd');
    expect(uuidForms(DURATION_FIXTURES.kolibri.live.lesson.id).dashed).toBe(
      DURATION_FIXTURES.kolibri.live.lesson.idDashed,
    );
  });

  it('selectors encode Kid instance and disk ids + Phase 4 controls', () => {
    expect(sel.instance('kolibri-grade5a-001')).toBe('[data-testid="instance-kolibri-grade5a-001"]');
    expect(sel.openInstance('nextcloud-grade5a-001')).toBe('[data-testid="open-instance-nextcloud-grade5a-001"]');
    expect(sel.disk('duration-kolibri-grade5a-001')).toBe('[data-testid="disk-duration-kolibri-grade5a-001"]');
    expect(sel.eject('duration-kolibri-grade5a-001')).toBe('[data-testid="eject-duration-kolibri-grade5a-001"]');
    expect(sel.startInstance('kolibri-grade5a-001')).toBe('[data-testid="start-instance-kolibri-grade5a-001"]');
    expect(sel.stopInstance('kolibri-grade5a-001')).toBe('[data-testid="stop-instance-kolibri-grade5a-001"]');
    expect(sel.settingsBtn).toBe('[data-testid="settings-btn"]');
    expect(sel.makeFilesDisk).toBe('[data-testid="make-files-disk"]');
    expect(sel.addFiles).toBe('[data-testid="add-files"]');
    expect(DURATION_FIXTURES.kolibri.video.contentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(DURATION_FIXTURES.kolibri.exercise.contentId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
