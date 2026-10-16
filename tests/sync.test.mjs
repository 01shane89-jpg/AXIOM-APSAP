// Sync my devices (assets/osap-sync.js) core: BIP-340 signing against the official test vectors (bitcoin/bips bip-0340/test-vectors.csv),
// sync codes, sealing, cutting stores into units and putting them back, and the merge (newest change per item wins, deletes stay,
// a joining device's clashes lose, hidden "us" items never leave the device). Run: node tests/sync.test.mjs
import { createRequire } from "node:module";
const C = createRequire(import.meta.url)("../assets/osap-sync.js");
let fails = 0;
function ok(c, m, x) { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x))); if (!c) fails++; }
const VEC = [["0", "0000000000000000000000000000000000000000000000000000000000000003", "F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9", "0000000000000000000000000000000000000000000000000000000000000000", "0000000000000000000000000000000000000000000000000000000000000000", "E907831F80848D1069A5371B402410364BDF1C5F8307B0084C55F1CE2DCA821525F66A4A85EA8B71E482A74F382D2CE5EBEEE8FDB2172F477DF4900D310536C0"], ["1", "B7E151628AED2A6ABF7158809CF4F3C762E7160F38B4DA56A784D9045190CFEF", "DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659", "0000000000000000000000000000000000000000000000000000000000000001", "243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89", "6896BD60EEAE296DB48A229FF71DFE071BDE413E6D43F917DC8DCF8C78DE33418906D11AC976ABCCB20B091292BFF4EA897EFCB639EA871CFA95F6DE339E4B0A"], ["2", "C90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B14E5C9", "DD308AFEC5777E13121FA72B9CC1B7CC0139715309B086C960E18FD969774EB8", "C87AA53824B4D7AE2EB035A2B5BBBCCC080E76CDC6D1692C4B0B62D798E6D906", "7E2D58D8B3BCDF1ABADEC7829054F90DDA9805AAB56C77333024B9D0A508B75C", "5831AAEED7B44BB74E5EAB94BA9D4294C49BCF2A60728D8B4C200F50DD313C1BAB745879A5AD954A72C45A91C3A51D3C7ADEA98D82F8481E0E1E03674A6F3FB7"], ["3", "0B432B2677937381AEF05BB02A66ECD012773062CF3FA2549E44F58ED2401710", "25D1DFF95105F5253C4022F628A996AD3A0D95FBF21D468A1B33F8C160D8F517", "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF", "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF", "7EB0509757E246F19449885651611CB965ECC1A187DD51B64FDA1EDC9637D5EC97582B9CB13DB3933705B32BA982AF5AF25FD78881EBB32771FC5922EFC66EA3"], ["15", "0340034003400340034003400340034003400340034003400340034003400340", "778CAA53B4393AC467774D09497A87224BF9FAB6F6E68B23086497324D6FD117", "0000000000000000000000000000000000000000000000000000000000000000", "", "71535DB165ECD9FBBC046E5FFAEA61186BB6AD436732FCCC25291A55895464CF6069CE26BF03466228F19A3A62DB8A649F2D560FAC652827D1AF0574E427AB63"], ["16", "0340034003400340034003400340034003400340034003400340034003400340", "778CAA53B4393AC467774D09497A87224BF9FAB6F6E68B23086497324D6FD117", "0000000000000000000000000000000000000000000000000000000000000000", "11", "08A20A0AFEF64124649232E0693C583AB1B9934AE63B4C3511F3AE1134C6A303EA3173BFEA6683BD101FA5AA5DBC1996FE7CACFC5A577D33EC14564CEC2BACBF"], ["17", "0340034003400340034003400340034003400340034003400340034003400340", "778CAA53B4393AC467774D09497A87224BF9FAB6F6E68B23086497324D6FD117", "0000000000000000000000000000000000000000000000000000000000000000", "0102030405060708090A0B0C0D0E0F1011", "5130F39A4059B43BC7CAC09A19ECE52B5D8699D1A71E3C52DA9AFDB6B50AC370C4A482B77BF960F8681540E25B6771ECE1E5A37FD80E5A51897C5566A97EA5A5"], ["18", "0340034003400340034003400340034003400340034003400340034003400340", "778CAA53B4393AC467774D09497A87224BF9FAB6F6E68B23086497324D6FD117", "0000000000000000000000000000000000000000000000000000000000000000", "99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999", "403B12B0D8555A344175EA7EC746566303321E5DBFA8BE6F091635163ECA79A8585ED3E3170807E7C03B720FC54C7B23897FCBA0E9D0B4A06894CFD249F22367"]];
for (const [i, sk, pk, aux, msg, sig] of VEC) {
  const got = C.hex(await C.sign(C.unhex(msg.toLowerCase()), C.unhex(sk.toLowerCase()), C.unhex(aux.toLowerCase())));
  ok(got === sig.toLowerCase(), "BIP-340 vector " + i + " signature");
  ok(C.hex(C.pubOf(C.unhex(sk.toLowerCase()))) === pk.toLowerCase(), "BIP-340 vector " + i + " public key");
}

// codes
const code = C.newCode();
ok(code.length === 20 && C.cleanCode(code) === code, "a new code is 20 characters and valid");
ok(C.cleanCode(C.showCode(code).toLowerCase()) === code, "typed in lower case with dashes still reads");
const typo = code.slice(0, 5) + (code[5] === "7" ? "8" : "7") + code.slice(6);
ok(C.cleanCode(typo) === "", "one wrong character is caught by the check character");
const c2 = C.newCode(new Uint8Array(19).fill(0));
ok(C.cleanCode(c2.replace(/0/g, "o")) === c2, "O typed for 0 reads as 0");

// keys and sealing
const K = await C.keys(code), K2 = await C.keys(C.newCode());
ok(/^[0-9a-f]{64}$/.test(K.pk), "Nostr public key from the code");
ok((await C.keys(code)).pk === K.pk, "the same code gives the same key on every device");
const d0 = await C.dtag(K, "bucket/0");
ok(/^osap-[0-9a-f]{32}$/.test(d0) && d0 !== await C.dtag(K2, "bucket/0"), "bucket names differ between codes");
const sealed = await C.seal(K, d0, { type: "bucket", u: { a: 1 } });
ok((await C.open(K, d0, sealed)).u.a === 1, "sealed payload opens with the key");
ok(await C.open(K2, d0, sealed) === null, "another code cannot open it");
ok(await C.open(K, await C.dtag(K, "bucket/1"), sealed) === null, "moved to another bucket name it is refused");
const bad = sealed.slice(0, 40) + (sealed[40] === "A" ? "B" : "A") + sealed.slice(41);
ok(await C.open(K, d0, bad) === null, "a changed byte is refused");
ok(!sealed.includes("bucket") && !atob(sealed.slice(2)).includes("bucket"), "payload is not readable as text");
const ev = await C.event(K, d0, sealed, 1790000000);
ok(ev.kind === 30078 && ev.pubkey === K.pk && /^[0-9a-f]{64}$/.test(ev.id) && /^[0-9a-f]{128}$/.test(ev.sig) && ev.tags[0][1] === d0, "event is a signed kind 30078 with its bucket name");

// units: split and join
const pts = [{ id: "p1", n: "A", lat: 1, lon: 2, cc: "th" }, { id: "p2", n: "B", cc: "us" }, { id: "p3", n: "C" }];
let u = C.split(JSON.stringify(pts));
ok(u["~"] === "a" && u["[p1"] && u["[p3"] && !u["[p2"], "a list with ids is cut per item, the us item left out");
ok(C.join(u, JSON.stringify(pts)) === JSON.stringify(pts), "joined back with this device's text: same order, us item kept");
ok(C.join(u, null) === JSON.stringify([pts[0], pts[2]]), "joined on a device without it: no us item");
const work = { v: 1, items: { r1: { saved: 1, cc: "th" }, r2: { note: "x", cc: "us" }, constructor: { saved: 1 } }, schema: "w" };
u = C.split(JSON.stringify(work));
ok(u[".items{r1"] && !u[".items{r2"] && u[".items{constructor"] && u[".schema"] === "w", "an object's keyed map is cut per entry", Object.keys(u));
ok(C.join(u, JSON.stringify(work)) === JSON.stringify(work), "keyed map joins back the same");
const area = [[6, 101], [6, 102], [7, 102]];
u = C.split(JSON.stringify(area));
ok(u["~"] === "v" && C.join(u, null) === JSON.stringify(area), "a coordinate list is one unit");
u = C.split("not json");
ok(C.join(u, null) === "not json", "a plain text store round-trips");
const ent = { schema: "osap-an-ent/1", items: [], notes: {} };
ok(C.join(C.split(JSON.stringify(ent)), null) === JSON.stringify(ent), "empty list and map props survive");

// merge between two devices
const ws = [{ id: "ws-aaaa1", name: "Default", created: 1 }];
const SY = (k) => k !== "osap-route-cur";
function L(stores) { return C.unitsOf(ws, () => stores, SY); }
const A0 = { "osap-atak-pts": JSON.stringify([{ id: "p1", n: "Alpha" }]), "osap-route-cur": "x" };
const B0 = { "osap-atak-pts": JSON.stringify([{ id: "q1", n: "PC point" }]) };
let t = 1000;
// device A made the code: its items are dated now
let SA = C.stamp(L(A0), {}, {}, t, false);
let MA = C.merge([{}, SA], t);
ok(!Object.keys(MA).some((k) => k.includes("osap-route-cur")), "the open route selection does not sync");
// device B joins: its items are dated old, then it merges with A's
t = 2000;
let SB = C.stamp(L(B0), {}, {}, t, true);
let MB = C.merge([{}, SB, MA], t);
let outB = C.storesFrom(MB, "ws-aaaa1", B0)["osap-atak-pts"];
ok(JSON.parse(outB).map((p) => p.id).join() === "q1,p1", "joining device ends with both devices' points", outB);
// A picks up B's
t = 3000;
let OA = {}; for (const k in SA) OA[k] = { t: SA[k].t, h: SA[k].h };
SA = C.stamp(L(A0), OA, MA, t, false);
MA = C.merge([MA, SA, MB], t);
ok(JSON.parse(C.storesFrom(MA, "ws-aaaa1", A0)["osap-atak-pts"]).map((p) => p.id).join() === "p1,q1", "first device gets the other's point, its order kept");
// A deletes p1 and renames q1, B edits p1 later than... A's delete is newer
t = 4000;
const A1 = { "osap-atak-pts": JSON.stringify([{ id: "q1", n: "PC point renamed" }]) };
OA = {}; for (const k in SA) if (!SA[k].d) OA[k] = { t: SA[k].t, h: SA[k].h };
let OA2 = {}; for (const k in C.unitsOf(ws, () => ({ "osap-atak-pts": C.storesFrom(MA, "ws-aaaa1", A0)["osap-atak-pts"] }), SY)) { const x = MA[k]; OA2[k] = { t: x.t, h: x.h }; }
SA = C.stamp(L(A1), OA2, MA, t, false);
ok(Object.values(SA).some((x) => x.d), "a point removed here leaves a delete marker");
MA = C.merge([MA, SA], t);
t = 3500; // B's own clock: B edited q1 before A renamed it
let OB = {}; for (const k in C.unitsOf(ws, () => ({ "osap-atak-pts": outB }), SY)) OB[k] = { t: MB[k].t, h: MB[k].h };
const B1 = { "osap-atak-pts": JSON.stringify([{ id: "q1", n: "PC point" }, { id: "p1", n: "Alpha" }, { id: "q2", n: "new on PC" }]) };
SB = C.stamp(L(B1), OB, MB, t, false);
MB = C.merge([MB, SB, MA], 5000);
outB = JSON.parse(C.storesFrom(MB, "ws-aaaa1", B1)["osap-atak-pts"]);
ok(outB.map((p) => p.id).join() === "q1,q2", "deleted point stays deleted, new point kept", outB);
ok(outB[0].n === "PC point renamed", "newest change to the same point wins");
// old delete markers go after 60 days
const gone = C.merge([MB], 5000 + 61 * 864e5);
ok(!Object.keys(gone).some((k) => gone[k].d), "delete markers are dropped after 60 days");
// buckets round-trip, damaged units dropped
const B = C.buckets(MB), back = {};
B.forEach((b) => Object.assign(back, C.trusted(C.fromBucket(JSON.parse(JSON.stringify(b))))));
ok(Object.keys(back).length === Object.keys(MB).length, "every unit goes through the buckets and back");
const k1 = Object.keys(MB).find((k) => !MB[k].d), bb = { [k1]: [MB[k1].t, MB[k1].h, { id: "evil" }] };
ok(!Object.keys(C.trusted(C.fromBucket(bb))).length, "a unit that does not match its fingerprint is dropped");
ok(!Object.keys(C.fromBucket({ "X|bad": [1, "h", 1], ["S|" + "x".repeat(700)]: [1, "h", 1] })).length, "malformed unit names are dropped");

console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
