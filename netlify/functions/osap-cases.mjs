// Team shared cases (tools/cases.mjs): who may open a case and what each person may do in it, checked here on every request
// from the signed-in Netlify Identity account. Nothing the page says about itself counts.
//   GET                               signed in: my cases, and invites waiting for my confirmed email
//   GET ?case=<id>                    a member: the case (leads also see emails and open invites)
//   GET ?case=<id>&log=1              a member: the case's decision records, newest first
//   GET ?case=<id>&keys=<device>      a member's device: the case epoch and its wrapped case keys; a lead also gets the
//                                     member devices still waiting for the current key (tools/case_vault.mjs)
//   GET ?case=<id>&data=1             a member: the sealed buckets (opaque to the server)
//   POST {cmd, op, case?, ...}        a command (create, rename, invite, uninvite, accept, decline, call, role, remove, leave)
//   POST {cmd:"device", device}       register this device's public key; {cmd:"undevice", device:id} removes one
//   POST {cmd:"wrap", case, epoch, wraps:[{device, wrap}]}     a lead hands the case key to member devices
//   POST {cmd:"put", case, buckets:[{bucket, epoch, rev, data}]} an analyst or lead saves sealed buckets
// Anyone not a member of a case gets 404 for it, the same as for a case that does not exist. Records are in the Netlify Blobs
// store "osap-cases". Logs carry the command, the case id and the status only: never emails, names, reasons or tokens.
import { getStore } from "@netlify/blobs";
import { planOf } from "../../tools/owner.mjs";
import { tierOfRoles } from "../../tools/tiers.mjs";
import { actorOf, getCase, listMine, readLog, run, CaseError } from "../../tools/cases.mjs";
import { addDevice, dropDevice, keysFor, putWraps, readData, writeData } from "../../tools/case_vault.mjs";

const MAX_BODY = 4096, MAX_PUT = 2200000;

const json = (o, status = 200) => Response.json(o, { status, headers: { "cache-control": "no-store" } });
let storeFor = () => getStore({ name: "osap-cases", consistency: "strong" });
/** tests only: a stand-in for Netlify Blobs */
export function useStore(f) { storeFor = f; }

async function who(req) {
  const auth = req.headers.get("authorization");
  if (!auth || !/^Bearer\s+\S+$/.test(auth)) return null;
  const r = await fetch(new URL("/.netlify/identity/user", req.url), { headers: { authorization: auth } }).catch(() => null);
  return r && r.ok ? await r.json().catch(() => null) : null;
}

export default async (req) => {
  const me = await who(req), actor = actorOf(me);
  if (!actor) return json({ error: "Sign in first." }, 401);
  const store = storeFor();
  let cmd = req.method;
  try {
    if (req.method === "GET") {
      const u = new URL(req.url), id = u.searchParams.get("case");
      if (!id) return json(await listMine(store, actor));
      if (u.searchParams.get("keys")) return json(await keysFor(store, actor, id, u.searchParams.get("keys")));
      if (u.searchParams.get("data")) return json(await readData(store, actor, id));
      if (u.searchParams.get("log")) return json({ log: await readLog(store, actor, id, Number(u.searchParams.get("limit")) || 100) });
      return json({ case: await getCase(store, actor, id) });
    }
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    const raw = await req.text();
    if (raw.length > MAX_PUT) return json({ error: "too large" }, 413);
    let b;
    try { b = JSON.parse(raw) || {}; } catch (e) { return json({ error: "bad json" }, 400); }
    cmd = String(b.cmd || "").slice(0, 16);
    if (raw.length > MAX_BODY && cmd !== "put") return json({ error: "too large" }, 413);
    const VAULT = { device: () => addDevice(store, actor, b.device), undevice: () => dropDevice(store, actor, b.device),
      wrap: () => putWraps(store, actor, b.case, b.epoch, b.wraps), put: () => writeData(store, actor, b.case, b.buckets) };
    if (Object.hasOwn(VAULT, cmd)) {
      const res = await VAULT[cmd]();
      console.log("osap case", cmd, "ok");
      return json(res);
    }
    const out = await run(store, actor, b, { plan: planOf(me, Netlify.env.get("OSAP_OWNERS"), tierOfRoles) });
    console.log("osap case", cmd, out.decision ? out.decision.case.slice(5, 13) + ":" + out.decision.version : "-", out.repeat ? "repeat" : "ok");
    return json({ case: out.view, decision: out.decision, repeat: !!out.repeat });
  } catch (e) {
    const status = e instanceof CaseError ? e.status : 500;
    console.log("osap case", cmd, "refused", status);
    return json({ error: e instanceof CaseError ? e.message : "Something went wrong. Try again." }, status);
  }
};

export const config = { path: "/api/osap-cases" };
