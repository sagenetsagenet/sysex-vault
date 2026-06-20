"use strict";
const rcv = require("../src/receiver.js");

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("PASS " + label); }
  else { fail++; console.log("FAIL " + label); }
}
function eq(a, b, label) {
  ok(JSON.stringify(a) === JSON.stringify(b), label + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");
}

// feed a whole byte array, return the array of COMPLETE messages it produced
function run(st, bytes) {
  const out = [];
  for (const b of bytes) { const m = rcv.feed(st, b); if (m) out.push(m); }
  return out;
}

// ---- basic framing ---------------------------------------------------------
(() => {
  const st = rcv.create();
  const msgs = run(st, [0xF0, 0x43, 0x00, 0x01, 0xF7]);
  eq(msgs.length, 1, "one complete message");
  eq(msgs[0], [0xF0, 0x43, 0x00, 0x01, 0xF7], "message bytes intact");
  eq(rcv.pending(st), 0, "buffer empty after a complete message");
})();

// ---- THE BUG: a SECOND patch must capture cleanly after the first ----------
(() => {
  const st = rcv.create();
  const a = run(st, [0xF0, 0x43, 0x11, 0xF7]);
  eq(a.length, 1, "first patch captured");
  // simulate the device re-arming (RECEIVE clicked) — clears the buffer
  rcv.reset(st);
  eq(rcv.pending(st), 0, "buffer clear after RECEIVE/reset");
  const b = run(st, [0xF0, 0x7E, 0x22, 0xF7]);
  eq(b.length, 1, "SECOND patch captured after re-arm");
  eq(b[0], [0xF0, 0x7E, 0x22, 0xF7], "second patch bytes intact");
})();

// second patch captures even WITHOUT an explicit reset (F0 self-restarts) -----
(() => {
  const st = rcv.create();
  run(st, [0xF0, 0x01, 0xF7]);
  const b = run(st, [0xF0, 0x02, 0xF7]);
  eq(b.length, 1, "back-to-back patches without reset");
  eq(b[0], [0xF0, 0x02, 0xF7], "second back-to-back intact");
})();

// ---- a stray/garbage tail must NOT wedge the next real patch ---------------
(() => {
  const st = rcv.create();
  // an aborted dump (F0 then never closes), then a fresh, complete dump
  run(st, [0xF0, 0x43, 0x99]);          // no F7 — left mid-buffer
  ok(rcv.pending(st) > 0, "aborted dump leaves a partial buffer");
  const b = run(st, [0xF0, 0x7E, 0x01, 0xF7]);
  eq(b.length, 1, "F0 discards the stuck partial and captures the next patch");
  eq(b[0], [0xF0, 0x7E, 0x01, 0xF7], "next patch intact after a stuck partial");
})();

// reset() rescues a stuck partial too (what RECEIVE does) --------------------
(() => {
  const st = rcv.create();
  run(st, [0xF0, 0x43, 0x99]);          // stuck
  rcv.reset(st);
  eq(rcv.pending(st), 0, "reset clears a stuck partial");
  const b = run(st, [0xF0, 0x55, 0xF7]);
  eq(b.length, 1, "patch captured after reset of a stuck partial");
})();

// ---- realtime bytes interleaved in/around a dump are ignored ---------------
(() => {
  const st = rcv.create();
  // clock (F8) and active-sensing (FE) sprinkled inside the SysEx body
  const msgs = run(st, [0xFE, 0xF0, 0x43, 0xF8, 0x11, 0xFE, 0x22, 0xF7]);
  eq(msgs.length, 1, "realtime-interleaved dump still completes");
  eq(msgs[0], [0xF0, 0x43, 0x11, 0x22, 0xF7], "realtime bytes stripped from the dump");
})();

// a realtime byte while idle must not start a phantom buffer -----------------
(() => {
  const st = rcv.create();
  rcv.feed(st, 0xF8);   // clock while idle
  rcv.feed(st, 0xFE);   // active sensing while idle
  eq(rcv.pending(st), 0, "idle realtime bytes do not start a buffer");
})();

// ---- tolerate a dump that lost its leading F0 ------------------------------
(() => {
  const st = rcv.create();
  const msgs = run(st, [0x43, 0x00, 0xF7]);
  eq(msgs.length, 1, "dump without leading F0 still captured");
  eq(msgs[0][0], 0xF0, "leading F0 synthesised");
})();

// ---- multi-message bank in one stream --------------------------------------
(() => {
  const st = rcv.create();
  const msgs = run(st, [0xF0, 0x01, 0xF7, 0xF0, 0x02, 0xF7, 0xF0, 0x03, 0xF7]);
  eq(msgs.length, 3, "three messages framed from one stream");
})();

console.log("\n" + pass + " PASS, " + fail + " FAIL");
process.exit(fail ? 1 : 0);
