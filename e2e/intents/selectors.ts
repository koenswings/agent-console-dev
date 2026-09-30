/**
 * Id-keyed Console selectors for duration walks (idea#166).
 * Prefer data-testid; never position-based (nth-child / first()).
 */
export const sel = {
  consoleOverview: '[data-testid="console-overview"]',
  opEntry: '[data-testid="op-entry"]',
  opOverview: '[data-testid="op-overview"]',
  networkTree: '[data-testid="network-tree"]',
  accountBtn: '[data-testid="account-btn"]',
  loginForm: '[data-testid="login-form"]',
  ejectConfirm: '[data-testid="eject-confirm"]',
  eraseDialog: '[data-testid="erase-dialog"]',
  eraseConfirmName: '[data-testid="erase-confirm-name"]',
  emptyDiskPanel: '[data-testid="empty-disk-panel"]',
  diskSectionFiles: '[data-testid="disk-section-files"]',
  engine: (id: string) => `[data-testid="engine-${id}"]`,
  disk: (id: string) => `[data-testid="disk-${id}"]`,
  instance: (id: string) => `[data-testid="instance-${id}"]`,
  candidate: (id: string) => `[data-testid="candidate-${id}"]`,
  diskView: (id: string) => `[data-testid="disk-view-${id}"]`,
  eject: (diskId: string) => `[data-testid="eject-${diskId}"]`,
} as const;
