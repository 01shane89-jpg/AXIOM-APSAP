// Team workspace (assets/osap-team.js) core: team links and codes (the secret after "#", editor and viewer kinds, typos and
// bad keys refused), the viewer link has no signing key and a viewer cannot make an event a member's device will take,
// BIP-340 signature checks (assets/osap-sync.js verify / checkEvent), call sign stamping on items, the 2 MB cap, the "moved"
// note that closes an old key without carrying the new one, and the checks on what comes in from a relay.
// Run: node tests/team.test.mjs
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const T = req("../assets/osap-team.js"), C = req("../assets/osap-sync.js");
let fails = 0;
function ok(c, m, x) { console.log((c ? "PASS " : "FAIL ") + m + (x === undefined ? "" : " " + JSON.stringify(x))); if (!c) fails++; }
const b64 = (u) => Buffer.from(u).toString("base64"), b64u = (u) => b64(u).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ---------- BIP-340 verification (vectors 1 and 2 of bitcoin/bips bip-0340/test-vectors.csv) ----------
const VEC = [["DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659", "243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89", "6896BD60EEAE296DB48A229FF71DFE071BDE413E6D43F917DC8DCF8C78DE33418906D11AC976ABCCB20B091292BFF4EA897EFCB639EA871CFA95F6DE339E4B0A"],
  ["DD308AFEC5777E13121FA72B9CC1B7CC0139715309B086C960E18FD969774EB8", "7E2D58D8B3BCDF1ABADEC7829054F90DDA9805AAB56C77333024B9D0A508B75C", "5831AAEED7B44BB74E5EAB94BA9D4294C49BCF2A60728D8B4C200F50DD313C1BAB745879A5AD954A72C45A91C3A51D3C7ADEA98D82F8481E0E1E03674A6F3FB7"]];
for (const [pk, msg, sig] of VEC) {
  const P = C.unhex(pk.toLowerCase()), M = C.unhex(msg.toLowerCase()), S = C.unhex(sig.toLowerCase());
  ok(await C.verify(M, P, S), "BIP-340 vector signature verifies");
  const S2 = S.slice(); S2[63] ^= 1;
  ok(!(await C.verify(M, P, S2)), "a changed signature does not");
  const M2 = M.slice(); M2[0] ^= 1;
  ok(!(await C.verify(M2, P, S)), "nor a changed message");
}

// ---------- links and codes ----------
const mat = T.newMaterial();
ok(mat.aes.length === 32 && mat.hk.length === 32 && mat.sk.length === 32 && /^[0-9a-f]{64}$/.test(mat.pk), "fresh team material: AES key, name key, signing key, public key");
const mat2 = T.newMaterial();
ok(C.hex(mat2.aes) !== C.hex(mat.aes) && mat2.pk !== mat.pk, "each team has its own random keys");
const ecode = T.encode(mat, "e", "Ops North"), vcode = T.encode(mat, "v", "Ops North");
ok(/^E1\./.test(ecode) && /^V1\./.test(vcode), "editor and viewer codes are marked", [ecode.slice(0, 3), vcode.slice(0, 3)]);
ok(/^[A-Za-z0-9._-]+$/.test(ecode) && ecode.length < 600, "a code uses only link-safe characters", ecode.length);
const E = T.decode(ecode), V = T.decode(vcode);
ok(E && E.role === "e" && E.name === "Ops North" && E.pk === mat.pk && C.hex(E.sk) === C.hex(mat.sk) && C.hex(E.aes) === C.hex(mat.aes) && C.hex(E.hk) === C.hex(mat.hk), "editor code reads back with all three keys");
ok(V && V.role === "v" && V.pk === mat.pk && C.hex(V.aes) === C.hex(mat.aes) && C.hex(V.hk) === C.hex(mat.hk), "viewer code reads back with the AES key, name key and public key");
ok(V.sk === undefined, "the viewer code has no signing key");
const skHex = C.hex(mat.sk);
const vbytes = Buffer.from(vcode.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64");
ok(!vbytes.toString("hex").includes(skHex) && !vcode.includes(b64u(mat.sk).slice(0, 20)), "the signing key's bytes are nowhere in the viewer code");
ok(T.viewerCode(ecode) !== "" && T.decode(T.viewerCode(ecode)).sk === undefined && T.decode(T.viewerCode(ecode)).pk === mat.pk, "an editor makes the viewer code without the signing key");
ok(T.decode(T.viewerCode(vcode)).role === "v" && T.decode(T.viewerCode(vcode)).sk === undefined, "a viewer can pass on only a viewer code");
const link = T.linkFor("https://axiom-osap.netlify.app/?x=1#th/map", ecode);
ok(link === "https://axiom-osap.netlify.app/#team=" + ecode, "the link puts the code after #, never in the query", link.slice(0, 50));
ok(!link.split("#")[0].includes(ecode.slice(3, 20)), "nothing secret before the #");
ok(T.decode(link).pk === mat.pk && T.decode(" " + link + " ").role === "e", "the whole link reads too");
const typo = ecode.slice(0, 10) + (ecode[10] === "A" ? "B" : "A") + ecode.slice(11);
ok(T.decode(typo) === null, "one changed character is refused by the check");
ok(T.decode("E1.abc.def.123456") === null && T.decode("") === null && T.decode("x".repeat(700)) === null, "junk and over-long codes are refused");
// a viewer code whose public key is not on the curve
const badPk = new Uint8Array(32).fill(0xff);
const body = "V1." + b64u(Buffer.concat([Buffer.from(mat.aes), Buffer.from(mat.hk), Buffer.from(badPk)])) + "." + b64u(Buffer.from("X"));
ok(T.decode(body + "." + C.fp(body).slice(0, 6)) === null, "a viewer code with an impossible public key is refused");
ok(T.decode(T.encode(mat, "e", "a\u0000b\nc" + "z".repeat(80))).name === "a b c" + "z".repeat(35), "team names are cleaned and cut to 40");

// ---------- call signs ----------
ok(T.cleanCall("  Raven 2 ") === "Raven 2", "call sign trimmed");
ok(T.cleanCall("x".repeat(40)).length === 24, "call sign at most 24 characters");
ok(T.cleanCall("shane@example.com") === "" && T.cleanCall("a@b") === "", "an email address is never taken as a call sign");
ok(T.cleanCall("A\u0007B") === "A B", "control characters are removed");

// ---------- keys, sealing, signing: a viewer cannot publish ----------
const KE = await T.teamKeys(E), KV = await T.teamKeys(V), KX = await T.teamKeys(T.newMaterial());
const d = await C.dtag(KE, "bucket/0");
ok(d === await C.dtag(KV, "bucket/0"), "editor and viewer compute the same event names");
const sealed = await C.seal(KE, d, { type: "bucket", v: 1, u: { "W|T": [1, "h", { name: "x" }] } });
ok((await C.open(KV, d, sealed)).type === "bucket", "a viewer opens what an editor sealed");
ok(await C.open(KX, d, sealed) === null, "another team's key cannot");
const ev = await C.event(KE, d, sealed, Math.floor(Date.now() / 1000));
ok(await C.checkEvent(ev, mat.pk), "an editor's event passes the signature check");
ok(KV.sk === null, "a viewer's keys have no signing key");
let refused = false; try { await C.event(KV, d, sealed, 1); } catch { refused = true; }
ok(refused, "event() refuses to make an event with a viewer's keys");
// the viewer tries anyway: same team pubkey, content sealed with the team's AES key, signed with some other key
const forged = { pubkey: mat.pk, created_at: ev.created_at + 10, kind: 30078, tags: [["d", d]], content: await C.seal(KV, d, { type: "bucket", v: 1, u: {} }) };
forged.id = C.hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([0, forged.pubkey, forged.created_at, forged.kind, forged.tags, forged.content])))));
forged.sig = C.hex(await C.sign(C.unhex(forged.id), mat2.sk, new Uint8Array(32)));
ok(!(await C.checkEvent(forged, mat.pk)), "a viewer's forged event (other key's signature) fails the check");
ok(!(await C.checkEvent({ ...forged, sig: ev.sig }, mat.pk)), "a forged event with a copied signature fails");
ok(!(await C.checkEvent({ ...ev, content: sealed + "x" }, mat.pk)), "a changed event fails (id no longer matches)");
ok(!(await C.checkEvent({ ...ev, pubkey: mat2.pk }, mat.pk)), "an event from another key fails");
ok(!(await C.checkEvent({ ...ev, content: "x".repeat(300000) }, mat.pk)), "an oversized event fails");
ok(!(await C.checkEvent(null, mat.pk)) && !(await C.checkEvent({ ...ev, tags: "x" }, mat.pk)), "malformed events fail");
const by = await T.pickSigned([forged, ev, { ...ev, id: "zz" }], mat.pk);
ok(by[d] && by[d].id === ev.id, "the newer forged event is passed over and the signed one kept");

// ---------- call sign stamping ----------
const L = C.unitsOf([{ id: "T", name: "Ops" }], () => ({
  "osap-atak-pts": JSON.stringify([{ id: "p1", n: "New point", lat: 1, lon: 2 }, { id: "p2", n: "Old point", lat: 1, lon: 2 }, { id: "p3", n: "Mine", addedBy: "KILO", addedAt: 5 }]),
  "osap-work": JSON.stringify({ items: { "0123456789abcdef": { cc: "th", saved: true, at: "2026-10-19T10:00:00Z", grade: { r: "B", c: 2 } } }, srcRel: {} }),
  "asap-area-th": JSON.stringify([[6, 101], [6, 102], [7, 102]])
}), () => true);
const Mprev = { "S|T|osap-atak-pts|[p2": { t: 5, h: "x", v: { id: "p2", n: "Old point", lat: 1, lon: 2, addedBy: "ALPHA", addedAt: 1000 } } };
const n = T.stampBy(L, Mprev, "RAVEN 2", 1790000000000);
const p1 = L["S|T|osap-atak-pts|[p1"], p2 = L["S|T|osap-atak-pts|[p2"], p3 = L["S|T|osap-atak-pts|[p3"], wk = L["S|T|osap-work|.items{0123456789abcdef"];
ok(p1.addedBy === "RAVEN 2" && p1.addedAt === 1790000000000, "a new item gets the call sign and the time");
ok(p2.addedBy === "ALPHA" && p2.addedAt === 1000, "an item the team has keeps who added it");
ok(p3.addedBy === "KILO", "an item that already says who added it keeps that");
ok(wk.addedBy === "RAVEN 2" && wk.at === "2026-10-19T10:00:00Z" && wk.grade.r === "B" && wk.grade.c === 2, "a My work item keeps its own at and its source grade");
ok(Array.isArray(L["S|T|asap-area-th|"]) && !("addedBy" in L["S|T|asap-area-th|"]), "a drawn area (a list of corners) keeps its shape");
ok(n === 2, "two items stamped", n);
const viewerL = C.unitsOf([{ id: "T", name: "Ops" }], () => ({ "osap-atak-pts": JSON.stringify([{ id: "q", n: "q" }]) }), () => true);
ok(T.stampBy(viewerL, {}, "", 1) === 0 && !("addedBy" in viewerL["S|T|osap-atak-pts|[q"]), "no call sign, no stamp");
ok(!Object.keys(C.unitsOf([{ id: "T" }], () => ({ "osap-atak-pts": JSON.stringify([{ id: "u", cc: "us" }]) }), () => true)).some((k) => k.includes("[u")), "a hidden cc us item never becomes a unit");

// ---------- the 2 MB cap ----------
ok(!T.capCheck([500000, 500000, 900000]).full, "1.9 MB fits");
const full = T.capCheck(new Array(24).fill(90000));
ok(full.full && full.total === 2160000 && full.pct === 100, "2.16 MB is full", full);
ok(T.CAP === 2000000, "the cap is 2 MB");
// sealed size of something that does not compress: random text
const rnd = req("node:crypto").randomBytes(90000).toString("base64");
const big = await C.seal(KE, d, { type: "bucket", v: 1, u: { "S|T|osap-work|.n": [1, "h", rnd] } });
ok(big.length > 90000 && big.length < 200000, "a sealed bucket's size follows its content", big.length);

// ---------- the moved note ----------
const note = T.movedNote(1790000000000);
ok(JSON.stringify(Object.keys(note).sort()) === JSON.stringify(["at", "type", "v"]) && T.isMoved(note), "the moved note says only that the team moved, and when");
const dm = await C.dtag(KE, "moved"), sm = await C.seal(KE, dm, note);
const newMat = T.newMaterial(), KN = await T.teamKeys(newMat);
ok(T.isMoved(await C.open(KV, dm, sm)), "an old member (even a viewer) reads it with the old key");
ok(await C.open(KN, dm, sm) === null && await C.open(KN, await C.dtag(KN, "moved"), sm) === null, "the new key does not open it");
const plainNote = JSON.stringify(await C.open(KE, dm, sm));
ok(![C.hex(newMat.aes), C.hex(newMat.hk), C.hex(newMat.sk), newMat.pk, b64(newMat.aes), b64u(newMat.sk)].some((s) => plainNote.includes(s)), "no new key inside it");
ok(!T.isMoved({ type: "bucket" }) && !T.isMoved(null), "only a moved note counts");

// ---------- what comes in from a relay ----------
const S = { "W|T": { t: 1, h: "a", v: { name: "x" } }, "W|ws-abcd": { t: 1, h: "a", v: {} }, "S|T|osap-atak-pts|[a": { t: 1, h: "a", v: { id: "a" } },
  "S|T|osap-atak-pts|[u": { t: 1, h: "a", v: { id: "u", cc: "US" } }, "S|T|osap-route-cur|": { t: 1, h: "a", v: 1 }, "S|T|evil|x": { t: 1, h: "a", v: 1 },
  "S|T|asap-area-us|": { t: 1, h: "a", v: [] }, "S|other|osap-aoi|[x": { t: 1, h: "a", v: {} }, "S|T|osap-aoi|[big": { t: 1, h: "a", v: { s: "x".repeat(500000) } }, "S|T|osap-aoi|[gone": { t: 2, h: "", d: 1 } };
const kept = Object.keys(T.okUnits(S, (k) => k !== "evil")).sort();
ok(JSON.stringify(kept) === JSON.stringify(["S|T|osap-aoi|[gone", "S|T|osap-atak-pts|[a", "W|T"]), "only this team's shared stores, no hidden items, no oversized values", kept);

// ---------- photos stay per device ----------
const sh = T.shareText("osap-atak-pts", JSON.stringify([{ id: "a", n: "A", ph: 3 }, { id: "b", n: "B" }]));
ok(!sh.includes('"ph"'), "a point's photo count is not shared");
const back = JSON.parse(T.localText("osap-atak-pts", sh, JSON.stringify([{ id: "a", ph: 3 }])));
ok(back[0].ph === 3 && !("ph" in back[1]), "and is put back from this device's copy");
ok(T.shareText("osap-aoi", "[1]") === "[1]", "other stores pass unchanged");

console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
