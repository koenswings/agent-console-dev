import { describe, it, expect } from 'vitest';
import { sel } from '../e2e/intents/selectors';
import { DURATION_FIXTURES } from '../e2e/intents/fixtures';
import {
  DEFAULT_RENAME_TEMP_NAME,
  RENAME_INSTANCE_ENV,
  RENAME_TEMP_NAME_ENV,
  missingRenameCapabilityMessage,
  resolveRenameInstanceId,
  resolveRenameTempName,
} from '../e2e/intents/renameInstance';

describe('rename_instance (console#171)', () => {
  it('selectors target the inline rename controls once', () => {
    expect(sel.renameInstanceBtn('kolibri-grade5a-001')).toBe(
      '[data-testid="rename-instance-btn-kolibri-grade5a-001"]',
    );
    expect(sel.renameInstanceInput('i1')).toBe('[data-testid="rename-instance-input-i1"]');
    expect(sel.renameInstanceSave('i1')).toBe('[data-testid="rename-instance-save-i1"]');
    expect(sel.renameInstanceCancel('i1')).toBe('[data-testid="rename-instance-cancel-i1"]');
    expect(sel.renameInstanceProblem('i1')).toBe('[data-testid="rename-instance-problem-i1"]');
    const keys = Object.keys(sel);
    expect(keys.filter((k) => k === 'renameInstanceBtn')).toHaveLength(1);
    expect(keys.filter((k) => k === 'renameInstanceSave')).toHaveLength(1);
  });

  it('resolves the instance id from env, ctx, or the Kolibri fixture', () => {
    expect(resolveRenameInstanceId(undefined, {})).toBe(DURATION_FIXTURES.kolibri.instanceId);
    expect(resolveRenameInstanceId('ctx-id', {})).toBe('ctx-id');
    expect(resolveRenameInstanceId('ctx-id', { [RENAME_INSTANCE_ENV]: 'env-id' })).toBe('env-id');
  });

  it('picks a temp name different from the original so the fixture can be renamed back', () => {
    expect(resolveRenameTempName('Kolibri', {})).toBe(DEFAULT_RENAME_TEMP_NAME);
    expect(resolveRenameTempName(DEFAULT_RENAME_TEMP_NAME, {})).toBe(`${DEFAULT_RENAME_TEMP_NAME} 2`);
    expect(resolveRenameTempName('Kolibri', { [RENAME_TEMP_NAME_ENV]: 'Walk check' })).toBe('Walk check');
    expect(resolveRenameTempName('Walk check', { [RENAME_TEMP_NAME_ENV]: 'Walk check' })).toBe(
      DEFAULT_RENAME_TEMP_NAME,
    );
  });

  it('fails clearly when the rename control is missing', () => {
    const msg = missingRenameCapabilityMessage('kolibri-grade5a-001');
    expect(msg).toContain('rename-instance-btn-kolibri-grade5a-001');
    expect(msg).toContain('renameInstance');
    expect(msg).toContain('No soft-pass');
  });
});
