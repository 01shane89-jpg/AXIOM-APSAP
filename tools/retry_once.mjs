// Retry, not repair (Shane 2026-11-24): the one-attempt pattern shared by the AI summary retry (tools/ground_retry.mjs) and the
// headline translation retry. A failed AI output is never edited in place; a fresh one is drafted once, and it is used only when it
// passes the same checks the first one failed. Every attempt yields a record, kept or not, with no text in it:
//   { at (UTC, to the minute), prompt (its version), model, provider, ok, why (when it failed) }
// Pure: no files, no network of its own (draft() and check() bring them). Never throws: a draft that throws is a failed attempt.
/**
 * draft() -> { value, model, provider } | { why, model?, provider? } | null; check(value) -> "" when it passes, else why.
 * Returns { ok, value (null unless ok), why, record }.
 */
export async function retryOnce({ draft, check, now = Date.now(), prompt = "" }) {
  const rec = { at: new Date(now).toISOString().slice(0, 16), prompt, ok: false };
  let c = null;
  try { c = await draft(); } catch (e) { rec.why = "model error"; return { ok: false, value: null, why: rec.why, record: rec }; }
  if (c && c.model) { rec.model = String(c.model); rec.provider = String(c.provider || ""); }
  if (!c || !c.value) { rec.why = String((c && c.why) || "no reply").slice(0, 80); return { ok: false, value: null, why: rec.why, record: rec }; }
  let why = "";
  try { why = await check(c.value); } catch (e) { why = "check error"; }
  if (why) { rec.why = String(why).slice(0, 80); return { ok: false, value: null, why: rec.why, record: rec }; }
  rec.ok = true;
  return { ok: true, value: c.value, why: "", record: rec };
}
