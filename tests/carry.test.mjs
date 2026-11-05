// The merge of saved work carried from the old address (assets/osap-carry.js core): nothing replaced wholesale, an item
// already here stays as it is here, old items not here are added, workspaces of the same name merge, others are added,
// stores outside OSAP's families and device-only stores (sign-in, lock, sync) never come in.
// Run from the repo root: node tests/carry.test.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const C = require("../assets/osap-carry.js");
let fails = 0;
function ok(c, m, x) { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x))); if (!c) fails++; }
function store(init) {
  const m = new Map(Object.entries(init || {}));
  return { m, get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) };
}
const J = JSON.stringify, P = (s) => JSON.parse(s);

// picked: OSAP families only, and never the device's own sign-in, lock, sync or the hand-off's own marks
ok(C.picked("osap-atak-pts") && C.picked("asap-area-th") && C.picked("osap-ws-data-ws-abc12"), "saved-work stores travel");
ok(!C.picked("osap-auth") && !C.picked("osap-vault") && !C.picked("osap-sync") && !C.picked("osap-team") && !C.picked("osap-carry-done") && !C.picked("evil") && !C.picked("asap-xrecs-th"),
  "sign-in, lock, sync, team, the hand-off's marks, caches and foreign keys never travel");

// one store: list by id, this device's copy wins a clash
let r = C.mergeStore(J([{ id: "a", n: "here" }, { id: "b" }]), J([{ id: "a", n: "old" }, { id: "c" }]));
ok(J(P(r.text)) === J([{ id: "a", n: "here" }, { id: "b" }, { id: "c" }]) && r.added === 1, "points: same id kept as here, new id added, no duplicate", P(r.text));
r = C.mergeStore(J([{ id: "a" }]), J([{ id: "a" }]));
ok(r.added === 0, "identical item: nothing added");
r = C.mergeStore(J([[1, 2], [3, 4], [5, 6]]), J([[9, 9], [8, 8], [7, 7]]));
ok(J(P(r.text)) === J([[1, 2], [3, 4], [5, 6]]), "drawn area (list without ids): this device's shape kept whole, never mixed");
r = C.mergeStore(J([]), J([[9, 9], [8, 8], [7, 7]]));
ok(P(r.text).length === 3, "empty list here: the old one comes across");
r = C.mergeStore(J({ folders: [{ id: "f1", name: "Here" }], of: { "pt:1": "f1" }, open: {} }), J({ folders: [{ id: "f1", name: "Old" }, { id: "f2", name: "Trip" }], of: { "pt:1": "f2", "pt:9": "f2" } }));
const pl = P(r.text);
ok(pl.folders.length === 2 && pl.folders[0].name === "Here" && pl.of["pt:1"] === "f1" && pl.of["pt:9"] === "f2", "My places folders: merged by id and key, this device's filing kept", pl);
r = C.mergeStore(J({ units: "metric" }), J({ units: "imperial", grid: "mgrs" }));
ok(P(r.text).units === "metric" && P(r.text).grid === "mgrs", "settings: this device's values stay, missing ones added");
r = C.mergeStore(null, J([{ id: "a" }]));
ok(r.text === J([{ id: "a" }]), "store missing here: comes across as it is");
r = C.mergeStore("not json", J([{ id: "a" }]));
ok(r.text === "not json" && r.added === 0, "unreadable store here: left alone");

// whole merge, this device has no workspaces yet (a new browser): old register and packed workspaces come as they are
const OLD = {
  "osap-ws": J({ v: 1, list: [{ id: "ws-aaaa1", name: "Default", created: 1 }, { id: "ws-bbbb2", name: "Trip", created: 2 }], active: "ws-aaaa1" }),
  "osap-ws-data-ws-bbbb2": J({ v: 1, keys: { "osap-atak-pts": J([{ id: "t1" }]) } }),
  "osap-atak-pts": J([{ id: "p1", name: "Embassy" }, { id: "p2", name: "Hotel" }]),
  "osap-routes": J([{ id: "r1" }]),
  "asap-area-th": J([[1, 2], [3, 4], [5, 6]]),
  "osap-settings-x": J({ a: 1 }),
  "osap-auth": J({ access_token: "stolen" }),
  "evil-key": "x",
};
let L = store({});
C.mergeAll(OLD, L);
ok(P(L.get("osap-atak-pts")).length === 2 && L.get("osap-routes") && L.get("asap-area-th"), "new browser: points, routes and areas arrive");
ok(P(L.get("osap-ws")).list.length === 2 && P(L.get("osap-ws")).active === "ws-aaaa1" && L.get("osap-ws-data-ws-bbbb2"), "new browser: both workspaces arrive");
ok(L.get("osap-auth") == null && L.get("evil-key") == null, "sign-in token and foreign keys never written");

// whole merge into a device that already has its own Default workspace and items
L = store({
  "osap-ws": J({ v: 1, list: [{ id: "ws-zzzz9", name: "Default", created: 5 }], active: "ws-zzzz9" }),
  "osap-atak-pts": J([{ id: "p1", name: "Embassy (moved)" }, { id: "n1", name: "New here" }]),
  "osap-settings-x": J({ a: 2 }),
});
C.mergeAll(OLD, L);
let pts = P(L.get("osap-atak-pts"));
ok(pts.length === 3 && pts.find((x) => x.id === "p1").name === "Embassy (moved)" && pts.find((x) => x.id === "p2") && pts.find((x) => x.id === "n1"), "Default merges into Default: 3 points, this device's edit kept", pts.map((x) => x.id));
let reg = P(L.get("osap-ws"));
ok(reg.list.length === 2 && reg.active === "ws-zzzz9" && reg.list[1].name === "Trip", "Trip workspace added beside this device's Default, the open workspace unchanged", reg.list.map((w) => w.name));
ok(P(P(L.get("osap-ws-data-" + reg.list[1].id)).keys["osap-atak-pts"])[0].id === "t1", "Trip's own points kept in its packed copy");
ok(P(L.get("osap-settings-x")).a === 2, "settings outside workspaces: this device's value stays");
// carrying the same set twice changes nothing more (no duplicates)
const snap = J([...L.m.entries()].sort());
C.mergeAll(OLD, L);
ok(J([...L.m.entries()].sort()) === snap, "the same set brought twice: nothing changes the second time");

// a workspace of the same name that is not open here merges into its packed copy
L = store({
  "osap-ws": J({ v: 1, list: [{ id: "ws-zzzz9", name: "Default" }, { id: "ws-yyyy8", name: "trip" }], active: "ws-zzzz9" }),
  "osap-ws-data-ws-yyyy8": J({ v: 1, keys: { "osap-atak-pts": J([{ id: "y1" }]) } }),
});
C.mergeAll(OLD, L);
reg = P(L.get("osap-ws"));
const tp = P(P(L.get("osap-ws-data-ws-yyyy8")).keys["osap-atak-pts"]).map((x) => x.id);
ok(reg.list.length === 2 && tp.join() === "y1,t1", "Trip merges into this device's packed trip (name case ignored)", tp);

// describe
ok(C.describe(OLD, 1) === "2 map points, 1 photo, 1 route, 1 drawn area, 2 workspaces", "plain summary", C.describe(OLD, 1));

// which page hands work on, and where (2026-11-05, the move to the company address)
const HOME = "https://osap.axiom-inteligence-systems.com/";
ok(J(C.role("01shane89-jpg.github.io", "https://01shane89-jpg.github.io/", "")) === J({ tag: "g", at: C.OLD, to: C.NEW }), "github.io hands on to netlify.app, as before");
ok(J(C.role("axiom-osap.netlify.app", C.NEW, HOME)) === J({ tag: "n", at: C.NEW, to: HOME }), "the stand-in on netlify.app hands on to the company address");
ok(C.role("axiom-osap.netlify.app", C.NEW, "") === null, "the app on netlify.app (no meta) never sends anyone anywhere");
ok(C.role("osap.axiom-inteligence-systems.com", HOME, "") === null, "the app on the company address never sends");
ok(C.role("axiom-osap.netlify.app", C.NEW, "https://evil.example/") === null, "a page naming an address that is not a target: nothing sent");
ok(C.role("deploy-preview-9--axiom-osap.netlify.app", "https://deploy-preview-9--axiom-osap.netlify.app/", HOME) === null, "an address not in the list: nothing sent");
ok(C.role("axiom-osap.netlify.app", C.NEW, C.NEW) === null, "never hands on to itself");
ok(C.originOf("https://axiom-osap.netlify.app/x?y") === "https://axiom-osap.netlify.app" && C.originOf("http://axiom-osap.netlify.app/") === "" && C.originOf("") === "", "origins: https only");

console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
