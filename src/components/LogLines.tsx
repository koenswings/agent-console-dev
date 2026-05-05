import { For, createEffect, createSignal, type Component } from 'solid-js';
import type { LogEntry } from '../types/commandLog';

interface LogLinesProps {
  logs: LogEntry[];
}

// Strip ANSI escape sequences (colours, cursor codes, etc.) from engine log output
const ANSI_RE = /\u001b\[[0-9;]*[mGKHFABCDJsu]|\u001b[\[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g;
const stripAnsi = (s: string): string => s.replace(ANSI_RE, '');

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
  const [copied, setCopied] = createSignal(false);

  // Auto-scroll to bottom whenever logs change
  createEffect(() => {
    void props.logs.length; // track length changes
    if (containerRef) containerRef.scrollTop = containerRef.scrollHeight;
  });

  const handleCopy = () => {
    const text = props.logs
      .map((e) => `[${formatTime(e.timestamp)}] ${e.message}`)
      .join('\n');

    const finish = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(finish).catch(() => execCommandCopy(text, finish));
    } else {
      execCommandCopy(text, finish);
    }
  };

  const execCommandCopy = (text: string, onSuccess: () => void) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      if (document.execCommand('copy')) onSuccess();
    } finally {
      document.body.removeChild(ta);
    }
  };

  return (
    <div class="log-lines-wrapper">
      <button class="log-lines__copy" onClick={handleCopy} title="Copy log to clipboard">
        {copied() ? '✓ Copied' : 'Copy'}
      </button>
      <div class="log-lines" ref={containerRef}>
        <For each={props.logs}>
          {(entry) => (
            <div class="log-lines__row">
              <span class="log-lines__ts">[{formatTime(entry.timestamp)}]</span>
              <span class={msgClass(entry.level)}>{stripAnsi(entry.message)}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

export default LogLines;
