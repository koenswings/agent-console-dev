/**
 * Production web must ignore stored previewMode (Steve live duration / bootPreview bug).
 */
import { describe, it, expect } from 'vitest';
import { resolvePreviewMode } from '../src/store/previewMode';

describe('resolvePreviewMode (idea#168 live duration)', () => {
  it('production web ignores stored previewMode=true → Engine connection', () => {
    const r = resolvePreviewMode({
      productionWeb: true,
      storedPreview: true,
    });
    expect(r.isPreview).toBe(false);
    expect(r.persistFalse).toBe(true);
    expect(r.persistTrue).toBe(false);
  });

  it('production web ignores ?preview=1 and legacy ?demo=1 (never allow preview override)', () => {
    for (const q of ['?preview=1', '?demo=1']) {
      const r = resolvePreviewMode({
        productionWeb: true,
        storedPreview: false,
        searchParams: q,
      });
      expect(r.isPreview).toBe(false);
      expect(r.persistFalse).toBe(true);
    }
  });

  it('production web with stored false stays false without extra persist', () => {
    const r = resolvePreviewMode({
      productionWeb: true,
      storedPreview: false,
      searchParams: '',
    });
    expect(r.isPreview).toBe(false);
    expect(r.persistFalse).toBe(false);
  });

  it('non-production uses stored previewMode', () => {
    expect(
      resolvePreviewMode({ productionWeb: false, storedPreview: true }).isPreview,
    ).toBe(true);
    expect(
      resolvePreviewMode({ productionWeb: false, storedPreview: false }).isPreview,
    ).toBe(false);
  });

  it('?preview=0 / ?preview=false clears preview in extension/dev', () => {
    for (const q of ['?preview=0', '?preview=false', 'preview=0']) {
      const r = resolvePreviewMode({
        productionWeb: false,
        storedPreview: true,
        searchParams: q,
      });
      expect(r.isPreview).toBe(false);
      expect(r.persistFalse).toBe(true);
    }
  });

  it('legacy ?demo=0 / ?demo=false still clears preview when ?preview is absent', () => {
    for (const q of ['?demo=0', '?demo=false', 'demo=0']) {
      const r = resolvePreviewMode({
        productionWeb: false,
        storedPreview: true,
        searchParams: q,
      });
      expect(r.isPreview).toBe(false);
      expect(r.persistFalse).toBe(true);
    }
  });

  it('?preview=1 / ?preview=true enables preview only when not production web', () => {
    for (const q of ['?preview=1', '?preview=true']) {
      const r = resolvePreviewMode({
        productionWeb: false,
        storedPreview: false,
        searchParams: q,
      });
      expect(r.isPreview).toBe(true);
      expect(r.persistTrue).toBe(true);
    }
  });

  it('legacy ?demo=1 / ?demo=true still enables preview when ?preview is absent', () => {
    for (const q of ['?demo=1', '?demo=true']) {
      const r = resolvePreviewMode({
        productionWeb: false,
        storedPreview: false,
        searchParams: q,
      });
      expect(r.isPreview).toBe(true);
      expect(r.persistTrue).toBe(true);
    }
  });

  it('?preview= takes precedence over a conflicting legacy ?demo=', () => {
    const r = resolvePreviewMode({
      productionWeb: false,
      storedPreview: false,
      searchParams: '?preview=1&demo=0',
    });
    expect(r.isPreview).toBe(true);
    expect(r.persistTrue).toBe(true);
  });
});
