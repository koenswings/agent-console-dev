/**
 * previewMode storage key + one-time migration from the legacy demoMode key (idea#235).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  STORAGE_KEY_DEMO_LEGACY,
  STORAGE_KEY_PREVIEW,
  readStoredPreviewMode,
  savePreviewMode,
} from '../src/store/storage';

describe('previewMode storage migration (idea#235)', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY_PREVIEW);
    localStorage.removeItem(STORAGE_KEY_DEMO_LEGACY);
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY_PREVIEW);
    localStorage.removeItem(STORAGE_KEY_DEMO_LEGACY);
  });

  it('returns false when neither key is set', async () => {
    expect(await readStoredPreviewMode()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY_PREVIEW)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY_DEMO_LEGACY)).toBeNull();
  });

  it('reads the new previewMode key', async () => {
    localStorage.setItem(STORAGE_KEY_PREVIEW, 'true');
    expect(await readStoredPreviewMode()).toBe(true);
  });

  it('migrates a leftover demoMode=true onto previewMode and removes the old key', async () => {
    localStorage.setItem(STORAGE_KEY_DEMO_LEGACY, 'true');
    expect(await readStoredPreviewMode()).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY_PREVIEW)).toBe('true');
    expect(localStorage.getItem(STORAGE_KEY_DEMO_LEGACY)).toBeNull();
  });

  it('migrates a leftover demoMode=false onto previewMode and removes the old key', async () => {
    localStorage.setItem(STORAGE_KEY_DEMO_LEGACY, 'false');
    expect(await readStoredPreviewMode()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY_PREVIEW)).toBe('false');
    expect(localStorage.getItem(STORAGE_KEY_DEMO_LEGACY)).toBeNull();
  });

  it('prefers the new key when both exist and then drops the old key', async () => {
    localStorage.setItem(STORAGE_KEY_PREVIEW, 'false');
    localStorage.setItem(STORAGE_KEY_DEMO_LEGACY, 'true');
    expect(await readStoredPreviewMode()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY_PREVIEW)).toBe('false');
    expect(localStorage.getItem(STORAGE_KEY_DEMO_LEGACY)).toBeNull();
  });

  it('savePreviewMode writes the new key and removes any leftover demoMode key', async () => {
    localStorage.setItem(STORAGE_KEY_DEMO_LEGACY, 'true');
    await savePreviewMode(true);
    expect(localStorage.getItem(STORAGE_KEY_PREVIEW)).toBe('true');
    expect(localStorage.getItem(STORAGE_KEY_DEMO_LEGACY)).toBeNull();
  });
});
