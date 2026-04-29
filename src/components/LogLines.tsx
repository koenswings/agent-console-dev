import { For, createEffect, type Component } from 'solid-js';
import type { LogEntry } from '../types/commandLog';

interface LogLinesProps {
  logs: LogEntry[];
}

const formatTime = (ts: number): string => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

const msgClass = (level: LogEntry['level']): string => {
  if (level === 'log') return 'log-lines__msg';
  return `log-lines__msg log-lines__msg--${level}`;
};

const LogLines: Component<LogLinesProps> = (props) => {
  let containerRef!: HTMLDivElement;

  // Auto-scroll to bottom whenever logs change
  createEffect(() => {
    void props.logs.length; // track length changes
    if (containerRef) containerRef.scrollTop = containerRef.scrollHeight;
  });

  return (
    <div class="log-lines" ref={containerRef}>
      <For each={props.logs}>
        {(entry) => (
          <div class="log-lines__row">
            <span class="log-lines__ts">[{formatTime(entry.timestamp)}]</span>
            <span class={msgClass(entry.level)}>{entry.message}</span>
          </div>
        )}
      </For>
    </div>
  );
};

export default LogLines;
