// Test-only stand-in for 'isomorphic-ws' (vitest.config.ts alias): the adapter
// gets whatever globalThis.WebSocket is at dial time, so a test can install a
// mock socket. Outside such a test this is jsdom's WebSocket.
const IsoWebSocket = function IsoWebSocket(this: unknown, url: string) {
  return new (globalThis.WebSocket as unknown as new (u: string) => object)(url);
} as unknown as { OPEN: number; CONNECTING: number; CLOSING: number; CLOSED: number };
IsoWebSocket.CONNECTING = 0; IsoWebSocket.OPEN = 1; IsoWebSocket.CLOSING = 2; IsoWebSocket.CLOSED = 3;
export default IsoWebSocket;
