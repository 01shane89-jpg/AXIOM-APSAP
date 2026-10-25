// Team, Organisation and paid-pilot accounts (tools/teams.mjs): checked here on every request from the signed-in Netlify
// Identity account. Nothing the page says about itself counts.
//   GET                                   signed in: my team, the team invites waiting for my confirmed email, launch places left
//   GET ?team=<id>&log=1                  an admin: the team's decision records, newest first
//   POST {cmd, op, team?, ...}            a command (create, rename, plan, invite, uninvite, accept, decline, remove, leave,
//                                         admin, call, link, unlink)
//   POST {cmd:"checkout", team}           an admin: a Paddle checkout for the team's plan (the page opens it by transaction id)
//   POST {cmd:"seats", team, seats}       an admin: more or fewer seats on a paid Team or Organisation (Paddle prorates)
// Paddle is sandbox unless PADDLE_ENV=live (tools/paddle.mjs paddleEnv). Prices, seats and discounts are worked out here,
// never taken from the page: the page sends a team id, and the server builds the transaction. Records are in the Netlify Blobs
// store "osap-teams"; seats are written to each member's Identity app_metadata.osap_seat. Logs carry the command, a short team
// id and the status only: never emails, names, reasons, keys or Paddle's answers.
import { admin } from "@netlify/identity";
import { getStore } from "@netlify/blobs";
import { actorOf, mine, readLog, run, checkoutFor, seatsFor, writeSeats, TeamError } from "../../tools/teams.mjs";
import { getCase, run as caseRun, actorOf as caseActor } from "../../tools/cases.mjs";
import { paddleEnv, paddleCall, priceIds } from "../../tools/paddle.mjs";

const MAX_BODY = 4096;
const json = (o, status = 200) => Response.json(o, { status, headers: { "cache-control": "no-store" } });
let stores = () => ({ teams: getStore({ name: "osap-teams", consistency: "strong" }), cases: getStore({ name: "osap-cases", consistency: "strong" }) });
let identity = () => admin, fetchFn = (...a) => fetch(...a);
/** tests only: stand-ins for Netlify Blobs, the Identity admin API and Paddle's API */
export function useStores(f) { stores = f; }
export function useIdentity(f) { identity = f; }
export function useFetch(f) { fetchFn = f; }
const env = (k) => Netlify.env.get(k);

async function who(req) {
  const auth = req.headers.get("authorization");
  if (!auth || !/^Bearer\s+\S+$/.test(auth)) return null;
  const r = await fetch(new URL("/.netlify/identity/user", req.url), { headers: { authorization: auth } }).catch(() => null);
  return r && r.ok ? await r.json().catch(() => null) : null;
}

export default async (req) => {
  const me = await who(req), actor = actorOf(me);
  if (!actor) return json({ error: "Sign in first." }, 401);
  const S = stores();
  let cmd = req.method;
  try {
    if (req.method === "GET") {
      const u = new URL(req.url), id = u.searchParams.get("team");
      if (id && u.searchParams.get("log")) return json({ log: await readLog(S.teams, actor, id, Number(u.searchParams.get("limit")) || 100) });
      const { seat, ...out } = await mine(S.teams, actor);
      const had = ((me.app_metadata || {}).osap_seat) || null;
      if (JSON.stringify(had) !== JSON.stringify(seat)) await writeSeats(identity(), [{ uid: actor.uid, seat }]);
      const pe = paddleEnv(env);
      return json({ ...out, seatChanged: JSON.stringify(had) !== JSON.stringify(seat), payments: pe.ok ? { sandbox: !pe.live } : null });
    }
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    const raw = await req.text();
    if (raw.length > MAX_BODY) return json({ error: "too large" }, 413);
    let b;
    try { b = JSON.parse(raw) || {}; } catch (e) { return json({ error: "bad json" }, 400); }
    cmd = String(b.cmd || "").slice(0, 16);

    if (cmd === "checkout" || cmd === "seats") {
      const pe = paddleEnv(env);
      if (!pe.ok) return json({ error: pe.why }, 503);
      const prices = priceIds(env);
      if (cmd === "seats") {
        const s = await seatsFor(S.teams, actor, b.team, b.seats, prices);
        await paddleCall(pe, "PATCH", "/subscriptions/" + encodeURIComponent(s.subscription), { items: s.items, proration_billing_mode: "prorated_immediately" }, fetchFn);
        console.log("osap team seats", String(b.team).slice(5, 13), "ok");
        return json({ ok: true, quote: s.quote });
      }
      const spec = await checkoutFor(S.teams, actor, b.team, prices);
      let discount_id;
      if (spec.discount) {
        const d = { ...spec.discount };
        for (const k of Object.keys(d)) if (d[k] == null) delete d[k];
        discount_id = (await paddleCall(pe, "POST", "/discounts", d, fetchFn)).id;
      }
      const txn = await paddleCall(pe, "POST", "/transactions", { items: spec.items, custom_data: spec.custom_data, currency_code: spec.currency_code, collection_mode: "automatic", ...(discount_id ? { discount_id } : {}) }, fetchFn);
      console.log("osap team checkout", String(b.team).slice(5, 13), pe.live ? "live" : "sandbox", "ok");
      return json({ transaction: txn.id, token: pe.token, sandbox: !pe.live, quote: spec.quote, email: actor.email });
    }

    // a team admin may link, invite into and remove from only the cases they lead (tools/cases.mjs decides)
    const cActor = caseActor(me);
    const leads = async (c) => (await getCase(S.cases, cActor, c).catch(() => null))?.role === "lead";
    const out = await run(S.teams, actor, b, { leads });
    const seatsWritten = out.seats.length ? await writeSeats(identity(), out.seats) : 0;
    const cases = [];
    for (const [i, c] of out.cases.entries()) {
      const op = String(b.op).slice(0, 56) + "-c" + i;
      try { await caseRun(S.cases, cActor, { ...c, op }); cases.push({ case: c.case, cmd: c.cmd, ok: true }); }
      catch (e) { cases.push({ case: c.case, cmd: c.cmd, ok: false, error: e.status ? e.message : "Something went wrong." }); }
    }
    console.log("osap team", cmd, out.decision ? out.decision.team.slice(5, 13) + ":" + out.decision.version : "-", out.repeat ? "repeat" : "ok", "seats " + seatsWritten, "cases " + cases.filter((c) => c.ok).length + "/" + cases.length);
    return json({ team: out.view, decision: out.decision, repeat: !!out.repeat, cases });
  } catch (e) {
    const status = e instanceof TeamError ? e.status : e && e.status === 502 ? 502 : 500;
    console.log("osap team", cmd, "refused", status);
    return json({ error: e instanceof TeamError || status === 502 ? e.message : "Something went wrong. Try again." }, status);
  }
};

export const config = { path: "/api/osap-teams" };
