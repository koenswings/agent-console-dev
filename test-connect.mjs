import { Repo } from "@automerge/automerge-repo";
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";

const WS_URL = "ws://127.0.0.1:4321";
const STORE_URL = "automerge:4GQmEZehPDfryGDxkFo9XixbvmAC";

console.log(`Connecting to ${WS_URL}...`);
const adapter = new BrowserWebSocketClientAdapter(WS_URL);
const repo = new Repo({ network: [adapter] });

console.log(`Finding document ${STORE_URL}...`);

// In 2.3.0-alpha, repo.find() returns a Promise<DocHandle>
const handle = await repo.find(STORE_URL);
console.log("handle state:", handle.state);
console.log("handle methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(handle)).slice(0,8));

const timeout = setTimeout(() => {
  console.log("TIMEOUT — handle state:", handle.state);
  process.exit(1);
}, 12000);

try {
  await handle.whenReady();
  clearTimeout(timeout);
  const doc = handle.doc();
  console.log("SUCCESS — state:", handle.state);
  console.log("doc keys:", doc ? Object.keys(doc) : "null");
  if (doc?.engineDB) console.log("engineDB:", Object.keys(doc.engineDB));
  process.exit(0);
} catch(e) {
  clearTimeout(timeout);
  console.error("ERROR:", e.message);
  process.exit(1);
}
