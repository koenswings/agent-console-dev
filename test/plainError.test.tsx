/**
 * idea#76: teachers never see CLI wording or Engine codes. For every known
 * refusal code (updateApp, removeInstance, renameInstance, client cards), a
 * few unknown ones and Engine texts with `--allow-major`, the rendered alert
 * has no `--flag` and no CAPS_SNAKE code token.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import CommandFeedback from '../src/components/CommandFeedback';
import type { CommandResult, CommandResultState } from '../src/store/commandResult';
import { GENERIC_ERROR_TEXT, looksLikeCli, plainEngineText } from '../src/store/plainError';
import { REFUSAL_TEXT, friendlyUpdateError } from '../src/store/updateApp';
import { REMOVE_REFUSALS, friendlyRemoveError } from '../src/store/removeInstance';
import { RENAME_REFUSALS, friendlyRenameError } from '../src/store/renameInstance';
import { ERROR_TEXT, parseEngineError } from '../src/store/clientCards';

afterEach(cleanup);

const FLAG = /(^|\s)--[a-z]/i;
const CODE = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/;
const ctx = { app: 'Kolibri', fromVersion: '0.15.5', toVersion: '1.0', engine: 'library-pi', diskName: 'Apps disk' };

const UNKNOWN = [
  'MAJOR_NOT_ALLOWED: 0.15.5 -> 1.0 is a major update; pass --allow-major',
  'Usage: updateApp <instanceId|name> <newAppId> [--allow-major] [--source <diskId>]',
  'BRAND_NEW_CODE: something happened',
  'SOME_FUTURE_REFUSAL',
  'Error: Too many arguments',
  'updateApp failed: run with --force',
  'ENOENT: no such file or directory',
];

const engineTexts = (codes: string[]): string[] =>
  [...codes.flatMap((c) => [`${c}: detail --allow-major`, `${c}`, `Error: ${c}: x`]), ...UNKNOWN];

const leaks = (t: string): boolean => FLAG.test(t) || CODE.test(t);

const rendered = (message: string, formatError?: (m: string) => string): string => {
  const state = (): CommandResultState => ({ kind: 'error', message });
  const result: CommandResult = { state, command: () => 'updateApp', start: () => {}, reset: () => {} };
  const r = render(() => <CommandFeedback result={result} subject={() => 'Kolibri'} testId="t" formatError={formatError} />);
  const text = r.getByTestId('t-error').textContent ?? '';
  cleanup();
  return text;
};

describe('no CLI wording or codes reach teachers (idea#76)', () => {
  it('updateApp refusals', () => {
    for (const m of engineTexts(Object.keys(REFUSAL_TEXT))) {
      const t = rendered(m, (x) => friendlyUpdateError(x, ctx));
      expect(leaks(t), `${m} -> ${t}`).toBe(false);
    }
  });
  it('removeInstance refusals', () => {
    for (const m of engineTexts(Object.keys(REMOVE_REFUSALS))) {
      const t = rendered(m, friendlyRemoveError);
      expect(leaks(t), `${m} -> ${t}`).toBe(false);
    }
  });
  it('renameInstance refusals', () => {
    for (const m of engineTexts(Object.keys(RENAME_REFUSALS))) {
      const t = rendered(m, friendlyRenameError);
      expect(leaks(t), `${m} -> ${t}`).toBe(false);
    }
  });
  it('generic CommandFeedback (move, copy, restore, backup, erase, disk roles…)', () => {
    for (const m of engineTexts(['NOT_FOUND', 'BUSY', 'NO_SPACE', 'TARGET_UNREACHABLE'])) {
      const t = rendered(m);
      expect(leaks(t), `${m} -> ${t}`).toBe(false);
    }
  });
  it('client cards (flash/erase) codes', () => {
    for (const m of engineTexts(Object.keys(ERROR_TEXT))) {
      const t = parseEngineError(m).text;
      expect(leaks(t), `${m} -> ${t}`).toBe(false);
    }
  });
  it('MAJOR_NOT_ALLOWED is generic, even with --allow-major in the Engine text', () => {
    expect(rendered('MAJOR_NOT_ALLOWED: 1.0 -> 2.0 is a major update; pass --allow-major', (x) => friendlyUpdateError(x, ctx)))
      .toBe("Couldn't update Kolibri: This version of Kolibri can't be installed over the one you have. Nothing changed.");
  });
  it('keeps plain Engine sentences and quoted ids, drops a leading code', () => {
    expect(plainEngineText('rsync: connection refused')).toBe('rsync: connection refused');
    expect(plainEngineText("Disk 'DISK_LIVE_BOOT' not found.")).toBe("Disk 'DISK_LIVE_BOOT' not found.");
    expect(plainEngineText('NEW_CODE: the disk was removed')).toBe('the disk was removed');
    expect(plainEngineText('')).toBe(GENERIC_ERROR_TEXT);
    expect(plainEngineText(null)).toBe(GENERIC_ERROR_TEXT);
    expect(looksLikeCli('pass --allow-major')).toBe(true);
    expect(looksLikeCli('Usage: x <id>')).toBe(true);
  });
});
