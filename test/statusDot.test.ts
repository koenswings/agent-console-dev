import { describe, it, expect } from 'vitest';
import { statusColour, statusStyle } from '../src/components/StatusDot';
import type { Status } from '../src/types/store';

describe('statusColour', () => {
  const cases: Array<[Status, string]> = [
    ['Running', '#1F6B3A'],
    ['Starting', '#1A5F5A'],
    ['Stopped', '#6B4E2A'],
    ['Docked', '#6B4E2A'],
    ['Error', '#8E1515'],
    ['Undocked', '#5A5248'],
    ['Pauzed', '#6B4E2A'],
    ['Missing', '#5A5248'],
  ];

  it.each(cases)('returns %s → %s', (status, expected) => {
    expect(statusColour(status)).toBe(expected);
  });
});

describe('statusStyle', () => {
  it('returns a className and colour for Running', () => {
    const result = statusStyle('Running');
    expect(result.className).toBe('status-dot--running');
    expect(result.colour).toBe('#1F6B3A');
  });

  it('returns a className and colour for Error', () => {
    const result = statusStyle('Error');
    expect(result.className).toBe('status-dot--error');
    expect(result.colour).toBe('#8E1515');
  });

  it('returns umber for Stopped', () => {
    expect(statusStyle('Stopped').colour).toBe('#6B4E2A');
  });

  it('returns umber for Docked (same as Stopped)', () => {
    expect(statusStyle('Docked').colour).toBe('#6B4E2A');
  });

  it('returns umber for Pauzed', () => {
    expect(statusStyle('Pauzed').colour).toBe('#6B4E2A');
  });

  it('returns ink for Undocked', () => {
    expect(statusStyle('Undocked').colour).toBe('#5A5248');
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
