import '@testing-library/jest-dom';

// Cross-engine feedback (connectedEngine.ts): like the demo connection, tests
// run "connected to" ENGINE_1 (hostname appdocker01). Commands to other
// Engines take the cross-engine path; tests for it set this explicitly.
import { beforeEach } from 'vitest';
import { resetConnectedEngine, setConnectedEngineHost } from '../src/store/connectedEngine';
import { setRemoteCommandLogFn } from '../src/store/remoteCommandLogs';
beforeEach(() => {
  resetConnectedEngine();
  setConnectedEngineHost('appdocker01');
  setRemoteCommandLogFn(() => null);
});
