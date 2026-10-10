// Unit test for the conflict tabs' casualty figures (tools/conflict_lib.mjs figure, KILLED, INJURED): a number counts only when it
// belongs to the casualty word. Cases are real headline shapes from the war tabs.
// Usage: node tests/conflict_figures.test.mjs
import assert from "node:assert/strict";
import { figure, KILLED, INJURED } from "../tools/conflict_lib.mjs";

for (const [t, k, i] of [
  ["Two Traffic Accidents in Baghlan Leave Two Dead and Nine Injured", 2, 9],         // "two dead and nine injured": nine is the injured
  ["1 killed and 10 wounded in Israeli shelling of civilian vehicle in central Gaza Strip", 1, 10],
  ["Pakistan airstrikes in Afghanistan; 9 killed,11 injured, says Kabul", 9, 11],
  ["Mexico prison riot kills 10 and leaves 16 injured as inmates clash", 10, 16],
  ["Two martyrs and one wounded in occupation shelling of a vehicle in Gaza City", null, 1],
  ["12 Palestinians killed and injured in Israeli shelling", 12, null],                  // one number for both: the injured are unknown
  ["Haiti: At least 5,700 killed or injured in gang violence since January, UN says", null, null],   // not 700
  ["Sinaloa Cartel War Leaves 3,800 Dead", null, null],
  ["Drones kill 1,100 civilians in Sudan's civil war this year", null, null],
  ["Newlywed loses husband 20 years after father died in air crash", null, null],
  ["No one killed or injured as drone hits apartment block", null, null],
  ["Russians dropped six drones on Zaporizhia: one killed and several wounded", 1, null],
  ["15 shots fired, one man killed", 1, null],
  ["Strike kills at least 7 in Kharkiv", 7, null],
  ["Attack wounds 12 soldiers near border", null, 12],
  ["2.5 tonnes of explosives seized; 3 dead", 3, null],
]) assert.deepEqual([figure(t, KILLED), figure(t, INJURED)], [k, i], t);
console.log("conflict casualty figures ok");
