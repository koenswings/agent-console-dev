/**
 * Kid stable fixture IDs (agent-app-dev#10 / walker-ref.yaml, idea#166).
 * Console selectors bind to these — never invent alternate IDs.
 *
 * CONTENT seed pins from Kid @0bca699 CONTENT.seeded.json
 * (liveImportStatus: pending — channel import on Running instance still needed).
 */
export const DURATION_FIXTURES = {
  kolibri: {
    diskId: 'duration-kolibri-grade5a-001',
    instanceId: 'kolibri-grade5a-001',
    channelId: '30b6c263-4b96-5a62-93bd-dcf9a5cad7ca',
    /** open_video → video-grade5a-01 */
    video: {
      logicalId: 'video-grade5a-01',
      contentId: 'e60662de-b15c-52f9-b003-359f7d91f8fd',
      nodeId: '4a1a1b92-3f6d-59eb-a94c-3f91f0011dd5',
    },
    /** open_exercise → exercise-grade5a-01 */
    exercise: {
      logicalId: 'exercise-grade5a-01',
      contentId: '7eb9de46-96eb-53d0-bcc1-2fb270b96f03',
      nodeId: '94a47ec7-f30d-5cd1-93f8-ad08c42b6c2a',
    },
  },
  nextcloud: {
    diskId: 'duration-nextcloud-grade5a-001',
    instanceId: 'nextcloud-grade5a-001',
  },
} as const;

export type DurationApp = keyof typeof DURATION_FIXTURES;
