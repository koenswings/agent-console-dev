/**
 * CommandFeedback — shows the Engine's answer to a command this panel sent
 * (r29@97 forensics: a restore the Engine refused with "Too many arguments"
 * left no trace in the UI). Same look as the existing eject / Files / Backup
 * Disk results: an `edp-form__error` alert with the Engine's error trace
 * message, or an `edp-form__hint` status when the Engine never answered.
 * Pending and success render nothing; the panel's own progress UI covers them.
 *
 * Cross-engine commands (remoteConfirm.ts) show a neutral `edp-form__hint`
 * "Sent to <engine>, waiting for confirmation" until the store or the target's
 * log confirms, and turn red only on a real error or after the long timeout.
 */
import { Show, type Accessor, type Component } from 'solid-js';
import type { CommandResult } from '../store/commandResult';

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
};

export const commandVerb = (command: string | null): string =>
  (command && COMMAND_VERBS[command]) || command || 'run the command for';

interface CommandFeedbackProps {
  result: CommandResult;
  /** What the command acted on (instance name, engine hostname, …). */
  subject: Accessor<string>;
  /** data-testid prefix: renders `<prefix>-error` / `<prefix>-timeout`. */
  testId: string;
}

const CommandFeedback: Component<CommandFeedbackProps> = (props) => {
  const errorMessage = () => {
    const s = props.result.state();
    return s.kind === 'error' ? s.message : null;
  };
  const sentTo = () => {
    const s = props.result.state();
    return s.kind === 'sent' ? s.engine : null;
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
            Couldn't {commandVerb(props.result.command())} {props.subject()}: {msg()}
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
