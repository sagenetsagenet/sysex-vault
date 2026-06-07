"use strict";
const p = require("../src/placement.js");

let pass = 0, fail = 0;
function ok(c, label) {
  if (c) { pass++; console.log("PASS " + label); }
  else { fail++; console.log("FAIL " + label); }
}
function eq(a, b, label) {
  ok(a === b, label + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");
}

// ---- empty set -> start bar ------------------------------------------------
eq(p.nextStaggerBar([]), 999, "no parked clips -> 999");
eq(p.nextStaggerBar(null), 999, "null -> 999");
eq(p.nextStaggerBar([], { startBar: 500 }), 500, "custom startBar");

// ---- staggering after existing clips ---------------------------------------
eq(p.nextStaggerBar([999]), 1000, "after 999 -> 1000");
eq(p.nextStaggerBar([999, 1000]), 1001, "after 999,1000 -> 1001");
eq(p.nextStaggerBar([1000, 999, 1001]), 1002, "unordered -> max+1");
eq(p.nextStaggerBar([999, 1000, 1001, 1002, 1003]), 1004, "six tracks stagger to distinct bars");

// ---- floors to startBar even if a stray tagged clip sits below it ----------
eq(p.nextStaggerBar([5]), 999, "lone low clip still parks at 999 floor");
eq(p.nextStaggerBar([5, 1000]), 1001, "mix of low + high -> max+1");

// ---- spacing widens for large dumps ----------------------------------------
eq(p.barSpacing(100), 1, "small dump -> 1 bar");
eq(p.barSpacing(4096), 2, "medium dump -> 2 bars");
eq(p.barSpacing(20000), 4, "big bank -> 4 bars");
eq(p.barSpacing(100, 8), 8, "explicit spacing override");
eq(p.nextStaggerBar([999], { dumpBytes: 20000 }), 1003, "big dump leaves 4-bar gap");
eq(p.nextStaggerBar([999], { spacing: 3 }), 1002, "explicit spacing applied");

// ---- ignores garbage entries ----------------------------------------------
eq(p.nextStaggerBar([999, null, NaN, undefined, 1000]), 1001, "garbage bars ignored");

// ---- realistic 28-synth sequence builds without collision ------------------
(function () {
  let used = [];
  const placed = [];
  for (let i = 0; i < 28; i++) {
    const bar = p.nextStaggerBar(used);
    placed.push(bar);
    used = used.concat(bar);
  }
  eq(new Set(placed).size, 28, "28 placements all distinct bars");
  eq(placed[0], 999, "first at 999");
  eq(placed[27], 1026, "28th at 1026 (sequential)");
})();

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
