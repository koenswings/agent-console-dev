import { describe, it, expect } from 'vitest';
import { render } from '@solidjs/testing-library';
import StatusDot from '../components/StatusDot';
import type { Status } from '../types/store';

describe('StatusDot component', () => {
  it('renders a span element', () => {
    const { container } = render(() => <StatusDot status="Running" />);
    expect(container.querySelector('span')).toBeTruthy();
  });

  it('applies status-dot--running class for Running', () => {
    const { container } = render(() => <StatusDot status="Running" />);
    const dot = container.querySelector('.status-dot');
    expect(dot).toHaveClass('status-dot--running');
  });

  it('applies status-dot--starting class for Starting', () => {
    const { container } = render(() => <StatusDot status="Starting" />);
    const dot = container.querySelector('.status-dot');
    expect(dot).toHaveClass('status-dot--starting');
  });

  it('applies status-dot--stopped class for Stopped', () => {
    const { container } = render(() => <StatusDot status="Stopped" />);
    const dot = container.querySelector('.status-dot');
    expect(dot).toHaveClass('status-dot--stopped');
  });

  it('applies status-dot--docked class for Docked', () => {
    const { container } = render(() => <StatusDot status="Docked" />);
    const dot = container.querySelector('.status-dot');
    expect(dot).toHaveClass('status-dot--docked');
  });

  it('applies status-dot--error class for Error', () => {
    const { container } = render(() => <StatusDot status="Error" />);
    const dot = container.querySelector('.status-dot');
    expect(dot).toHaveClass('status-dot--error');
  });

  it('applies status-dot--undocked class for Undocked', () => {
    const { container } = render(() => <StatusDot status="Undocked" />);
    const dot = container.querySelector('.status-dot');
    expect(dot).toHaveClass('status-dot--undocked');
  });

  it('applies status-dot--pauzed class for Pauzed', () => {
    const { container } = render(() => <StatusDot status="Pauzed" />);
    const dot = container.querySelector('.status-dot');
    expect(dot).toHaveClass('status-dot--pauzed');
  });

  it('sets a descriptive aria-label', () => {
    const { container } = render(() => <StatusDot status="Error" />);
    const dot = container.querySelector('.status-dot');
    expect(dot).toHaveAttribute('aria-label', 'Status: Error');
  });

  it.each<Status>(['Running', 'Starting', 'Stopped', 'Docked', 'Error', 'Undocked', 'Pauzed'])(
    'renders without throwing for status %s',
    (status) => {
      expect(() => render(() => <StatusDot status={status} />)).not.toThrow();
    }
  );
});
