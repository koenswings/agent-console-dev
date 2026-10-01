/**
 * Production web must ignore stored demoMode (Steve live duration / bootDemo bug).
 */
import { describe, it, expect } from 'vitest';
import { resolveDemoMode } from '../src/store/demoMode';

describe('resolveDemoMode (idea#168 live duration)', () => {
  it('production web ignores stored demoMode=true → Engine connection', () => {
    const r = resolveDemoMode({
      productionWeb: true,
      storedDemo: true,
    });
    expect(r.isDemo).toBe(false);
    expect(r.persistFalse).toBe(true);
    expect(r.persistTrue).toBe(false);
  });

  it('production web ignores ?demo=1 (never allow demo override)', () => {
    const r = resolveDemoMode({
      productionWeb: true,
      storedDemo: false,
      searchParams: '?demo=1',
    });
    expect(r.isDemo).toBe(false);
    expect(r.persistFalse).toBe(true);
  });

  it('production web with stored false stays false without extra persist', () => {
    const r = resolveDemoMode({
      productionWeb: true,
      storedDemo: false,
      searchParams: '',
    });
    expect(r.isDemo).toBe(false);
    expect(r.persistFalse).toBe(false);
  });

  it('non-production uses stored demoMode', () => {
    expect(
      resolveDemoMode({ productionWeb: false, storedDemo: true }).isDemo,
    ).toBe(true);
    expect(
      resolveDemoMode({ productionWeb: false, storedDemo: false }).isDemo,
    ).toBe(false);
  });

  it('?demo=0 / ?demo=false clears demo in extension/dev', () => {
    for (const q of ['?demo=0', '?demo=false', 'demo=0']) {
      const r = resolveDemoMode({
        productionWeb: false,
        storedDemo: true,
        searchParams: q,
      });
      expect(r.isDemo).toBe(false);
      expect(r.persistFalse).toBe(true);
    }
  });

  it('?demo=1 / ?demo=true enables demo only when not production web', () => {
    for (const q of ['?demo=1', '?demo=true']) {
      const r = resolveDemoMode({
        productionWeb: false,
        storedDemo: false,
        searchParams: q,
      });
      expect(r.isDemo).toBe(true);
      expect(r.persistTrue).toBe(true);
    }
  });
});
