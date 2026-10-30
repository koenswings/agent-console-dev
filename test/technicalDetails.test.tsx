/**
 * idea#76: debug views show the plain sentence first and keep the raw Engine
 * text inside a closed "Technical details" toggle.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import TechnicalDetails from '../src/components/TechnicalDetails';
import { plainEngineText } from '../src/store/plainError';

afterEach(cleanup);

const FLAG = /(^|\s)--[a-z]/i;
const CODE = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/;

/** Text a user sees without opening any closed <details>. */
const visibleText = (root: HTMLElement): string => {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('details:not([open])').forEach((d) => {
    d.querySelectorAll(':scope > :not(summary)').forEach((n) => n.remove());
  });
  return clone.textContent ?? '';
};

describe('TechnicalDetails', () => {
  const RAW = [
    'MAJOR_NOT_ALLOWED: 0.15.5 -> 1.0 is a major update; pass --allow-major',
    'Usage: updateApp <instanceId|name> <newAppId> [--allow-major]',
    'ENOENT: no such file or directory',
    'SOME_FUTURE_REFUSAL',
  ];

  for (const raw of RAW) {
    it(`plain first, raw under closed toggle: ${raw}`, () => {
      const { getByTestId } = render(() => <TechnicalDetails raw={raw} testId="td" />);
      const root = getByTestId('td');
      expect(root.querySelector('.tech-details__plain')!.textContent).toBe(plainEngineText(raw));
      const details = root.querySelector('details')!;
      expect(details).not.toBeNull();
      expect(details.open).toBe(false);
      expect(details.querySelector('summary')!.textContent).toBe('Technical details');
      expect(details.querySelector('.tech-details__raw')!.textContent).toBe(raw);
      const shown = visibleText(root);
      expect(shown).not.toMatch(FLAG);
      expect(shown).not.toMatch(CODE);
    });
  }

  it('no toggle when the raw text already is the plain sentence', () => {
    const raw = "Target disk 'kolibri-disk' not found or not docked.";
    const { getByTestId } = render(() => <TechnicalDetails raw={raw} testId="td" />);
    expect(getByTestId('td').textContent).toBe(raw);
    expect(getByTestId('td').querySelector('details')).toBeNull();
  });

  it('no toggle when the raw text is empty', () => {
    const { getByTestId } = render(() => <TechnicalDetails raw="  " testId="td" />);
    expect(getByTestId('td').querySelector('details')).toBeNull();
  });

  it('strips ANSI from the raw text', () => {
    const { getByTestId } = render(() => <TechnicalDetails raw={'\u001b[31mBAD_THING: x\u001b[0m'} testId="td" />);
    expect(getByTestId('td').querySelector('.tech-details__raw')!.textContent).toBe('BAD_THING: x');
  });
});
