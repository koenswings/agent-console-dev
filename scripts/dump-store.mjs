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

const ops = Object.values(doc.operationDB ?? {});
console.log(`operationDB (${ops.length}):`);
for (const op of ops) {
  console.log(`  kind=${String(op.kind)} status=${String(op.status)} progress=${op.progressPercent ?? 0}%`);
  if (op.error) console.log(`  error: ${String(op.error)}`);
  if (op.args) console.log(`  args: ${JSON.stringify(op.args)}`);
}

// instances on idea01 now?
const idea01 = Object.entries(doc.engineDB ?? {}).find(([,e]) => e.hostname === 'idea01');
if (idea01) {
  const [engineId] = idea01;
  const diskIds = new Set(Object.values(doc.diskDB ?? {}).filter(d => String(d.dockedTo) === engineId).map(d => String(d.id)));
  const instances = Object.values(doc.instanceDB ?? {}).filter(i => diskIds.has(String(i.storedOn)));
  console.log(`\nidea01 instances: ${instances.map(i => String(i.name)).join(', ') || 'none'}`);
}

process.exit(0);
