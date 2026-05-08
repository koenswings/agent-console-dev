import { createSignal, createMemo, For, Show, type Accessor, type Component } from 'solid-js';
import NetworkTree from './NetworkTree';
import OperationProgress from './OperationProgress';
import HistoryPanel from './HistoryPanel';
import MobileAppList from './MobileAppList';
import type { Store } from '../types/store';
import type { DragAppData } from '../types/drag';
import type { Selection } from './NetworkTree';

// Redefined locally — mirrors PendingMove in App.tsx
interface PendingMove {
  data: DragAppData;
  targetDiskId: string;
  targetDiskName: string;
  targetEngineHostname: string;
}

interface MobileLayoutProps {
  store: Accessor<Store | null>;
  commandLogStore: Accessor<import('../store/commandLog').CommandLogState>;
  selection: Selection;
  onSelect: (s: Selection) => void;
  dragData: Accessor<DragAppData | null>;
  onDrop: (data: DragAppData, targetDiskId: string) => void;
  pendingMove: Accessor<PendingMove | null>;
  onCopyMoveChoice: (op: 'copy' | 'move') => void;
  onCancelMove: () => void;
}

type TabId = 'apps' | 'network' | 'activity' | 'history';

const MobileLayout: Component<MobileLayoutProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal<TabId>('apps');

  const activeOpCount = createMemo(() => {
    const s = props.store();
    if (!s) return 0;
    return Object.values(s.operationDB ?? {}).filter(
      (op) => op.status === 'Running' || op.status === 'Pending'
    ).length;
  });

  return (
    <div class="mobile-layout">
      {/* Tab content */}
      <div class="mobile-tab-content">
        <Show when={activeTab() === 'apps'}>
          <MobileAppList store={props.store} commandLogStore={props.commandLogStore} />
        </Show>
        <Show when={activeTab() === 'network'}>
          <div class="mobile-network-tab">
            <NetworkTree
              selection={props.selection}
              onSelect={props.onSelect}
              store={props.store}
              dragData={props.dragData}
              onDrop={props.onDrop}
            />
          </div>
        </Show>
        <Show when={activeTab() === 'activity'}>
          <div class="mobile-activity-tab">
            <OperationProgress store={props.store} commandLogStore={props.commandLogStore} />
          </div>
        </Show>
        <Show when={activeTab() === 'history'}>
          <HistoryPanel
            commandLogStore={props.commandLogStore}
            onClose={() => setActiveTab('apps')}
          />
        </Show>
      </div>

      {/* Fixed bottom tab bar */}
      <div class="mobile-tab-bar">
        <button
          class={`mobile-tab-bar__item${activeTab() === 'apps' ? ' mobile-tab-bar__item--active' : ''}`}
          onClick={() => setActiveTab('apps')}
        >
          <span class="mobile-tab-bar__icon">📦</span>
          <span>Apps</span>
        </button>
        <button
          class={`mobile-tab-bar__item${activeTab() === 'network' ? ' mobile-tab-bar__item--active' : ''}`}
          onClick={() => setActiveTab('network')}
        >
          <span class="mobile-tab-bar__icon">🌐</span>
          <span>Network</span>
        </button>
        <button
          class={`mobile-tab-bar__item${activeTab() === 'activity' ? ' mobile-tab-bar__item--active' : ''}`}
          onClick={() => setActiveTab('activity')}
        >
          <span class="mobile-tab-bar__icon">⚡</span>
          <Show when={activeOpCount() > 0}>
            <span class="mobile-tab-bar__badge">{activeOpCount()}</span>
          </Show>
          <span>Activity</span>
        </button>
        <button
          class={`mobile-tab-bar__item${activeTab() === 'history' ? ' mobile-tab-bar__item--active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          <span class="mobile-tab-bar__icon">📋</span>
          <span>History</span>
        </button>
      </div>

      {/* Copy/Move modal overlay */}
      <Show when={props.pendingMove()}>
        {(pm) => (
          <div class="copy-move-modal-overlay" role="dialog" aria-modal="true" aria-label="Copy or Move">
            <div class="copy-move-modal">
              <div class="copy-move-modal__title">Copy or Move?</div>
              <p class="copy-move-modal__desc">
                <strong>{pm().data.instanceName}</strong> from <em>{pm().data.sourceDiskName}</em> → <em>{pm().targetDiskName}</em> on <em>{pm().targetEngineHostname}</em>
              </p>
              <div class="copy-move-modal__actions">
                <button class="btn" onClick={props.onCancelMove}>Cancel</button>
                <button class="btn" onClick={() => props.onCopyMoveChoice('move')}>Move</button>
                <button class="btn btn--primary" onClick={() => props.onCopyMoveChoice('copy')}>Copy</button>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
};

export default MobileLayout;
