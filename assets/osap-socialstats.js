/* AXIOM OSAP: Social media view tabs "By platform", "Replies" and "Public pulse" (the "Posts" tab is the page's own post list).
   By platform: counts and trends per platform for the open country, worked out in this browser from the posts AXIOM keeps
   (data/live/social/<cc>.js plus data/history/<cc>.js). These are posts from the accounts AXIOM follows
   (tools/social_accounts.json), not everything on the platform.
   Replies: what the public replies to those accounts' Bluesky, Mastodon and Telegram posts say, as aggregates only
   (tools/social_replies.mjs writes data/live/replies/<cc>.js). No reply author or reply text is ever shown or stored: counts, a
   word-list tone estimate, theme shares and words at least three different replies used. Word lists, not AI.
   Public pulse: what the public posts about the country on Bluesky and Mastodon as a whole, from a sample of their public streams
   every half hour (tools/social_pulse.mjs writes data/live/pulse/<cc>.js and data/live/pulse.js): volume against the country's own
   7-day normal, unrest, economy and safety indicators, rising and fading hashtags and words, tone and languages. Counts only.
   The page calls window.OSAP_SOCSTATS.wrap(postsHtml) and then .bind(rail, ctx) from showSocial;
   ctx = { cc, name, esc }. Read-only: it never changes a record. */
(function () {
  "use strict";
  var W = window, tab = "posts", ctx = null, loading = {};
  var PLAT = ["Bluesky", "Telegram", "Mastodon", "YouTube"];
  var NOT_READ = "X (Twitter), Facebook, Instagram, TikTok and Reddit are not read: they need an account or API key, or refuse automated reads (Reddit blocks GitHub's servers).";
  var NO_COMMENTS = { YouTube: "YouTube comments need a YouTube Data API key, so they are not read." };
  var INDS = [["protest", "Protests and demonstrations", "unrest"], ["strike", "Strikes and walkouts", "unrest"], ["fuel", "Fuel", "economy"], ["prices", "Prices and cost of living", "economy"],
    ["shortage", "Shortages", "economy"], ["power", "Power cuts", "safety"], ["internet", "Internet cuts", "safety"], ["curfew", "Curfews", "safety"],
    ["checkpoint", "Checkpoints and roadblocks", "safety"], ["evacuation", "Evacuation and fleeing", "safety"], ["violence", "Shooting, explosions and attacks", "safety"]];
  var GROUPS = [["unrest", "Unrest"], ["economy", "Economy"], ["safety", "Safety on the ground"]];
  var THEMES = [["doubt", "Doubts the report or the source"], ["action", "Calls for action"], ["concern", "Fear or concern"], ["anger", "Anger or outrage"],
    ["sympathy", "Sympathy or support"], ["humour", "Jokes or sarcasm"], ["question", "Questions"]];
  function E(s) { return ctx.esc(s); }
  function ms(d) { var s = String(d || ""); return Date.parse(s.length <= 10 ? s + "T00:00Z" : s.replace(" ", "T") + (/Z$|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z")); }
  function n(v) { return Math.round(v || 0).toLocaleString("en-GB"); }
  function pct(a, b) { return b ? Math.round((100 * a) / b) : 0; }
  function when(d) { var T = W.OSAP_TIME, t = ms(d); return isNaN(t) ? String(d || "") : T && T.dualT ? T.dualT(t, { date: true }) : new Date(t).toISOString().slice(0, 16).replace("T", " ") + "Z"; }

  /* every post kept for this country, one per link: the live snapshot first, then the history */
  function posts(cc) {
    var live = ((W.ASAP_SOCIAL || {}).items || {})[cc] || [], hist = (((W.ASAP_HIST || {})[cc] || {}).social) || [], seen = {}, out = [];
    live.concat(hist).forEach(function (i) { if (i && i.link && !seen[i.link]) { seen[i.link] = 1; out.push(i); } });
    return out;
  }
  /* per platform: posts in the last 24 h / 7 d / 30 d and all kept, active accounts, daily counts for 30 days, busiest accounts */
  function stats(list, now) {
    var day = 864e5, by = {};
    PLAT.forEach(function (p) { by[p] = { p: p, d1: 0, d7: 0, d30: 0, all: 0, first: null, accts: {}, daily: new Array(30).fill(0) }; });
    list.forEach(function (i) {
      var p = PLAT.indexOf(i.platform) >= 0 ? i.platform : null, t = ms(i.date);
      if (!p || isNaN(t)) return;
      var s = by[p], age = now - t;
      s.all++; if (s.first == null || t < s.first) s.first = t;
      if (age < day) s.d1++;
      if (age < 7 * day) s.d7++;
      if (age < 30 * day) { s.d30++; s.accts[i.account || "?"] = (s.accts[i.account || "?"] || 0) + 1; var k = Math.floor(age / day); if (k >= 0 && k < 30) s.daily[29 - k]++; }
    });
    return PLAT.map(function (p) { return by[p]; });
  }
  function spark(daily) {
    var max = Math.max.apply(null, daily.concat([1])), w = 4, h = 26;
    return '<svg class="ssspark" viewBox="0 0 ' + daily.length * w + " " + h + '" preserveAspectRatio="none" role="img" aria-label="Posts per day, last 30 days">' +
      daily.map(function (v, i) { var bh = v ? Math.max(2, Math.round((v / max) * (h - 2))) : 0; return '<rect x="' + i * w + '" y="' + (h - bh) + '" width="' + (w - 1) + '" height="' + bh + '"><title>' + v + "</title></rect>"; }).join("") + "</svg>";
  }
  function bar(parts) {   // parts: [[label, value, cls]]
    var tot = parts.reduce(function (a, p) { return a + p[1]; }, 0);
    if (!tot) return '<div class="ssbar"></div>';
    return '<div class="ssbar" role="img" aria-label="' + E(parts.map(function (p) { return p[0] + " " + pct(p[1], tot) + "%"; }).join(", ")) + '">' +
      parts.map(function (p) { return p[1] ? '<span class="' + p[2] + '" style="width:' + (100 * p[1]) / tot + '%" title="' + E(p[0] + " " + p[1] + " (" + pct(p[1], tot) + "%)") + '"></span>' : ""; }).join("") + "</div>";
  }
  function srcState(cc) {
    var o = {};
    (((W.ASAP_SOCIAL || {}).sources) || []).forEach(function (s) {
      if (s.cc !== cc && s.cc !== "*") return;
      var x = (o[s.platform] = o[s.platform] || { ok: 0, bad: 0 });
      if (s.ok) x.ok++; else if (!s.skipped) x.bad++;
    });
    return o;
  }

  function platformHtml() {
    var cc = ctx.cc, list = posts(cc), now = Date.now(), S = stats(list, now), st = srcState(cc), R = (W.OSAP_REPLIES || {})[cc];
    var tot7 = S.reduce(function (a, s) { return a + s.d7; }, 0);
    var h = '<div class="sec"><h2>Social media by platform</h2><p class="obs">Posts AXIOM keeps from the official and established accounts it follows for ' + E(ctx.name) +
      ", not everything posted on each platform. Regional and global accounts count here only when a post names " + E(ctx.name) + ". Worked out in this browser from " + n(list.length) + " kept posts.</p>";
    if (!list.length) return h + '<p class="obs">No social posts are kept for this country yet.</p></div>';
    h += '<div class="sstable" role="table"><div class="ssrow sshead" role="row"><span role="columnheader">Platform</span><span role="columnheader">24 h</span><span role="columnheader">7 d</span><span role="columnheader">30 d</span><span role="columnheader">Share</span><span role="columnheader">Per day, 30 d</span></div>';
    S.forEach(function (s) {
      h += '<div class="ssrow" role="row"><span role="cell"><b>' + s.p + "</b></span><span role=\"cell\">" + n(s.d1) + '</span><span role="cell">' + n(s.d7) + '</span><span role="cell">' + n(s.d30) +
        '</span><span role="cell">' + pct(s.d7, tot7) + '%</span><span role="cell">' + (s.all ? spark(s.daily) : "–") + "</span></div>";
    });
    h += "</div>" + bar(S.map(function (s, i) { return [s.p, s.d7, "ssp" + i]; })) + '<p class="obs ssleg">' + S.map(function (s, i) { return '<i class="ssdot ssp' + i + '"></i>' + s.p; }).join(" ") + " · share of the last 7 days' posts</p>";
    S.forEach(function (s) {
      var acc = Object.keys(s.accts).map(function (a) { return [a, s.accts[a]]; }).sort(function (a, b) { return b[1] - a[1]; }), x = st[s.p];
      h += '<div class="ssplat"><h3>' + s.p + "</h3><p class=\"obs\">" + (s.all ? n(s.all) + " posts kept since " + E(when(new Date(s.first).toISOString().slice(0, 16))) + " · " + acc.length + " account" + (acc.length === 1 ? "" : "s") + " posted in the last 30 days" : "No posts kept.") +
        (x ? " · last refresh: " + x.ok + " account" + (x.ok === 1 ? "" : "s") + " read" + (x.bad ? ', <span class="badge stale">' + x.bad + " FAILED</span>" : "") : " · no account set up for this country") + "</p>" +
        (acc.length ? '<p class="obs">Busiest: ' + acc.slice(0, 4).map(function (a) { return E(a[0]) + " (" + a[1] + ")"; }).join(", ") + "</p>" : "") +
        (s.p === "Bluesky" && R && R.totals ? '<p class="obs">Engagement on the ' + R.totals.posts + " newest posts: " + n(R.totals.likes) + " likes, " + n(R.totals.reposts) + " reposts, " + n(R.totals.replies) + " replies, " + n(R.totals.quotes) + " quotes.</p>" : "") +
        (NO_COMMENTS[s.p] ? '<p class="obs">' + NO_COMMENTS[s.p] + "</p>" : "") + "</div>";
    });
    return h + '<p class="obs">' + NOT_READ + "</p></div>";
  }

  function repliesHtml() {
    var cc = ctx.cc, R = (W.OSAP_REPLIES || {})[cc];
    var h = '<div class="sec"><h2>Replies</h2><div class="banner" style="margin:0 0 8px"><b>Public replies, summarized.</b> What people replying to the Bluesky, Mastodon and Telegram posts in this view say, counted with fixed word lists (not AI). ' +
      "No names, handles or reply text are kept; a word is listed only when at least three different replies used it. Tone is a rough English word count and misreads sarcasm. Replies are opinions, not facts.</div>";
    if (loading[cc] === 1) return h + '<p class="obs">Loading…</p></div>';
    if (!R) return h + '<p class="obs"><span class="badge stale">NO DATA</span> No posts with replies are kept for ' + E(ctx.name) + " yet. " + NO_COMMENTS.YouTube + "</p></div>";
    var T = R.totals || {}, tn = T.tone || {};
    h += '<p class="obs"><span class="badge stale">SNAPSHOT</span> ' + E((W.OSAP_TIME && W.OSAP_TIME.asofT) ? W.OSAP_TIME.asofT(R.asof) : R.asof) + " · " + T.posts + " newest post" + (T.posts === 1 ? "" : "s") + platMix(R.posts) + " · " + n(T.read) + " of " + n(T.replies) + " replies read · " + n(T.scored) + " in English and scored</p>";
    h += "<h3>Tone</h3>" + bar([["Positive", tn.positive, "sspos"], ["Neutral", tn.neutral, "ssneu"], ["Negative", tn.negative, "ssneg"]]) +
      '<p class="obs ssleg"><i class="ssdot sspos"></i>Positive ' + pct(tn.positive, T.scored) + '% <i class="ssdot ssneu"></i>Neutral ' + pct(tn.neutral, T.scored) + '% <i class="ssdot ssneg"></i>Negative ' + pct(tn.negative, T.scored) + "%</p>";
    var th = THEMES.map(function (t) { return [t[1], (T.themes || {})[t[0]] || 0]; }).filter(function (t) { return t[1]; }).sort(function (a, b) { return b[1] - a[1]; });
    h += "<h3>Themes</h3>" + (th.length ? '<div class="ssthemes">' + th.map(function (t) {
      return '<div class="ssth"><span>' + E(t[0]) + '</span><span class="ssthb"><span style="width:' + pct(t[1], T.read) + '%"></span></span><span>' + pct(t[1], T.read) + "%</span></div>";
    }).join("") + '</div><p class="obs">Share of replies read; one reply can show several themes.</p>' : '<p class="obs">No listed theme words in the replies read.</p>');
    h += "<h3>Common words</h3>" + ((T.terms || []).length ? '<p class="ssterms">' + T.terms.map(function (t) { return '<span class="ssterm">' + E(t[0]) + " <b>" + t[1] + "</b></span>"; }).join(" ") + "</p>" : '<p class="obs">No word used by three or more replies.</p>');
    var ps = (R.posts || []).slice().sort(function (a, b) { return (b.replies || 0) - (a.replies || 0); });
    h += "<h3>Most-discussed posts</h3>" + '<div class="tllist">' + ps.map(function (p) {
      var a = p.a || {}, t = a.tone || {}, top = THEMES.filter(function (x) { return (a.themes || {})[x[0]]; }).sort(function (x, y) { return a.themes[y[0]] - a.themes[x[0]]; })[0];
      var u = /^https:\/\/(bsky\.app|t\.me)\/|^https:\/\/[a-z0-9.-]+\/@/i.test(p.link || "") ? p.link : "";
      return '<div class="tlrow ssrep"><span class="tlt">' + E(when(p.date)) + " · " + E(p.platform || "Bluesky") + " · " + E(p.account) + (p.stale ? ' · <span class="badge stale">FROM LAST RUN</span>' : "") + '</span><span class="tln">' + E(p.title) + "</span>" +
        '<span class="tlm"><span class="tls">' + n(p.replies) + " replies · " + n(p.likes) + " likes · " + n(p.reposts) + " reposts" + (top ? " · mostly: " + E(top[1].toLowerCase()) : "") +
        ((a.terms || []).length ? " · words: " + E(a.terms.slice(0, 4).map(function (x) { return x[0]; }).join(", ")) : "") + "</span></span>" +
        (a.scored ? bar([["Positive", t.positive, "sspos"], ["Neutral", t.neutral, "ssneu"], ["Negative", t.negative, "ssneg"]]) : "") +
        (u ? '<a class="rellink" href="' + E(u) + '" target="_blank" rel="noopener noreferrer">Post</a>' : "") + "</div>";
    }).join("") + "</div>";
    return h + '<p class="obs">' + NO_COMMENTS.YouTube + " Telegram comments are read from Telegram's public comments widget, which shows the newest 50 per post; channels without comments show none.</p></div>";
  }
  function platMix(list) {
    var c = {}; (list || []).forEach(function (p) { var k = p.platform || "Bluesky"; c[k] = (c[k] || 0) + 1; });
    var k = Object.keys(c); return k.length ? " (" + k.map(function (x) { return c[x] + " " + x; }).join(", ") + ")" : "";
  }

  /* Public pulse: hourly buckets and the summary tools/social_pulse.mjs wrote */
  function rateOf(b) { var s = 0, k; for (k in b.s || {}) s += b.s[k]; return s ? (1e4 * b.n) / s : 0; }
  function times(r) { return r == null ? "–" : r >= 10 ? Math.round(r) + "×" : (Math.round(r * 10) / 10) + "×"; }
  function pulseSpark(hours) {
    var now = Date.now(), H = 168, w = 2, h = 34, cells = new Array(H).fill(null);
    (hours || []).forEach(function (b) { var k = Math.floor((now - Date.parse(b.h + ":00Z")) / 36e5); if (k >= 0 && k < H) cells[H - 1 - k] = rateOf(b); });
    var max = Math.max.apply(null, cells.map(function (v) { return v || 0; }).concat([0.01]));
    return '<svg class="ssspark sspulse" viewBox="0 0 ' + H * w + " " + h + '" preserveAspectRatio="none" role="img" aria-label="Posts naming the country per 10,000 sampled, each hour, last 7 days">' +
      cells.map(function (v, i) { if (v == null) return ""; var bh = v ? Math.max(2, Math.round((v / max) * (h - 2))) : 1; return '<rect x="' + i * w + '" y="' + (h - bh) + '" width="' + (w - 0.4) + '" height="' + bh + '"' + (v ? "" : ' class="ss0"') + "><title>" + (Math.round(v * 10) / 10) + " per 10,000</title></rect>"; }).join("") + "</svg>";
  }
  function chips(list, extra) {
    return '<p class="ssterms">' + list.map(function (t) { return '<span class="ssterm">' + E(t[0]) + " <b>" + t[1] + (extra ? extra(t) : "") + "</b></span>"; }).join(" ") + "</p>";
  }
  function pulseHtml() {
    var cc = ctx.cc, P = (W.OSAP_PULSE || {})[cc], I = W.OSAP_PULSE_INDEX;
    var h = '<div class="sec"><h2>Public pulse</h2><div class="banner" style="margin:0 0 8px"><b>What the public posts about ' + E(ctx.name) + '.</b> A sample of all public Bluesky and Mastodon posts, taken about every half hour; a post counts when it names ' + E(ctx.name) +
      " (or its people or capital). Only counts are kept: no names, handles, links or post text. Tone and the indicators are fixed word lists, not AI, and read English best. Posts are opinions and claims, not facts; a rise in talk is a cue to look, not a finding.</div>";
    if (loading["p" + cc] === 1) return h + '<p class="obs">Loading…</p></div>';
    if (!P || !P.summary) return h + '<p class="obs"><span class="badge stale">NO DATA</span> No sampled post has named ' + E(ctx.name) + " yet." + (I ? " Last sample " + E(I.asof) + "." : "") + "</p></div>";
    var S = P.summary, tn = S.tone || [0, 0, 0], scored = tn[0] + tn[1] + tn[2];
    h += '<p class="obs"><span class="badge stale">SAMPLE</span> ' + E((W.OSAP_TIME && W.OSAP_TIME.asofT) ? W.OSAP_TIME.asofT(P.asof) : P.asof) + " · " + n(S.n24) + " sampled post" + (S.n24 === 1 ? "" : "s") + " named " + E(ctx.name) + " in the last 24 h (" + S.hours24 + " sampled hour" + (S.hours24 === 1 ? "" : "s") + ")" +
      Object.keys(S.platforms || {}).map(function (k) { return " · " + k + " " + n(S.platforms[k]); }).join("") + "</p>";
    h += '<div class="sskpi"><div><b>' + (Math.round(S.rate24 * 10) / 10) + '</b><span>per 10,000 posts, 24 h</span></div><div><b>' + (S.base == null ? "–" : Math.round(S.base * 10) / 10) + '</b><span>7-day normal</span></div><div><b>' + times(S.ratio) + '</b><span>vs normal</span></div>' +
      (S.spike ? '<div><b><span class="badge ssup">SPIKE</span></b><span>last 3 h ' + times(S.base ? S.rate3h / S.base : null) + " normal</span></div>" : "") + "</div>";
    if (S.base == null) h += '<p class="obs">The 7-day normal needs at least 12 sampled hours before today; until then there is nothing to compare with.</p>';
    if (S.n24 < 20) h += '<p class="obs"><span class="badge stale">FEW POSTS</span> Under 20 sampled posts in 24 h: too few to judge tone or trends.</p>';
    h += "<h3>Volume, last 7 days</h3>" + pulseSpark(P.hours) + '<p class="obs">Each bar is one sampled hour: posts naming ' + E(ctx.name) + " per 10,000 posts sampled, so a busier or quieter network does not look like a change in interest. Gaps are hours with no sample.</p>";
    var ind = S.ind || {};
    h += "<h3>Unrest, economy and safety talk</h3>";
    var any = 0;
    GROUPS.forEach(function (g) {
      var rows = INDS.filter(function (x) { return x[2] === g[0] && ind[x[0]]; });
      if (!rows.length) return; any = 1;
      h += '<div class="ssind"><b>' + g[1] + "</b>" + rows.map(function (x) {
        var v = ind[x[0]];
        return '<div class="ssirow"><span>' + E(x[1]) + "</span><span>" + n(v.n) + "</span><span>" + v.share + "%</span><span>" + (v.ratio == null ? "–" : times(v.ratio)) + "</span><span>" + (v.up ? '<span class="badge ssup">UP</span>' : "") + "</span></div>";
      }).join("") + "</div>";
    });
    h += any ? '<p class="obs">Posts in 24 h that use the words, their share of all posts naming ' + E(ctx.name) + ", and the rate against the 7-day normal. UP means at least 5 posts and twice the normal rate.</p>" : '<p class="obs">No indicator words in the last 24 h.</p>';
    if ((S.cities || []).length) h += "<h4>Towns named in those posts</h4>" + chips(S.cities);
    var tm = S.tagMoves || {}, wm = S.termMoves || {}, up = (tm.up || []).map(function (t) { return ["#" + t[0], t[1], t[2]]; }).concat(wm.up || []), down = (tm.down || []).map(function (t) { return ["#" + t[0], t[1], t[2]]; }).concat(wm.down || []);
    h += "<h3>Narratives</h3>" + (up.length ? "<h4>Rising (24 h, was)</h4>" + chips(up.slice(0, 10), function (t) { return " · " + t[2]; }) : "") + (down.length ? "<h4>Fading (24 h, was)</h4>" + chips(down.slice(0, 8), function (t) { return " · " + t[2]; }) : "") +
      (up.length || down.length ? '<p class="obs">Hashtags and words used by at least three sampled posts, against the 24 hours before (scaled to the same sample size).</p>' : '<p class="obs">No hashtag or word rose or faded enough to show.</p>');
    h += "<h3>Top hashtags</h3>" + ((S.tags || []).length ? chips(S.tags.map(function (t) { return ["#" + t[0], t[1]]; })) : '<p class="obs">No hashtag used by three or more sampled posts.</p>');
    h += "<h3>Common words</h3>" + ((S.terms || []).length ? chips(S.terms) : '<p class="obs">No word used by three or more sampled posts.</p>');
    h += "<h3>Tone (English posts)</h3>" + (scored ? bar([["Positive", tn[0], "sspos"], ["Neutral", tn[1], "ssneu"], ["Negative", tn[2], "ssneg"]]) +
      '<p class="obs ssleg"><i class="ssdot sspos"></i>Positive ' + pct(tn[0], scored) + '% <i class="ssdot ssneu"></i>Neutral ' + pct(tn[1], scored) + '% <i class="ssdot ssneg"></i>Negative ' + pct(tn[2], scored) + "% · " + n(scored) + " scored, word lists, misreads sarcasm</p>" : '<p class="obs">No English posts to score.</p>');
    var L = S.langs || {}, lk = Object.keys(L).sort(function (a, b) { return L[b] - L[a]; });
    h += "<h3>Languages</h3>" + (lk.length ? bar(lk.slice(0, 5).map(function (k, i) { return [k === "?" ? "not stated" : k, L[k], "ssl" + i]; })) + '<p class="obs ssleg">' + lk.slice(0, 5).map(function (k, i) { return '<i class="ssdot ssl' + i + '"></i>' + E(k === "?" ? "not stated" : k) + " " + pct(L[k], S.n24); }).join("% ") + "% · as the posters set it</p>" : '<p class="obs">None.</p>');
    if (I && I.sources) h += '<p class="obs">Last sample ' + E(I.asof) + ", " + I.minutes + " min: " + I.sources.map(function (x) { return E(x.name.replace(/ \(.*\)$/, "")) + (x.ok ? " " + n(x.posts) : ' <span class="badge stale">FAILED</span>'); }).join(" · ") + ". " + E(I.terms || "") + "</p>";
    return h + '<p class="obs">X, Facebook, Instagram, TikTok and Reddit are not sampled: they need an account or key, or refuse automated reads.</p></div>';
  }

  function load(cc, cb) {
    if ((W.OSAP_REPLIES || {})[cc] || loading[cc]) return cb && loading[cc] !== 1 && cb();
    if (!/^https?:$/.test(location.protocol) || !/^[a-z]{2,3}$/.test(cc)) { loading[cc] = 2; return cb && cb(); }
    loading[cc] = 1;
    var s = document.createElement("script");
    s.src = "data/live/replies/" + cc + ".js";
    s.onload = s.onerror = function () { loading[cc] = 2; if (cb) cb(); };
    document.body.appendChild(s);
  }
  function loadPulse(cc, cb) {
    var k = "p" + cc;
    if ((W.OSAP_PULSE || {})[cc] || loading[k]) return cb && loading[k] !== 1 && cb();
    if (!/^https?:$/.test(location.protocol) || !/^[a-z]{2,3}$/.test(cc)) { loading[k] = 2; return cb && cb(); }
    loading[k] = 1;
    var left = 2, done = function () { if (--left) return; loading[k] = 2; if (cb) cb(); };
    [["data/live/pulse/" + cc + ".js", 0], ["data/live/pulse.js", W.OSAP_PULSE_INDEX]].forEach(function (x) {
      if (x[1]) return done();
      var s = document.createElement("script"); s.src = x[0]; s.onload = s.onerror = done; document.body.appendChild(s);
    });
  }
  function show(rail) {
    var box = rail.querySelector("#sstabs");
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll("[data-sstab]"), function (b) { b.setAttribute("aria-selected", String(b.getAttribute("data-sstab") === tab)); });
    Array.prototype.forEach.call(rail.querySelectorAll("[data-sspane]"), function (p) { p.hidden = p.getAttribute("data-sspane") !== tab; });
    var pane = rail.querySelector('[data-sspane="' + tab + '"]');
    if (tab === "plat") pane.innerHTML = platformHtml();
    if (tab === "rep") pane.innerHTML = repliesHtml();
    if (tab === "pulse") pane.innerHTML = pulseHtml();
  }
  W.OSAP_SOCSTATS = {
    wrap: function (postsHtml) {
      return '<div class="pkgtabs" id="sstabs" role="tablist"><button type="button" role="tab" data-sstab="posts">Posts</button><button type="button" role="tab" data-sstab="plat">By platform</button>' +
        '<button type="button" role="tab" data-sstab="rep">Replies</button><button type="button" role="tab" data-sstab="pulse">Public pulse</button></div><div data-sspane="posts">' + postsHtml +
        '</div><div data-sspane="plat" hidden></div><div data-sspane="rep" hidden></div><div data-sspane="pulse" hidden></div>';
    },
    bind: function (rail, c) {
      ctx = c;
      Array.prototype.forEach.call(rail.querySelectorAll("[data-sstab]"), function (b) {
        b.addEventListener("click", function () {
          tab = b.getAttribute("data-sstab"); show(rail);
          var again = function () { if (rail.isConnected && tab !== "posts") show(rail); };
          if (tab === "pulse") loadPulse(ctx.cc, again); else if (tab !== "posts") load(ctx.cc, again);
        });
      });
      load(ctx.cc, function () { if (rail.isConnected && tab !== "posts") show(rail); });
      if (tab === "pulse") loadPulse(ctx.cc, function () { if (rail.isConnected && tab === "pulse") show(rail); });
      show(rail);
    },
    _test: { stats: stats, posts: posts, rateOf: rateOf }
  };
})();
