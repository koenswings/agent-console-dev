import { describe, it, expect } from 'vitest';
import { sameIds } from '../src/store/sameIds';

describe('sameIds (idea#309)', () => {
  it('is true for the same IDs in the same order', () => {
    expect(sameIds(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameIds([], [])).toBe(true);
  });
  it('is false for a different order, length or ID', () => {
    expect(sameIds(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameIds(['a'], ['a', 'b'])).toBe(false);
    expect(sameIds(['a', 'c'], ['a', 'b'])).toBe(false);
  });
});
