// Flash alerts (tools/push_watches.mjs): which push alerts are "flash" first reports, and when a single-source event that was
// already sent has since been carried by more sources (one "now reported by N sources" follow-up, never more).
// A match comes from window.OSAP_WATCH.matches (index.html wMatches): sev 1-3, ns = how many different sources carry the event,
// off = 1 when one of its reports is an official statement or an instrument reading (not news or social media).
// A flash alert is still a notice about reports, never a finding: it says who reported it and "reported, not verified".

export const FLASH_SEV = 3;

// Serious enough for a flash: the highest severity, or a headline about violence, a mass-casualty hazard or emergency powers.
// On 2026-10-24 only 2 of about 1,950 events from the last 48 h in Thailand, the Philippines, Ukraine and Myanmar carried
// severity 3, so severity alone would almost never fire. Headlines are matched in English (m.t is the event's headline, m.rt the
// report's own title, translated when the feed has a translation). Looking back (anniversary, trial, sentenced) or rehearsing
// (drill, exercise) is not a flash.
export const SERIOUS = /\b(kill(s|ed|ing)?|dead|deaths?|died|fatal\w*|massacre\w*|explosions?|explod\w*|blasts?|bomb(s|ed|ing|ings)?|ieds?|grenades?|shoot(ing|ings|out)|shot dead|gun ?(men|man|fire|fight\w*)|attack(s|ed|ers?)?|ambush\w*|air ?strikes?|drone strikes?|missiles?|rockets?|shell(ing|ed)|artillery|clash(es|ed)?|hostages?|kidnap\w*|abduct\w*|coup|curfew|martial law|state of emergency|evacuat\w*|tsunami|landslides?|stampede|riots?|assassinat\w*|terror\w*|insurgen\w*|militants?|uprising)\b/i;
export const NOT_NOW = /\b(anniversar\w*|memorial|commemorat\w*|remember\w*|years? ago|trial|arrest\w*|sentenc\w*|convict\w*|verdict|court|acquit\w*|drills?|exercises?|rehears\w*|simulat\w*|film|movie|game|match|novel|museum|passed away|funeral|obituar\w*|illness|cancer)\b/i;
export function serious(m) {
  if (!m) return false;
  if ((+m.sev || 1) >= FLASH_SEV) return true;
  const txt = [m.t, m.rt].filter(Boolean).join(" ");
  return SERIOUS.test(txt) && !NOT_NOW.test(txt);
}

/* serious, and either an official source or at least two different sources */
export function isFlash(m) {
  if (!serious(m)) return false;
  return !!m.off || (+m.ns || 1) >= 2;
}

/* what a match adds to a serious event already sent: "corroborated" when it was sent while one non-official source carried it
   and now two or more do, or an official source has joined; null otherwise. `was` is what was kept at sending: { ns, off }. */
export function upgradeOf(was, m) {
  if (!was || !m) return null;
  if (was.up) return null;                                   // one follow-up per event
  const weak = (+was.ns || 1) < 2 && !was.off;
  if (!weak || !serious(m)) return null;                     // follow-ups only for serious events, not routine news
  if ((+m.ns || 1) >= 2 || m.off) return "corroborated";
  return null;
}

/* which matches a watch sends: a flash-only watch sends flash alerts only */
export function wanted(w, m) { return !(w && w.flash) || isFlash(m); }

/* minutes from the event's first report to now, or null when the report time is unknown */
export function lagMin(m, now) {
  const t = +m.t0;
  return isFinite(t) && t > 0 && t <= now + 36e5 ? Math.max(0, Math.round((now - t) / 6e4)) : null;
}

/* median of a list of numbers, or null */
export function median(a) {
  const s = a.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y);
  if (!s.length) return null;
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : Math.round((s[h - 1] + s[h]) / 2);
}
