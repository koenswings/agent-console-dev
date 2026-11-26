/** Plain text for a command that was not accepted (agent-engine-dev#582). */
import type { SendResult } from './signedCommand';

export const sendResultMessage = (r: SendResult): string => {
  switch (r.kind) {
    case 'accepted':
      return '';
    case 'cancelled':
      return 'Cancelled.';
    case 'blocked':
      return r.message;
    case 'signInRequired':
      return 'Your session ended. Sign in again.';
    case 'error':
      return r.message;
  }
};
