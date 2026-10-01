/**
 * Kid stable fixture IDs (agent-app-dev#10 / walker-ref.yaml, idea#166).
 * Console selectors bind to these — never invent alternate IDs.
 *
 * Content pins: CONTENT.seeded.json @0bca699 (ricecooker content/node/channel).
 * Live auth: CONTENT.live.json @2313112 (idea01 import PASS) — facility/class/
 * lesson/learner Morango IDs **CHANGE on re-provision**.
 *
 * ## App-open Running path (Kid interim)
 * After `infra_dock_fixture`, Engine strips `instances/` — Console Open needs
 * **sidecar Running**, NOT startInstances on the dock tree:
 *   cd /home/pi/idea/agents/agent-app-dev
 *   bash tests/duration-tests/scripts/post-dock-restore-running.sh
 *   # default --mode sidecar → /home/pi/idea166-kolibri-live :18080
 * diskId duration-kolibri-grade5a-001 / instanceId kolibri-grade5a-001.
 * Nextcloud sidecar landing on App#10 soon.
 *
 * No ACTIONS.md keys for Kolibri `open_lesson` / in-App learner sign-in —
 * use `open_kolibri_as_learner` (Console) then App-tab login with live IDs below.
 *
 * Lesson chrome (keep_watching / next_resource / exit_lesson / finish_exercise /
 * next_video): NOT hardpassable against stock Kolibri player + CONTENT pins alone
 * — need App-side testids (Kid). Stay **unregistered** (Engine clear miss).
 */

/** Dashed UUID and Morango 32-hex (no dashes) — Kolibri API uses undashed. */
export const uuidForms = (id: string): { dashed: string; raw: string } => {
  const raw = id.replace(/-/g, '').toLowerCase();
  if (raw.length === 32 && /^[0-9a-f]+$/.test(raw)) {
    const dashed =
      id.includes('-') && id.length === 36
        ? id.toLowerCase()
        : `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
    return { dashed, raw };
  }
  return { dashed: id, raw };
};

export const DURATION_FIXTURES = {
  kolibri: {
    diskId: 'duration-kolibri-grade5a-001',
    instanceId: 'kolibri-grade5a-001',
    channelId: '30b6c263-4b96-5a62-93bd-dcf9a5cad7ca',
    channelIdRaw: '30b6c2634b965a6293bddcf9a5cad7ca',
    /** Kolibri facility logins (Kid pack; password = username). */
    auth: {
      teacher: { username: 'teacher', password: 'teacher' },
      learner: { username: 'learner01', password: 'learner01' },
    },
    /** open_video → video-grade5a-01 (API: ?content_id=<raw>) */
    video: {
      logicalId: 'video-grade5a-01',
      contentId: 'e60662de-b15c-52f9-b003-359f7d91f8fd',
      contentIdRaw: 'e60662deb15c52f9b003359f7d91f8fd',
      nodeId: '4a1a1b92-3f6d-59eb-a94c-3f91f0011dd5',
      nodeIdRaw: '4a1a1b923f6d59eba94c3f91f0011dd5',
    },
    /** open_exercise → exercise-grade5a-01 */
    exercise: {
      logicalId: 'exercise-grade5a-01',
      contentId: '7eb9de46-96eb-53d0-bcc1-2fb270b96f03',
      contentIdRaw: '7eb9de4696eb53d0bcc12fb270b96f03',
      nodeId: '94a47ec7-f30d-5cd1-93f8-ad08c42b6c2a',
      nodeIdRaw: '94a47ec7f30d5cd193f8ad08c42b6c2a',
    },
    /**
     * Live auth from Kid CONTENT.live.json @2313112 (idea01).
     * IDs CHANGE on re-run — refresh from App#10 after re-provision.
     * Data: /home/pi/idea166-kolibri-live/
     */
    live: {
      sourceCommit: '2313112',
      host: 'idea01',
      dataDir: '/home/pi/idea166-kolibri-live/',
      kolibriHttpPort: 18080,
      facility: {
        id: 'f0e1353e8c40d985faab5ead5c91d03f',
        idDashed: 'f0e1353e-8c40-d985-faab-5ead5c91d03f',
      },
      class: {
        id: 'a12df5408d20cbe5fd00c0cb036f48f6',
        idDashed: 'a12df540-8d20-cbe5-fd00-c0cb036f48f6',
        name: 'Grade 5A',
      },
      lesson: {
        id: '2a955770551f7d583c31104f39653fdf',
        idDashed: '2a955770-551f-7d58-3c31-104f39653fdf',
        title: 'Grade 5A Duration Lesson',
      },
      coach: {
        username: 'teacher',
        id: '043d490442213bf426cad1e261536ca7',
        idDashed: '043d4904-4221-3bf4-26ca-d1e261536ca7',
      },
      learners: [
        {
          username: 'learner01',
          id: '699a6ede1943c0e241377d3356d925df',
          idDashed: '699a6ede-1943-c0e2-4137-7d3356d925df',
        },
        {
          username: 'learner02',
          id: 'cd49828e41739df3553cb43092ec0233',
          idDashed: 'cd49828e-4173-9df3-553c-b43092ec0233',
        },
        {
          username: 'learner03',
          id: '07127d02113f5ed1a5edf56533473df7',
          idDashed: '07127d02-113f-5ed1-a5ed-f56533473df7',
        },
      ],
    },
  },
  nextcloud: {
    diskId: 'duration-nextcloud-grade5a-001',
    instanceId: 'nextcloud-grade5a-001',
    auth: {
      teacher: { username: 'teacher', password: 'teacher' },
      learner: { username: 'student01', password: 'student01' },
    },
  },
} as const;

export type DurationApp = keyof typeof DURATION_FIXTURES;
