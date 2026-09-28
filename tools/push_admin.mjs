// Adds, replaces or stops a push watch from a GitHub issue (run by .github/workflows/push-watches.yml on "issues: opened").
// The app's Push to phone button opens a filled-in issue:
//   title "OSAP push watch: <name>"         body with one ```json block holding the watch   -> adds it (or replaces the same id)
//   title "OSAP push watch: stop <id>"      body optional                                   -> removes it
// Only the repository owner's issues are acted on (checked here and in the workflow). The issue text is read from the event
// file, never from the command line, and only the known fields of a watch are kept (tools/push_lib.mjs).
// Writes data/push/watches.json and push-admin-result.txt (the comment the workflow posts on the issue).
import fs from "node:fs";
import { readList, writeList, validate, MAX_WATCHES } from "./push_lib.mjs";

const ev = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const issue = ev.issue || {}, owner = (ev.repository && ev.repository.owner && ev.repository.owner.login) || "";
const title = String(issue.title || ""), body = String(issue.body || "").slice(0, 20000);
function done(msg) {
  fs.writeFileSync("push-admin-result.txt", msg + "\n");
  console.log(msg.split("\n")[0]);
}
if (!issue.user || issue.user.login !== owner) { done("Not from the repository owner; nothing changed."); process.exit(0); }

const list = readList();
const stop = /^OSAP push watch:\s*stop\s+(w[a-z0-9-]{3,40})\s*$/i.exec(title.trim());
if (stop) {
  const n = list.watches.length;
  list.watches = list.watches.filter((w) => w.id !== stop[1]);
  if (list.watches.length === n) done(`No push watch with id ${stop[1]}; nothing changed.`);
  else { writeList(list); done(`Push alerts stopped for watch ${stop[1]}. ${list.watches.length} push watch(es) left.`); }
  process.exit(0);
}
const m = /```json\s*([\s\S]*?)```/.exec(body);
let w = null;
try { w = m ? JSON.parse(m[1]) : null; } catch (e) { done("The watch in this issue is not valid JSON; nothing changed. Use Push to phone in OSAP to make a new one."); process.exit(0); }
const r = validate(w);
if (r.error) { done(`This watch was not added: ${r.error}. Nothing changed.`); process.exit(0); }
const i = list.watches.findIndex((x) => x.id === r.watch.id);
if (i < 0 && list.watches.length >= MAX_WATCHES) { done(`There are already ${MAX_WATCHES} push watches; stop one first. Nothing changed.`); process.exit(0); }
r.watch.added = new Date().toISOString().slice(0, 16) + "Z";
if (i >= 0) list.watches[i] = r.watch; else list.watches.push(r.watch);
writeList(list);
done(`Push watch "${r.watch.name}" ${i >= 0 ? "updated" : "added"}. It is checked after every refresh (about every 15 minutes). ` +
  `The first check only notes what is already there; after that, new matching reports are sent to your ntfy channel.`);
