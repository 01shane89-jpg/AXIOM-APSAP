// Link previews (LinkedIn, X, Slack, WhatsApp, iMessage) read only <head>. On 26 Nov 2026 index.html closed <head> on
// line 2, before <title> and the og:/twitter: tags, so LinkedIn Post Inspector still titled the site "Flood" (the
// Flood view's first <h1>) and found no image. This fails when <head> ends before those tags, or when anything a
// browser would not keep in <head> (a <div>, text) sits before them, since that also ends <head> early.
// Run: node tests/head_meta.test.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const html = readFileSync(process.argv[2] || "index.html", "utf8");
const open = html.search(/<head[\s>]/i), close = html.search(/<\/head>/i), body = html.search(/<body[\s>]/i);
assert.ok(open >= 0, "index.html has a <head>");
assert.ok(close > open, "index.html closes <head> after opening it");
assert.equal((html.match(/<\/head>/gi) || []).length, 1, "index.html closes <head> once");
assert.ok(body > close, "<body> starts after </head>");

let head = html.slice(html.indexOf(">", open) + 1, close);
// every element before </head> must be one a browser keeps in <head>; anything else ends <head> there
const stripped = head.replace(/<!--[\s\S]*?-->/g, "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<title>[\s\S]*?<\/title>/gi, "");
const tags = stripped.match(/<\/?([a-z][a-z0-9-]*)/gi) || [];
for (const t of tags) assert.ok(/^<(meta|link|base|noscript|\/noscript|template|\/template)$/i.test(t), "not allowed in <head>: " + t);
assert.equal(stripped.replace(/<[^>]*>/g, "").trim(), "", "no text in <head>");

const one = (re, what) => { const m = head.match(re); assert.ok(m, what + " is in <head>"); return m[1]; };
assert.equal(one(/<title>([^<]+)<\/title>/i, "<title>"), "AXIOM OSAP");
assert.equal(one(/<meta property="og:title" content="([^"]+)"/, "og:title"), "AXIOM OSAP");
assert.match(one(/<meta property="og:image" content="([^"]+)"/, "og:image"), /^https:\/\/osap\.axiom-intelligence-systems\.com\/assets\/og-card\.jpg$/);
one(/<meta property="og:description" content="([^"]+)"/, "og:description");
one(/<meta property="og:url" content="([^"]+)"/, "og:url");
one(/<meta name="description" content="([^"]+)"/, "description");
assert.equal(one(/<meta name="twitter:card" content="([^"]+)"/, "twitter:card"), "summary_large_image");
one(/<meta name="twitter:image" content="([^"]+)"/, "twitter:image");
console.log("head_meta: title and link-preview tags are inside <head>");
