/**
 * Real teacher-lesson install: catalog app kolibri-1.0 onto the two docked
 * fixture disks. Replaces the demo store's fake Kolibri on DISK001.
 * Lesson content is a channel already on those disks, not another catalog app.
 */
export const KOLIBRI_LESSON_APP_ID = 'kolibri-1.0' as const;
export const KOLIBRI_LESSON_VERSION = '1.0' as const;
export const KOLIBRI_CATALOG_ERROR =
  'Kolibri catalog app kolibri-1.0 is missing or is not version 1.0.';

export interface LessonInstall {
  appId: typeof KOLIBRI_LESSON_APP_ID;
  instanceName: string;
  version: typeof KOLIBRI_LESSON_VERSION;
}

const LESSON_DISKS: { label: string; instanceName: string }[] = [
  { label: 'duration-kolibri-grade5a-001', instanceName: 'kolibri-grade5a-001' },
  { label: 'duration-kolibri-form3-001', instanceName: 'kolibri-form3-001' },
];

/** Match disk.id or disk.name to a lesson fixture label. */
export function lessonInstallForDisk(disk: { id: string; name: string }): LessonInstall | null {
  const row = LESSON_DISKS.find((r) => r.label === disk.id || r.label === disk.name);
  if (!row) return null;
  return {
    appId: KOLIBRI_LESSON_APP_ID,
    instanceName: row.instanceName,
    version: KOLIBRI_LESSON_VERSION,
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

export function kolibriLessonCatalogOk(
  app: { version?: string } | null | undefined,
): boolean {
  return !!app && app.version === KOLIBRI_LESSON_VERSION;
}
