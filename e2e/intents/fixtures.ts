/**
 * Kid stable fixture IDs (agent-app-dev#10 / walker-ref.yaml, idea#166).
 * Console selectors bind to these — never invent alternate IDs.
 */
export const DURATION_FIXTURES = {
  kolibri: {
    diskId: 'duration-kolibri-grade5a-001',
    instanceId: 'kolibri-grade5a-001',
  },
  nextcloud: {
    diskId: 'duration-nextcloud-grade5a-001',
    instanceId: 'nextcloud-grade5a-001',
  },
} as const;

export type DurationApp = keyof typeof DURATION_FIXTURES;
