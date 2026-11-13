/**
 * Title and subtitle for an instance on the Apps cards and the mobile list
 * (idea#190 item 2).
 *
 * The display name is `Instance.name` (the same field rename edits). The app
 * name shown as a subtitle is `App.title`. When the stored name is not a real
 * display name, the card falls back to `app.title` and has no subtitle, so a
 * Console-installed app never shows an id as its title.
 *
 * A name is treated as a placeholder when it is:
 *   - empty or blank
 *   - equal to the instance id
 *   - a generated instance id: `{appName}-{19 lowercase base-36 chars}`
 *     from Engine `createInstanceId` in `src/data/Instance.ts`
 *     (`appName + "-" + uuid()`), where `uuid()` is
 *     `secureRandomString(SECRET_ID_LENGTH)` and `SECRET_ID_LENGTH` is 19
 *     and `SECRET_ID_ALPHABET` is `0-9a-z` (agent-engine-dev/src/utils/utils.ts,
 *     idea#114). The idea docs describe the same shape: `{appName}-{uuid}`
 *     (for example `kolibri-3f2a…`) in
 *     `proposals/2026-11-09-field-usage-monitoring.md`.
 *   - equal to the app id, which is the Engine default when `installApp` is
 *     sent without `--name` (InstallApp.ts: "defaults to appId"; COMMANDS.md).
 *     The Console's EmptyDiskPanel omits `--name` except for the named
 *     Kolibri lesson instances.
 *
 * Teacher names such as "Grade 5A and Form 3" or "Kolibri Form 3", and
 * Console lesson names such as "kolibri-grade5a-001", do not match.
 */
import type { App, Instance } from '../types/store';

/** Engine `SECRET_ID_LENGTH` (agent-engine-dev/src/utils/utils.ts). */
export const GENERATED_ID_SUFFIX_LENGTH = 19;

/** Engine `SECRET_ID_ALPHABET`: 19 lowercase base-36 characters. */
const GENERATED_ID_SUFFIX = /^[0-9a-z]{19}$/;

/** App slug plus a hyphen, then the 19-character suffix (hyphens allowed in the slug). */
const GENERATED_ID_WITHOUT_APP = /^(?:[a-z][a-z0-9]*)(?:-[a-z0-9]+)*-[0-9a-z]{19}$/;

export interface InstanceCardTitle {
  title: string;
  subtitle: string | null;
}

const trimmed = (value: string | undefined | null): string => String(value ?? '').trim();

/** True when `name` is `{appName}-{19 lowercase base-36}`, the Engine's createInstanceId form. */
export const isGeneratedInstanceIdName = (name: string, appName?: string | null): boolean => {
  if (!name) return false;
  if (appName) {
    const prefix = `${appName}-`;
    return name.startsWith(prefix) && GENERATED_ID_SUFFIX.test(name.slice(prefix.length));
  }
  return GENERATED_ID_WITHOUT_APP.test(name);
};

/**
 * Pure: the title and optional app-name subtitle for an instance card.
 */
export const instanceCardTitle = (
  inst: Pick<Instance, 'id' | 'name' | 'instanceOf'> | undefined,
  app: Pick<App, 'id' | 'name' | 'title'> | undefined,
): InstanceCardTitle => {
  const name = trimmed(inst?.name);
  const appTitle = trimmed(app?.title);
  const fallbackTitle = appTitle || trimmed(app?.name) || trimmed(inst?.instanceOf) || name;
  const isPlaceholder = !name
    || (!!inst?.id && name === inst.id)
    || (!!app?.id && name === app.id)
    || isGeneratedInstanceIdName(name, app?.name);

  if (!isPlaceholder) {
    const subtitle = appTitle && appTitle !== name ? appTitle : null;
    return { title: name, subtitle };
  }
  return { title: fallbackTitle, subtitle: null };
};
