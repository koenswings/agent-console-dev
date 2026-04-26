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

// Command queues
console.log('=== command queues ===');
for (const [id, e] of Object.entries(doc.engineDB ?? {})) {
  const cmds = e.commands ?? [];
  console.log(`  ${String(e.hostname)}: ${cmds.length ? JSON.stringify(cmds) : '(empty)'}`);
}

// Operations
const ops = Object.values(doc.operationDB ?? {});
console.log(`\n=== operationDB (${ops.length}) ===`);
for (const op of ops) {
  console.log(`  ${String(op.kind)} status=${String(op.status)} progress=${op.progressPercent ?? 0}% error=${op.error ?? '-'}`);
  console.log(`  args: ${JSON.stringify(op.args)}`);
}

// Source disk of the kolibri-on-idea01 instance
const instances = doc.instanceDB ?? {};
console.log('\n=== instances ===');
for (const [id, inst] of Object.entries(instances)) {
  const disk = inst?.storedOn ? doc.diskDB?.[String(inst.storedOn)] : null;
  const eng = disk?.dockedTo ? doc.engineDB?.[String(disk.dockedTo)] : null;
  console.log(`  ${String(inst?.name)}: storedOn=${String(inst?.storedOn)} engine=${String(eng?.hostname ?? 'none')}`);
}

process.exit(0);
