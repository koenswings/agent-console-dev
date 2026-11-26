import { describe, it, expect } from 'vitest';
import { statusColour, statusStyle } from '../src/components/StatusDot';
import type { Status } from '../src/types/store';

describe('statusColour', () => {
  const cases: Array<[Status, string]> = [
    ['Running', '#3A6B28'],
    ['Starting', '#1A5F56'],
    ['Stopped', '#8A6A3A'],
    ['Docked', '#8A6A3A'],
    ['Error', '#DC3C32'],
    ['Undocked', '#5A4A3A'],
    ['Pauzed', '#8A6A3A'],
    ['Missing', '#5A4A3A'],
  ];

  it.each(cases)('returns %s → %s', (status, expected) => {
    expect(statusColour(status)).toBe(expected);
  });
});

describe('statusStyle', () => {
  it('returns a className and colour for Running', () => {
    const result = statusStyle('Running');
    expect(result.className).toBe('status-dot--running');
    expect(result.colour).toBe('#3A6B28');
  });

  it('returns a className and colour for Error', () => {
    const result = statusStyle('Error');
    expect(result.className).toBe('status-dot--error');
    expect(result.colour).toBe('#DC3C32');
  });

  it('returns dusty umber for Stopped', () => {
    expect(statusStyle('Stopped').colour).toBe('#8A6A3A');
  });

  it('returns dusty umber for Docked (same as Stopped)', () => {
    expect(statusStyle('Docked').colour).toBe('#8A6A3A');
  });

  it('returns dusty umber for Pauzed', () => {
    expect(statusStyle('Pauzed').colour).toBe('#8A6A3A');
  });

  it('returns ink for Undocked', () => {
    expect(statusStyle('Undocked').colour).toBe('#5A4A3A');
  });

  it('covers all Status values', () => {
    const allStatuses: Status[] = [
      'Running', 'Starting', 'Stopped', 'Docked', 'Error', 'Undocked', 'Pauzed', 'Missing',
    ];
    allStatuses.forEach((s) => {
      expect(() => statusStyle(s)).not.toThrow();
      expect(statusStyle(s).colour).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
  });
});
