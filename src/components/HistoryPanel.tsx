import { For, Show, createMemo, createSignal, type Component } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { CommandLogStore, CommandTrace } from '../types/commandLog';
import type { CommandLogState, CommandLogError } from '../store/commandLog';
import LogLines from './LogLines';
import TechnicalDetails from './TechnicalDetails';
import { historyRowView } from '../store/historyRow';

interface HistoryPanelProps {
  commandLogStore: Accessor<CommandLogState>;
  onClose: () => void;
}

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
  const clsError = (): CommandLogError | null => {
    const s = cls();
    if (s && typeof s === 'object' && 'error' in s) return s as CommandLogError;
    return null;
  };

  const finishedTraceIds = createMemo((): string[] => {
    const store = cls();
    if (!store || (typeof store === 'object' && 'error' in store)) return [];
    const s = store as CommandLogStore;
    return [...s.recentTraceIds]
      .reverse()
      .filter((id) => {
        const t = s.traces[id];
        return t != null && t.status !== 'running';
      });
  });

  return (
    <div class="history-panel">
      <div class="history-panel__header">
        <span class="history-panel__title">Command History</span>
      </div>

      <div class="history-panel__body">
        <Show when={cls() !== null} fallback={<div class="history-panel__empty">Loading…</div>}>
          <Show
            when={!clsError()}
            fallback={
              <div class="history-panel__empty history-panel__empty--unavailable">
                <p>Command history is not available on this engine.</p>
                <p>
                  Tried: <code>{clsError()?.url}</code>
                  {clsError()?.status != null ? ` — HTTP ${clsError()!.status}` : ' — connection failed'}
                </p>
                <p>Please report this to Axle with the URL above.</p>
              </div>
            }
          >
            <Show
              when={finishedTraceIds().length > 0}
              fallback={<div class="history-panel__empty">No command history yet</div>}
            >
              <For each={finishedTraceIds()}>
                {(id) => {
                  const trace = (): CommandTrace | undefined => {
                    const store = cls();
                    if (!store || (typeof store === 'object' && 'error' in store)) return undefined;
                    return (store as CommandLogStore).traces[id];
                  };
                  return (
                    <Show when={trace()}>
                      {(t) => {
                        const view = () => historyRowView(t());
                        return (
                          <div class="history-entry" data-testid={`history-entry-${id}`}>
                            <button
                              class="history-entry__row"
                              onClick={() => toggleExpand(id)}
                              aria-expanded={expandedIds().has(id)}
                            >
                              <span
                                class={`history-entry__status history-entry__status--${view().tone}`}
                                data-testid={`history-entry-status-${id}`}
                              >
                                {view().icon}
                              </span>
                              <span class="history-entry__command">{t().command}</span>
                              <Show when={view().message}>
                                <span
                                  class={view().tone === 'info' ? 'history-entry__info-msg' : 'history-entry__error-msg'}
                                  data-testid={`history-entry-message-${id}`}
                                >{view().message}</span>
                              </Show>
                              <span class="history-entry__time">{timeAgo(t().completedAt ?? t().startedAt)}</span>
                              <span class="history-entry__chevron" aria-hidden="true">
                                {expandedIds().has(id) ? '▲' : '▼'}
                              </span>
                            </button>
                            <Show when={expandedIds().has(id)}>
                              <div class="history-entry__detail">
                                <Show when={t().errorMessage}>
                                  <TechnicalDetails raw={t().errorMessage} class="history-entry__error-detail" testId="history-error-details" />
                                </Show>
                                <dl class="history-entry__meta">
                                  <div><dt>Started</dt><dd>{formatTime(t().startedAt)}</dd></div>
                                  <Show when={t().completedAt}>
                                    <div><dt>Finished</dt><dd>{formatTime(t().completedAt!)}</dd></div>
                                    <div><dt>Duration</dt><dd>{((t().completedAt! - t().startedAt) / 1000).toFixed(1)}s</dd></div>
                                  </Show>
                                  <Show when={typeof t().args === 'object' && t().args !== null}>
                                    <For each={Object.entries(t().args as Record<string, string>)}>
                                      {([k, v]) => (
                                        <div><dt>{k}</dt><dd>{String(v)}</dd></div>
                                      )}
                                    </For>
                                  </Show>
                                </dl>
                                <Show
                                  when={t().logs.length > 0}
                                  fallback={<div class="history-entry__no-logs">No log output recorded</div>}
                                >
                                  <LogLines logs={t().logs} />
                                </Show>
                              </div>
                            </Show>
                          </div>
                        );
                      }}
                    </Show>
                  );
                }}
              </For>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default HistoryPanel;
