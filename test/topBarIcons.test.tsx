/**
 * #264: top-bar buttons use bundled Tabler line icons, each with a visible
 * label, a tooltip and an aria-label; the open panel's button shows a close
 * icon and reads "Close <name>".
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import TopBarButton from '../src/components/TopBarButton';
import Icon, { ICON_PATHS, type IconName } from '../src/icons/tabler';

afterEach(() => cleanup());

const setup = (open: boolean, onClick = () => {}) =>
  render(() => (
    <TopBarButton
      class="status-bar__history-btn"
      testId="history-btn"
      icon="history"
      label="History"
      name="Command History"
      open={open}
      onClick={onClick}
    />
  ));

describe('TopBarButton', () => {
  it('closed: line icon, visible label, tooltip and aria-label', () => {
    const { container } = setup(false);
    const btn = container.querySelector('button')!;
    expect(btn.classList.contains('status-bar__icon-btn')).toBe(true);
    expect(btn.classList.contains('status-bar__history-btn')).toBe(true);
    expect(btn.getAttribute('data-testid')).toBe('history-btn');
    expect(btn.getAttribute('aria-label')).toBe('Command History');
    expect(btn.getAttribute('data-tooltip')).toBe('Command History');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.querySelector('.status-bar__btn-label')!.textContent).toBe('History');
    const svg = btn.querySelector('svg.icon')!;
    expect(svg.getAttribute('data-icon')).toBe('history');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(btn.textContent).not.toMatch(/[🔌👤📋⚙✕]/u);
  });

  it('open: close icon and "Close <name>"', () => {
    const { container } = setup(true);
    const btn = container.querySelector('button')!;
    expect(btn.getAttribute('aria-label')).toBe('Close Command History');
    expect(btn.getAttribute('data-tooltip')).toBe('Close Command History');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.classList.contains('status-bar__icon-btn--open')).toBe(true);
    expect(btn.querySelector('svg.icon')!.getAttribute('data-icon')).toBe('x');
    expect(btn.querySelector('.status-bar__btn-label')!.textContent).toBe('History');
  });

  it('click calls onClick (toggle behaviour stays with the caller)', () => {
    const onClick = vi.fn();
    const { container } = setup(false, onClick);
    fireEvent.click(container.querySelector('button')!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('bundled icons', () => {
  it('every icon renders its paths in a 24×24 line SVG', () => {
    for (const name of Object.keys(ICON_PATHS) as IconName[]) {
      const { container, unmount } = render(() => <Icon name={name} />);
      const svg = container.querySelector('svg')!;
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg.getAttribute('fill')).toBe('none');
      expect(svg.getAttribute('stroke')).toBe('currentColor');
      expect(svg.querySelectorAll('path').length).toBe(ICON_PATHS[name].length);
      unmount();
    }
  });

  it('keeps the Tabler MIT licence next to the icons', () => {
    const licence = readFileSync(join(__dirname, '../src/icons/LICENSE'), 'utf8');
    expect(licence).toMatch(/MIT License/);
    expect(licence).toMatch(/Paweł Kuna/);
  });
});
