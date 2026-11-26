/**
 * #264: the password show / hide button uses Tabler eye / eye-off with a
 * matching aria-label and tooltip (no emoji).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import PasswordToggle from '../src/components/PasswordToggle';
import AccountScreen from '../src/components/AccountScreen';

afterEach(() => cleanup());

describe('PasswordToggle', () => {
  it('hidden password: eye icon, "Show password"; toggles to eye-off, "Hide password"', () => {
    const [shown, setShown] = createSignal(false);
    const { container } = render(() => <PasswordToggle shown={shown()} onToggle={() => setShown((v) => !v)} />);
    const btn = container.querySelector('button')!;
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.getAttribute('aria-label')).toBe('Show password');
    expect(btn.getAttribute('data-tooltip')).toBe('Show password');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.querySelector('svg')!.getAttribute('data-icon')).toBe('eye');
    expect(btn.textContent).not.toMatch(/[👁🙈]/u);
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-label')).toBe('Hide password');
    expect(btn.getAttribute('data-tooltip')).toBe('Hide password');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.querySelector('svg')!.getAttribute('data-icon')).toBe('eye-off');
  });

  it('Account sign-in: the toggle shows and hides the password input', () => {
    const { container } = render(() => <AccountScreen store={null} connection={null} />);
    const input = container.querySelector('input[autocomplete="current-password"]') as HTMLInputElement;
    const btn = container.querySelector('[data-testid="password-toggle"]') as HTMLButtonElement;
    expect(input.type).toBe('password');
    expect(btn.querySelector('svg')!.getAttribute('data-icon')).toBe('eye');
    fireEvent.click(btn);
    expect(input.type).toBe('text');
    expect(btn.querySelector('svg')!.getAttribute('data-icon')).toBe('eye-off');
  });
});
