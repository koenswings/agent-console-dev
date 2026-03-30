import { describe, it, expect } from 'vitest';
import { statusColour, statusStyle } from '../components/StatusDot';
import type { Status } from '../types/store';

describe('statusColour', () => {
  const cases: Array<[Status, string]> = [
    ['Running', '#22c55e'],
    ['Starting', '#3b82f6'],
    ['Stopped', '#eab308'],
    ['Docked', '#eab308'],
    ['Error', '#ef4444'],
    ['Undocked', '#9ca3af'],
    ['Pauzed', '#f97316'],
  ];

  it.each(cases)('returns %s → %s', (status, expected) => {
    expect(statusColour(status)).toBe(expected);
  });
});

describe('statusStyle', () => {
  it('returns a className and colour for Running', () => {
    const result = statusStyle('Running');
    expect(result.className).toBe('status-dot--running');
    expect(result.colour).toBe('#22c55e');
  });

  it('returns a className and colour for Error', () => {
    const result = statusStyle('Error');
    expect(result.className).toBe('status-dot--error');
    expect(result.colour).toBe('#ef4444');
  });

  it('returns yellow for Stopped', () => {
    expect(statusStyle('Stopped').colour).toBe('#eab308');
  });

  it('returns yellow for Docked (same as Stopped)', () => {
    expect(statusStyle('Docked').colour).toBe('#eab308');
  });

  it('returns orange for Pauzed', () => {
    expect(statusStyle('Pauzed').colour).toBe('#f97316');
  });

  it('returns grey for Undocked', () => {
    expect(statusStyle('Undocked').colour).toBe('#9ca3af');
  });

  it('covers all Status values', () => {
    const allStatuses: Status[] = [
      'Running', 'Starting', 'Stopped', 'Docked', 'Error', 'Undocked', 'Pauzed',
    ];
    allStatuses.forEach((s) => {
      expect(() => statusStyle(s)).not.toThrow();
      expect(statusStyle(s).colour).toMatch(/^#[0-9a-f]{6}$/);
    });
  });
});
