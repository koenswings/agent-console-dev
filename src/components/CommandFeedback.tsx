/**
 * CommandFeedback — shows the Engine's answer to a command this panel sent
 * (r29@97 forensics: a restore the Engine refused with "Too many arguments"
 * left no trace in the UI). Same look as the existing eject / Files / Backup
 * Disk results: an `edp-form__error` alert with the Engine's error trace
 * message, or an `edp-form__hint` status when the Engine never answered.
 * Pending and success render nothing; the panel's own progress UI covers them.
 * A `warning` state (finished, but not as asked) is an amber `edp-form__hint`.
 *
 * Cross-engine commands (remoteConfirm.ts) show a neutral `edp-form__hint`
 * "Sent to <engine>, waiting for confirmation" until the store or the target's
 * log confirms, and turn red only on a real error or after the long timeout.
 */
import { Show, type Accessor, type Component } from 'solid-js';
import type { CommandResult } from '../store/commandResult';
import { plainEngineText } from '../store/plainError';

/** Verb per Engine command, for "Couldn't <verb> <subject>: <message>". */
export const COMMAND_VERBS: Record<string, string> = {
  startInstance: 'start',
  stopInstance: 'stop',
  backupApp: 'back up',
  restoreApp: 'restore',
  copyApp: 'copy',
  moveApp: 'move',
  installApp: 'install',
  ejectDisk: 'eject',
  cancelOperation: 'cancel',
  reboot: 'reboot',
  // idea#201 §10
  flashCard: 'flash',
  initialiseDisk: 'initialise',
  cancelFlash: 'cancel the flash of',
  // agent-engine-dev#220
  renameInstance: 'rename',
  // idea#347
  removeInstance: 'remove',
  // idea#76 and the disk adapters
  updateApp: 'update',
  upgradeEngine: 'update',
  eraseDisk: 'erase',
  createFilesDisk: 'set up',
  createBackupDisk: 'set up',
  // idea#400 / Engine f114a28
  setBackupMode: 'change the backup settings of',
  // idea#235 / engine#369
  setupDemo: 'set up demo apps on',
  removeDemo: 'remove demo apps from',
};

export const commandVerb = (command: string | null): string =>
  (command && COMMAND_VERBS[command]) || 'finish this for'; // never the raw command name (idea#76)

interface CommandFeedbackProps {
  result: CommandResult;
  /** What the command acted on (instance name, engine hostname, …). */
  subject: Accessor<string>;
  /** data-testid prefix: renders `<prefix>-error` / `<prefix>-timeout`. */
  testId: string;
  /** Optional: turn the Engine's raw error (refusal code) into a plain sentence. */
  formatError?: (message: string) => string;
  /** Optional: a complete sentence for this error (replaces "Couldn't <verb> <subject>: …"); null = default line. */
  formatLine?: (message: string, code: string | null) => string | null;
  /** Optional: hide the "Sent to …, waiting for confirmation" line (the caller shows progress instead). */
  hideSent?: Accessor<boolean>;
  /** Optional: the warning sentence, re-read while rendering (moveApp: follows the newest op, engine#395); null = the message. */
  formatWarning?: (message: string, code: string | null) => string | null;
  /** Optional: hide the warning line (the caller shows the same outcome itself). */
  hideWarning?: Accessor<boolean>;
}

const CommandFeedback: Component<CommandFeedbackProps> = (props) => {
  const errorMessage = () => {
    const s = props.result.state();
    return s.kind === 'error' ? plainEngineText(props.formatError ? props.formatError(s.message) : s.message) : null;
  };
  // A finished command that did not do what was asked (moveApp SOURCE_CHANGED, engine#388): a plain sentence, amber.
  const warning = () => {
    const s = props.result.state();
    if (s.kind !== 'warning' || props.hideWarning?.()) return null;
    return props.formatWarning?.(s.message, s.code ?? null) ?? plainEngineText(s.message);
  };
  const sentTo = () => {
    const s = props.result.state();
    return s.kind === 'sent' && !props.hideSent?.() ? s.engine : null;
  };
  return (
    <>
      <Show when={sentTo()}>
        {(engine) => (
          <p
            class="edp-form__hint command-feedback--sent"
            role="status"
            data-testid={`${props.testId}-sent`}
            data-command={props.result.command() ?? ''}
          >
            Sent to {engine()}, waiting for confirmation…
          </p>
        )}
      </Show>
      <Show when={errorMessage()}>
        {(msg) => (
          <p
            class="edp-form__error"
            role="alert"
            data-testid={`${props.testId}-error`}
            data-command={props.result.command() ?? ''}
          >
            {(() => {
              const raw = props.result.state();
              const line = raw.kind === 'error' && props.formatLine ? props.formatLine(raw.message, raw.code ?? null) : null;
              return line ?? `Couldn't ${commandVerb(props.result.command())} ${props.subject()}: ${msg()}`;
            })()}
          </p>
        )}
      </Show>
      <Show when={warning()}>
        {(msg) => (
          <p
            class="edp-form__hint command-feedback--warning"
            role="alert"
            data-testid={`${props.testId}-warning`}
            data-command={props.result.command() ?? ''}
          >
            {msg()}
          </p>
        )}
      </Show>
      <Show when={props.result.state().kind === 'timeout'}>
        <p
          class="edp-form__hint"
          role="status"
          data-testid={`${props.testId}-timeout`}
          data-command={props.result.command() ?? ''}
        >
          No response from the Engine to {commandVerb(props.result.command())} {props.subject()}. Check History for details.
        </p>
      </Show>
    </>
  );
};

export default CommandFeedback;
