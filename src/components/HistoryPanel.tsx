import { For, Show, createMemo, createSignal, type Component } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { CommandLogStore, CommandTrace } from '../types/commandLog';
import LogLines from './LogLines';

interface HistoryPanelProps {
  commandLogStore: Accessor<CommandLogStore | null | false>;
  onClose: () => void;
}

const ANSI_RE = /\u001b\[[0-9;]*[mGKHFABCDJsu]|\u001b[\[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g;
const stripAnsi = (s: string): string => s.replace(ANSI_RE, '');

const timeAgo = (ts: number): string => {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
};

const formatTime = (ts: number): string => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

const HistoryPanel: Component<HistoryPanelProps> = (props) => {
  const [expandedIds, setExpandedIds] = createSignal<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const cls = () => props.commandLogStore();

  const finishedTraces = createMemo((): CommandTrace[] => {
    const store = cls();
    if (!store) return [];
    return [...store.recentTraceIds]
      .reverse()
      .map((id) => store.traces[id])
      .filter((t): t is CommandTrace => t != null && t.status !== 'running');
  });

  return (
    <div class="history-panel">
      <div class="history-panel__header">
        <span class="history-panel__title">Command History</span>
        <button class="history-panel__close" onClick={props.onClose} aria-label="Close history">✕</button>
      </div>

      <div class="history-panel__body">
        <Show when={cls() !== null} fallback={<div class="history-panel__empty">Loading…</div>}>
          <Show
            when={cls() !== false}
            fallback={
              <div class="history-panel__empty history-panel__empty--unavailable">
                Command history is not available on this engine.<br />
                This feature requires a newer engine version.
              </div>
            }
          >
            <Show
              when={finishedTraces().length > 0}
              fallback={<div class="history-panel__empty">No command history yet</div>}
            >
              <For each={finishedTraces()}>
                {(trace) => (
                  <div class="history-entry">
                    <button
                      class="history-entry__row"
                      onClick={() => toggleExpand(trace.traceId)}
                      aria-expanded={expandedIds().has(trace.traceId)}
                    >
                      <span class={`history-entry__status history-entry__status--${trace.status}`}>
                        {trace.status === 'ok' ? '✓' : '✗'}
                      </span>
                      <span class="history-entry__command">{trace.command}</span>
                      <Show when={trace.errorMessage}>
                        <span class="history-entry__error-msg">{stripAnsi(trace.errorMessage!)}</span>
                      </Show>
                      <span class="history-entry__time">{timeAgo(trace.completedAt ?? trace.startedAt)}</span>
                      <span class="history-entry__chevron" aria-hidden="true">
                        {expandedIds().has(trace.traceId) ? '▲' : '▼'}
                      </span>
                    </button>
                    <Show when={expandedIds().has(trace.traceId)}>
                      <div class="history-entry__detail">
                        <dl class="history-entry__meta">
                          <div><dt>Started</dt><dd>{formatTime(trace.startedAt)}</dd></div>
                          <Show when={trace.completedAt}>
                            <div><dt>Finished</dt><dd>{formatTime(trace.completedAt!)}</dd></div>
                            <div><dt>Duration</dt><dd>{((trace.completedAt! - trace.startedAt) / 1000).toFixed(1)}s</dd></div>
                          </Show>
                          <Show when={typeof trace.args === 'object' && trace.args !== null}>
                            <For each={Object.entries(trace.args as Record<string, string>)}>
                              {([k, v]) => (
                                <div><dt>{k}</dt><dd>{String(v)}</dd></div>
                              )}
                            </For>
                          </Show>
                        </dl>
                        <Show
                          when={trace.logs.length > 0}
                          fallback={<div class="history-entry__no-logs">No log output recorded</div>}
                        >
                          <LogLines logs={trace.logs} />
                        </Show>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default HistoryPanel;
