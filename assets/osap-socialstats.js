/* AXIOM OSAP: Social media view tabs "By platform" and "Replies" (the "Posts" tab is the page's own post list).
   By platform: counts and trends per platform for the open country, worked out in this browser from the posts AXIOM keeps
   (data/live/social/<cc>.js plus data/history/<cc>.js). These are posts from the accounts AXIOM follows
   (tools/social_accounts.json), not everything on the platform.
   Replies: what the public replies to those accounts' Bluesky posts say, as aggregates only (tools/social_replies.mjs writes
   data/live/replies/<cc>.js). No reply author or reply text is ever shown or stored: counts, a word-list tone estimate, theme
   shares and words at least three different replies used. Word lists, not AI.
   The page calls window.OSAP_SOCSTATS.wrap(postsHtml) and then .bind(rail, ctx) from showSocial;
   ctx = { cc, name, esc }. Read-only: it never changes a record. */
(function () {
  "use strict";
  var W = window, tab = "posts", ctx = null, loading = {};
  var PLAT = ["Bluesky", "Telegram", "YouTube"];
  var NOT_READ = "X (Twitter), Facebook, Instagram, TikTok and Reddit are not read: they need an account or API key, or refuse automated reads (Reddit blocks GitHub's servers).";
  var NO_COMMENTS = { YouTube: "YouTube comments need a YouTube Data API key, so they are not read.", Telegram: "Telegram comments sit in each channel's discussion group, which needs a logged-in account, so they are not read." };
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
    var h = '<div class="sec"><h2>Replies</h2><div class="banner" style="margin:0 0 8px"><b>Public replies, summarised.</b> What people replying to the Bluesky posts in this view say, counted with fixed word lists (not AI). ' +
      "No names, handles or reply text are kept; a word is listed only when at least three different replies used it. Tone is a rough English word count and misreads sarcasm. Replies are opinions, not facts.</div>";
    if (loading[cc] === 1) return h + '<p class="obs">Loading…</p></div>';
    if (!R) return h + '<p class="obs"><span class="badge stale">NO DATA</span> No Bluesky posts with replies are kept for ' + E(ctx.name) + " yet. " + NO_COMMENTS.YouTube + " " + NO_COMMENTS.Telegram + "</p></div>";
    var T = R.totals || {}, tn = T.tone || {};
    h += '<p class="obs"><span class="badge stale">SNAPSHOT</span> ' + E((W.OSAP_TIME && W.OSAP_TIME.asofT) ? W.OSAP_TIME.asofT(R.asof) : R.asof) + " · " + T.posts + " newest Bluesky post" + (T.posts === 1 ? "" : "s") + " · " + n(T.read) + " of " + n(T.replies) + " replies read · " + n(T.scored) + " in English and scored</p>";
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
      var u = /^https:\/\/bsky\.app\//.test(p.link || "") ? p.link : "";
      return '<div class="tlrow ssrep"><span class="tlt">' + E(when(p.date)) + " · " + E(p.account) + (p.stale ? ' · <span class="badge stale">FROM LAST RUN</span>' : "") + '</span><span class="tln">' + E(p.title) + "</span>" +
        '<span class="tlm"><span class="tls">' + n(p.replies) + " replies · " + n(p.likes) + " likes · " + n(p.reposts) + " reposts" + (top ? " · mostly: " + E(top[1].toLowerCase()) : "") +
        ((a.terms || []).length ? " · words: " + E(a.terms.slice(0, 4).map(function (x) { return x[0]; }).join(", ")) : "") + "</span></span>" +
        (a.scored ? bar([["Positive", t.positive, "sspos"], ["Neutral", t.neutral, "ssneu"], ["Negative", t.negative, "ssneg"]]) : "") +
        (u ? '<a class="rellink" href="' + E(u) + '" target="_blank" rel="noopener noreferrer">Post</a>' : "") + "</div>";
    }).join("") + "</div>";
    return h + '<p class="obs">' + NO_COMMENTS.YouTube + " " + NO_COMMENTS.Telegram + "</p></div>";
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
  function show(rail) {
    var box = rail.querySelector("#sstabs");
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll("[data-sstab]"), function (b) { b.setAttribute("aria-selected", String(b.getAttribute("data-sstab") === tab)); });
    Array.prototype.forEach.call(rail.querySelectorAll("[data-sspane]"), function (p) { p.hidden = p.getAttribute("data-sspane") !== tab; });
    var pane = rail.querySelector('[data-sspane="' + tab + '"]');
    if (tab === "plat") pane.innerHTML = platformHtml();
    if (tab === "rep") pane.innerHTML = repliesHtml();
  }
  W.OSAP_SOCSTATS = {
    wrap: function (postsHtml) {
      return '<div class="pkgtabs" id="sstabs" role="tablist"><button type="button" role="tab" data-sstab="posts">Posts</button><button type="button" role="tab" data-sstab="plat">By platform</button>' +
        '<button type="button" role="tab" data-sstab="rep">Replies</button></div><div data-sspane="posts">' + postsHtml + '</div><div data-sspane="plat" hidden></div><div data-sspane="rep" hidden></div>';
    },
    bind: function (rail, c) {
      ctx = c;
      Array.prototype.forEach.call(rail.querySelectorAll("[data-sstab]"), function (b) {
        b.addEventListener("click", function () { tab = b.getAttribute("data-sstab"); show(rail); if (tab !== "posts") load(ctx.cc, function () { if (rail.isConnected && tab !== "posts") show(rail); }); });
      });
      load(ctx.cc, function () { if (rail.isConnected && tab !== "posts") show(rail); });
      show(rail);
    },
    _test: { stats: stats, posts: posts }
  };
})();
