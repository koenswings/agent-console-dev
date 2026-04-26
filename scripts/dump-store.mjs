import { Repo } from '@automerge/automerge-repo';
import { WebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket';

const STORE_URL = 'automerge:4GQmEZehPDfryGDxkFo9XixbvmAC';
const WS_URL = 'ws://192.168.0.231:4321';

const adapter = new WebSocketClientAdapter(WS_URL);
const repo = new Repo({ network: [adapter], sharePolicy: async () => true });

const handle = await repo.find(STORE_URL);
await new Promise(r => setTimeout(r, 2000)); // let sync complete

const doc = handle.doc();

// Focus on the wizardly-hugle engine and its disk
const engineId = 'ENGINE_AA000000000000000724';
const diskId = 'AA000000000000000724';

const engine = doc.engineDB[engineId];
const disk = doc.diskDB[diskId];

console.log('=== ENGINE ===');
console.log('engineId key type:', typeof engineId);
console.log('engine.hostname:', String(engine?.hostname));
console.log('engine.name:', String(engine?.name));

console.log('\n=== DISK ===');
console.log('disk.name:', String(disk?.name));
console.log('disk.dockedTo raw:', disk?.dockedTo);
console.log('disk.dockedTo type:', typeof disk?.dockedTo);
console.log('disk.dockedTo String():', String(disk?.dockedTo));
console.log('disk.dockedTo === engineId:', disk?.dockedTo === engineId);
console.log('String(disk.dockedTo) === engineId:', String(disk?.dockedTo) === engineId);

console.log('\n=== INSTANCES on this disk ===');
const instances = doc.instanceDB ?? {};
for (const [id, inst] of Object.entries(instances)) {
  const storedOn = inst?.storedOn;
  console.log(`${id}: storedOn raw=${storedOn} type=${typeof storedOn} String=${String(storedOn)} === diskId: ${String(storedOn) === diskId} raw===: ${storedOn === diskId}`);
}

process.exit(0);
