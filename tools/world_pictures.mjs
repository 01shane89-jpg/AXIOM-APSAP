// World news list pictures (data/live/news/ww.js, written by tools/news_stories.mjs): a lead headline with no picture yet
// (its feed gave none, the hourly news job's page reads had not reached it, or it is older than the picture history) gets the
// article page's own og:image (tools/news_pics.mjs), kept as a link to the outlet's copy. At most WORLD_PICS_MAX pages a run
// (default 80); every page read is remembered in data/live/news-pics.json. Run after tools/news_stories.mjs.
import fs from "node:fs";
import { loadPics, savePics, fillPics } from "./news_pics.mjs";

const FILE = (process.env.STORIES_NEWS || "data/live/news") + "/ww.js", MAX = Number(process.env.WORLD_PICS_MAX || 80);
let w;
try { const t = fs.readFileSync(FILE, "utf8"); w = JSON.parse(t.slice(t.indexOf("=") + 1).trim().replace(/;$/, "")); }
catch (e) { console.log("world pictures: no World news list (" + e.message + ")"); process.exit(0); }
const list = Object.values(w.items || {}).flat(), t0 = Date.now(), cache = loadPics();
const r = await fillPics(list, cache, MAX);
fs.writeFileSync(FILE, "window.ASAP_NEWS=" + JSON.stringify(w).replace(/<\//g, "<\\/") + ";\n");
console.log(`world pictures: ${list.filter((i) => i.img).length} of ${list.length} World headlines have a picture (${r.cached} from the cache, ${r.found} new of ${r.read} pages read); cache ${savePics(cache)} links; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
