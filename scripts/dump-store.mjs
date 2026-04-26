import { Repo } from '@automerge/automerge-repo';
import { WebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket';

const STORE_URL = 'automerge:4GQmEZehPDfryGDxkFo9XixbvmAC';
const WS_URL = 'ws://192.168.0.231:4321';

const repo = new Repo({
  network: [new WebSocketClientAdapter(WS_URL)],
  sharePolicy: async () => true,
});

const handle = await repo.find(STORE_URL);
await new Promise(r => setTimeout(r, 2000));

// Remove TEST_COMMAND from wizardly-hugle
handle.change((d) => {
  const engine = d.engineDB?.['ENGINE_AA000000000000000724'];
  if (engine?.commands) {
    const idx = engine.commands.indexOf('TEST_COMMAND');
    if (idx !== -1) {
      engine.commands.splice(idx, 1);
      console.log('Removed TEST_COMMAND');
    }
  }
});

await new Promise(r => setTimeout(r, 500));
process.exit(0);
