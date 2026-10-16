// Probe: which public Nostr relays take and give back OSAP sync events (kind 30078) from a fresh key. Not part of the app.
import { createRequire } from "node:module";
const C = createRequire(import.meta.url)("../../assets/osap-sync.js");
const RELAYS = ["wss://nos.lol", "wss://relay.damus.io", "wss://relay.primal.net", "wss://nostr.mom", "wss://offchain.pub", "wss://relay.nostr.band", "wss://relay.snort.social", "wss://nostr-pub.wellorder.net", "wss://relay.nostr.bg", "wss://nostr.oxtr.dev", "wss://relay.mostr.pub", "wss://nostr.bitcoiner.social", "wss://relay.nostr.net", "wss://nostr.land"];
const K = await C.keys(C.newCode());
function once(url, fn, ms = 12000) { return new Promise((res) => { let ws, done = false; const end = (v) => { if (done) return; done = true; clearTimeout(t); try { ws.close(); } catch {} res(v); }; const t = setTimeout(() => end({ err: "timeout" }), ms); try { ws = new WebSocket(url); } catch (e) { end({ err: String(e) }); return; } ws.onerror = () => end({ err: "socket error" }); fn(ws, end); }); }
async function pub(url, ev) { return once(url, (ws, end) => { ws.onopen = () => ws.send(JSON.stringify(["EVENT", ev])); ws.onmessage = (m) => { const a = JSON.parse(m.data); if (a[0] === "OK") end({ ok: a[2], msg: a[3] }); else if (a[0] === "NOTICE") end({ ok: false, msg: "NOTICE " + a[1] }); }; }); }
async function get(url, d) { return once(url, (ws, end) => { const got = []; ws.onopen = () => ws.send(JSON.stringify(["REQ", "p", { kinds: [30078], authors: [K.pk] }])); ws.onmessage = (m) => { const a = JSON.parse(m.data); if (a[0] === "EVENT") got.push(a[2]); else if (a[0] === "EOSE" || a[0] === "CLOSED") end({ n: got.length, ds: got.map((e) => e.tags[0][1]), closed: a[0] === "CLOSED" ? a[2] : "" }); }; }); }
async function info(url) { try { const r = await fetch(url.replace("wss://", "https://"), { headers: { Accept: "application/nostr+json" }, signal: AbortSignal.timeout(8000) }); const j = await r.json(); return { name: j.name, limit: j.limitation || null, nips: (j.supported_nips || []).includes(78) }; } catch (e) { return { err: String(e).slice(0, 80) }; } }
const at = Math.floor(Date.now() / 1000);
for (const url of RELAYS) {
  const row = { url, info: await info(url) };
  for (const kb of [20, 100]) {
    const d = await C.dtag(K, "probe/" + kb), content = await C.seal(K, d, { type: "bucket", v: 1, u: { pad: Array.from({ length: kb * 20 }, () => Buffer.from(crypto.getRandomValues(new Uint8Array(48))).toString("base64")).join("") } });
    const ev = await C.event(K, d, content, at);
    row["pub" + kb] = { bytes: content.length, ...(await pub(url, ev)) };
  }
  await new Promise((r) => setTimeout(r, 1500));
  row.get = await get(url);
  // replace: a newer event under the same name should replace the older
  const d = await C.dtag(K, "probe/20"), ev2 = await C.event(K, d, await C.seal(K, d, { type: "bucket", v: 1, u: { x: 2 } }), at + 5);
  row.replace = await pub(url, ev2);
  await new Promise((r) => setTimeout(r, 1500));
  row.get2 = await get(url);
  console.log(JSON.stringify(row));
}
