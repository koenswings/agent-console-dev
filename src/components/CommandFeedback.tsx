/**
 * CommandFeedback — shows the Engine's answer to a command this panel sent
 * (r29@97 forensics: a restore the Engine refused with "Too many arguments"
 * left no trace in the UI). Same look as the existing eject / Files / Backup
 * Disk results: an `edp-form__error` alert with the Engine's error trace
 * message, or an `edp-form__hint` status when the Engine never answered.
 * Pending and success render nothing; the panel's own progress UI covers them.
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
  return (
    <>
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
