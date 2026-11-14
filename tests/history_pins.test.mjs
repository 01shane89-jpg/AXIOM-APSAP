// Unit test for tools/history.mjs dropCountryPin: a kept news item pinned on a region named like its own country (México state,
// Panamá province) loses that pin; real places keep theirs. Run from the repo root: node tests/history_pins.test.mjs
import { dropCountryPin } from "../tools/history.mjs";
let fails = 0;
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fails++; };
const pin = (cc, n, p) => dropCountryPin(cc, { geo: { n, la: 1, lo: 1, p } }).geo;
ok(pin("mx", "Mexico", "province") === null, "Mexico at province precision on the Mexico view is dropped");
ok(pin("mx", "México", "province") === null, "México (accented) is dropped too");
ok(pin("pa", "Panama", "province") === null, "Panama province on the Panama view is dropped");
ok(pin("mx", "Mexico City", "approx")?.n === "Mexico City", "Mexico City keeps its pin");
ok(pin("mx", "Sinaloa", "province")?.n === "Sinaloa", "another state keeps its pin");
ok(pin("sg", "Singapore", "approx")?.n === "Singapore", "a city-state's town-precision pin is kept");
ok(dropCountryPin("mx", { title: "no pin" }).geo === undefined, "an item with no pin is left alone");
if (fails) { console.log(fails + " failed"); process.exit(1); }
console.log("history pin tests passed");
