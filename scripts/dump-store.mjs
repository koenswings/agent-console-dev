import { Repo } from '@automerge/automerge-repo';
import { WebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket';

const STORE_URL = 'automerge:4GQmEZehPDfryGDxkFo9XixbvmAC';
const WS_URL = 'ws://192.168.0.231:4321';

const handle = await new Repo({
  network: [new WebSocketClientAdapter(WS_URL)],
  sharePolicy: async () => true,
}).find(STORE_URL);

await new Promise(r => setTimeout(r, 2000));
const doc = handle.doc();

// Full disk dump with diskTypes
const disks = doc.diskDB ?? {};
console.log('=== DISKS (docked only) ===');
for (const [id, d] of Object.entries(disks)) {
  if (!d?.dockedTo) continue;
  console.log(`  ${id}: name=${String(d.name)} dockedTo=${String(d.dockedTo)} diskTypes=${JSON.stringify(d.diskTypes)} device=${String(d.device)}`);
}

// Instances
const instances = doc.instanceDB ?? {};
console.log('\n=== INSTANCES ===');
for (const [id, inst] of Object.entries(instances)) {
  console.log(`  ${id}: name=${String(inst?.name)} storedOn=${String(inst?.storedOn)}`);
}

process.exit(0);
