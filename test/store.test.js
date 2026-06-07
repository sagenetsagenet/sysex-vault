"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const store = require("../src/store.js");
const lib = require("../src/library.js");

let pass = 0, fail = 0;
function ok(c, label) {
  if (c) { pass++; console.log("PASS " + label); }
  else { fail++; console.log("FAIL " + label); }
}
function eq(a, b, label) {
  ok(a === b, label + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");
}

// fresh temp store dir per run (no Date/random in module, but the test can use them)
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), "sxstore-"));

const BYTES = [0xf0, 0x43, 0x00, 0x09, 0x20, 0x00, 0x01, 0x02, 0x03, 0xf7];
const OTHER = [0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0xf7];

// ---- hash parity with library.hashBytes (single source of truth) -----------
eq(store.hashOf(BYTES), lib.hashBytes(BYTES), "store.hashOf matches library.hashBytes");
ok(/^[0-9a-f]{8}$/.test(store.hashOf(BYTES)), "hash is 8 hex chars");

// ---- put / has / get round-trip --------------------------------------------
(function () {
  const r = store.put(BASE, BYTES);
  eq(r.deduped, false, "first put is not deduped");
  eq(r.byteSize, BYTES.length, "byteSize reported");
  eq(r.hash, store.hashOf(BYTES), "put returns content hash");
  ok(fs.existsSync(r.path), "file written to disk");
  ok(r.path.endsWith(r.hash + ".syx"), "file named by hash");

  ok(store.has(BASE, r.hash), "has() true after put");
  const back = store.get(BASE, r.hash);
  eq(JSON.stringify(back), JSON.stringify(BYTES), "get() returns byte-identical dump");
})();

// ---- dedupe: identical bytes -> same file, deduped=true ---------------------
(function () {
  const r1 = store.put(BASE, BYTES);
  eq(r1.deduped, true, "second put of same bytes is deduped");
  const before = store.list(BASE).length;
  store.put(BASE, BYTES);
  eq(store.list(BASE).length, before, "dedupe does not create a new file");
})();

// ---- distinct content -> distinct hash + file ------------------------------
(function () {
  const a = store.put(BASE, BYTES);
  const b = store.put(BASE, OTHER);
  ok(a.hash !== b.hash, "different bytes -> different hash");
  eq(store.list(BASE).length, 2, "two dumps in the store");
  ok(store.list(BASE).indexOf(a.hash) >= 0 && store.list(BASE).indexOf(b.hash) >= 0, "list contains both hashes");
})();

// ---- misses + bad input ----------------------------------------------------
eq(store.get(BASE, "deadbeef"), null, "get() unknown hash -> null");
eq(store.has(BASE, "deadbeef"), false, "has() unknown hash -> false");
eq(store.has(BASE, "not-a-hash"), false, "has() rejects malformed hash");
eq(store.get(BASE, "xyz"), null, "get() rejects malformed hash");
eq(store.list(path.join(BASE, "nope")).length, 0, "list() of missing dir -> []");

// ---- the real DX7 test .syx round-trips through the store ------------------
(function () {
  const real = Array.prototype.slice.call(fs.readFileSync(path.join(__dirname, "..", "data", "test-dx7-vced.syx")));
  const r = store.put(BASE, real);
  const back = store.get(BASE, r.hash);
  eq(JSON.stringify(back), JSON.stringify(real), "real DX7 .syx byte-identical through store");
  eq(r.hash, lib.hashBytes(real), "real dump hash matches library hash (clip-name ref will agree)");
})();

// cleanup
try { fs.rmSync(BASE, { recursive: true, force: true }); } catch (_) {}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
