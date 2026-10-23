// How many push watches there are (the refresh job's "Any push watches?" step; 0 when the list cannot be read).
import { fetchList } from "./push_lib.mjs";
let n = 0;
try { n = (await fetchList()).watches.length; } catch (e) { console.error("push: could not read the push list:", e.message); }
console.log(n);
