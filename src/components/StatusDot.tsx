import type { Component } from 'solid-js';
import type { Status } from '../types/store';

// ---------------------------------------------------------------------------
// Pure helper — maps a Status value to a CSS class name and hex colour.
// Exported so unit tests can verify without mounting any DOM.
// ---------------------------------------------------------------------------

export interface StatusStyle {
  className: string;
  colour: string;
}

export const statusStyle = (status: Status): StatusStyle => {
  switch (status) {
    case 'Running':
      return { className: 'status-dot--running', colour: '#22c55e' };
    case 'Starting':
      return { className: 'status-dot--starting', colour: '#3b82f6' };
    case 'Stopped':
      return { className: 'status-dot--stopped', colour: '#eab308' };
    case 'Docked':
      return { className: 'status-dot--docked', colour: '#eab308' };
    case 'Error':
      return { className: 'status-dot--error', colour: '#ef4444' };
    case 'Undocked':
      return { className: 'status-dot--undocked', colour: '#9ca3af' };
    case 'Pauzed':
      return { className: 'status-dot--pauzed', colour: '#f97316' };
    default: {
      // Exhaustive check — TypeScript will error if a new Status is added
      // without updating this function.
      const _exhaustive: never = status;
      return { className: 'status-dot--undocked', colour: '#9ca3af' };
    }
  }
};

/** Convenience export used by unit tests. */
export const statusColour = (status: Status): string => statusStyle(status).colour;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface StatusDotProps {
  status: Status;
  /** Override the default 10 px size. */
  size?: number;
}

const StatusDot: Component<StatusDotProps> = (props) => {
  const style = () => statusStyle(props.status);

  return (
    <span
      class={`status-dot ${style().className}`}
      style={props.size != null ? `width:${props.size}px;height:${props.size}px` : undefined}
      role="img"
      aria-label={`Status: ${props.status}`}
      title={props.status}
    />
  );
};

export default StatusDot;
