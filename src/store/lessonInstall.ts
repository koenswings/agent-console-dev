/**
 * Real teacher-lesson install: catalog app kolibri-1.0 onto the two docked
 * fixture disks. Replaces the demo store's fake Kolibri on DISK001.
 * Lesson content is a channel already on those disks, not another catalog app.
 * x-app.version is not 1.0 and must not block the click (Kid App#10 0d52c2a).
 */
export const KOLIBRI_LESSON_APP_ID = 'kolibri-1.0' as const;
export const KOLIBRI_CATALOG_ERROR = 'Kolibri catalog app kolibri-1.0 is missing.';

export interface LessonInstall {
  appId: typeof KOLIBRI_LESSON_APP_ID;
  instanceName: string;
  /** Expected instanceOf after install. Recorded here; not a pre-click gate. */
  instanceOf: string;
  /** Expected x-app.version after install. Not a pre-click gate. */
  version: string;
}

const EM = '\u2014';

const LESSON_DISKS: {
  id: string;
  names: string[];
  instanceName: string;
  instanceOf: string;
  version: string;
}[] = [
  {
    id: 'duration-kolibri-grade5a-001',
    names: [`Duration Tests ${EM} Kolibri Grade 5A`, 'Duration Tests - Kolibri Grade 5A'],
    instanceName: 'kolibri-grade5a-001',
    instanceOf: 'kolibri-1.0-duration',
    version: '1.0-duration',
  },
  {
    id: 'duration-kolibri-form3-001',
    names: [`Duration Tests ${EM} Kolibri Form 3`, 'Duration Tests - Kolibri Form 3'],
    instanceName: 'kolibri-form3-001',
    instanceOf: 'kolibri-1.0-duration-form3',
    version: '1.0-duration-form3',
  },
];

/** Fold em/en dashes so a hyphen vs em-dash name still matches. */
function foldLabel(value: string): string {
  return value
    .trim()
    .replace(/[\u2012\u2013\u2014\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Match disk.id or visible disk.name (id string or Kid's display title). */
export function lessonInstallForDisk(disk: { id: string; name: string }): LessonInstall | null {
  const id = disk.id.trim();
  const name = foldLabel(disk.name);
  const row = LESSON_DISKS.find((r) => {
    if (r.id === id || foldLabel(r.id) === name) return true;
    return r.names.some((n) => foldLabel(n) === name);
  });
  if (!row) return null;
  return {
    appId: KOLIBRI_LESSON_APP_ID,
    instanceName: row.instanceName,
    instanceOf: row.instanceOf,
    version: row.version,
  };
}

/** True when an instance with that name is already stored on this disk id. */
export function lessonInstanceStoredOnDisk(
  instances: Record<string, { name?: string; storedOn?: string | null } | undefined>,
  diskId: string,
  instanceName: string,
): boolean {
  return Object.values(instances).some(
    (inst) => !!inst && inst.name === instanceName && inst.storedOn === diskId,
  );
}

/** Missing catalog entry blocks. A different x-app.version does not. */
export function kolibriLessonCatalogOk(
  app: { version?: string } | null | undefined,
): boolean {
  return app != null;
}
