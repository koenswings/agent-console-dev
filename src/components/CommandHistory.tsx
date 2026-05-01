import { For, Show, createMemo, createSignal, type Component } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { CommandLogStore, CommandTrace } from '../types/commandLog';

import LogLines from './LogLines';

interface CommandHistoryProps {
  commandLogStore: Accessor<CommandLogStore | null | false>;
}

const timeAgo = (ts: number): string => {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
};

const CommandHistory: Component<CommandHistoryProps> = (props) => {
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

  // Finished traces only, newest first (reverse of insertion order)
  const finishedTraces = createMemo((): CommandTrace[] => {
    const store = cls();
    if (!store) return [];
    return [...store.recentTraceIds]
      .reverse()
      .map((id) => store.traces[id])
      .filter((t): t is CommandTrace => t != null && t.status !== 'running');
  });

  return (
    <div class="command-history">
      <div class="command-history__header">Command History</div>
      <Show when={cls() !== null} fallback={<div class="command-history__empty">Loading…</div>}>
        <Show
          when={cls() !== false}
          fallback={<div class="command-history__empty command-history__empty--error">⚠️ Error loading history</div>}
        >
          <Show
            when={finishedTraces().length > 0}
            fallback={<div class="command-history__empty">No command history yet</div>}
          >
            <For each={finishedTraces()}>
              {(trace) => (
                <>
                  <div class="command-history__row" onClick={() => toggleExpand(trace.traceId)}>
                    <span class="command-history__status">
                      {trace.status === 'ok' ? '✓' : '✗'}
                    </span>
                    <span class="command-history__name">{trace.command}</span>
                    <span class="command-history__time">
                      {timeAgo(trace.completedAt ?? trace.startedAt)}
                    </span>
                    <span class="command-history__chevron">
                      {expandedIds().has(trace.traceId) ? '▲' : '▼'}
                    </span>
                  </div>
                  <Show when={trace.errorMessage}>
                    <div class="command-history__error">{trace.errorMessage}</div>
                  </Show>
                  <Show when={expandedIds().has(trace.traceId)}>
                    <div class="command-history__logs">
                      <Show
                        when={trace.logs.length > 0}
                        fallback={<div class="command-history__no-logs">No log output</div>}
                      >
                        <LogLines logs={trace.logs} />
                      </Show>
                    </div>
                  </Show>
                </>
              )}
            </For>
          </Show>
        </Show>
      </Show>
    </div>
  );
};

export default CommandHistory;
