import { describe, it, expect } from 'vitest';
import { rebootRowMatchesEngineHint } from '../e2e/intents/operatorDeepActions';

describe('rebootRowMatchesEngineHint (Prefer A r47)', () => {
  it('matches hostname idea01 against row label, not only ENGINE_ testid', () => {
    expect(
      rebootRowMatchesEngineHint('idea01', 'idea01', 'Reboot engine idea01', 'Reboot idea01'),
    ).toBe(true);
    expect(rebootRowMatchesEngineHint('idea01.local', 'idea01', '', '')).toBe(true);
  });

  it('does not match a different hostname or idea011', () => {
    expect(rebootRowMatchesEngineHint('idea01', 'idea03', 'Reboot engine idea03', '')).toBe(false);
    expect(rebootRowMatchesEngineHint('idea01', 'idea011', '', '')).toBe(false);
  });

  it('matches aria when label is the hostname', () => {
    expect(rebootRowMatchesEngineHint('idea01', '', 'Reboot engine idea01', '')).toBe(true);
  });
});
