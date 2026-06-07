"use strict";
const fs = require("fs");
const path = require("path");
const lib = require("../src/library.js");

let pass = 0,
  fail = 0;
function ok(c, label) {
  if (c) { pass++; console.log("PASS " + label); }
  else { fail++; console.log("FAIL " + label); }
}
function eq(a, b, label) {
  ok(a === b, label + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");
}

const SYX = fs.readFileSync(path.join(__dirname, "..", "data", "test-dx7-vced.syx"));

// ---- addDump + identification + dedupe -------------------------------------
(function () {
  const L = lib.createLibrary();
  const r1 = lib.addDump(L, SYX, { trackName: "Lead" });
  ok(!r1.deduped, "first add is not deduped");
  eq(r1.info.manufacturerShort, "Yamaha", "dump identified: Yamaha");
  eq(r1.info.deviceModel, "DX7 (voice)", "dump identified: DX7 voice");
  eq(r1.info.patchName, "TEST LEAD1", "dump identified: patch name");
  eq(r1.info.name, "Lead - Yamaha - TEST LEAD1", "dump auto-named");
  eq(r1.info.byteSize, SYX.length, "byte size recorded");

  // identical bytes dedupe to same id
  const r2 = lib.addDump(L, SYX, { trackName: "Other" });
  ok(r2.deduped, "identical dump deduped");
  eq(r2.dumpId, r1.dumpId, "same content -> same dumpId");
  eq(Object.keys(L.sysexLibrary).length, 1, "only one library entry after dup add");
})();

// ---- base64 payload round-trips byte-identical ------------------------------
(function () {
  const L = lib.createLibrary();
  const { dumpId } = lib.addDump(L, SYX, { trackName: "Lead" });
  const out = Buffer.from(lib.getDumpBytes(L, dumpId));
  ok(out.equals(SYX), "stored payload decodes byte-identical to source .syx");
})();

// ---- associate + getDumpForClip --------------------------------------------
(function () {
  const L = lib.createLibrary();
  const { dumpId } = lib.addDump(L, SYX, { trackName: "Lead" });
  lib.associate(L, "1a2b3c4d", dumpId, { destinationPort: "USB MIDI 1", trackName: "Lead" });
  const a = lib.getAssociation(L, "1a2b3c4d");
  eq(a.dumpId, dumpId, "association stores dumpId");
  eq(a.destinationPort, "USB MIDI 1", "association stores port");
  ok(a.sendOnLaunch, "sendOnLaunch defaults true");
  eq(lib.getDumpForClip(L, "1a2b3c4d").patchName, "TEST LEAD1", "getDumpForClip resolves payload meta");
  ok(lib.getDumpForClip(L, "nope") === null, "unknown clip -> null");
})();

// ---- send-on-launch dedupe --------------------------------------------------
(function () {
  const loaded = {};
  ok(lib.shouldSend(loaded, "USB MIDI 1", "dump_x"), "first launch: should send");
  lib.markSent(loaded, "USB MIDI 1", "dump_x");
  ok(!lib.shouldSend(loaded, "USB MIDI 1", "dump_x"), "same patch already loaded: skip");
  ok(lib.shouldSend(loaded, "USB MIDI 1", "dump_y"), "different patch: send");
  ok(lib.shouldSend(loaded, "USB MIDI 2", "dump_x"), "same patch, different port: send");
  ok(!lib.shouldSend(loaded, "USB MIDI 1", null), "no dump: never send");
})();

// ---- import / export round-trip --------------------------------------------
(function () {
  const L = lib.createLibrary();
  const r = lib.importSyx(L, SYX, { trackName: "Bass", sourceFile: "test-dx7-vced.syx" });
  eq(r.info.origin, "imported", "import marks origin");
  const exported = Buffer.from(lib.exportDump(L, r.dumpId));
  ok(exported.equals(SYX), "export bytes == original .syx (import/export round-trip)");
})();

// ---- serialize / deserialize (Dict persistence) -----------------------------
(function () {
  const L = lib.createLibrary();
  const { dumpId } = lib.addDump(L, SYX, { trackName: "Lead" });
  lib.associate(L, "1a2b3c4d", dumpId, { destinationPort: "USB MIDI 1" });
  const json = lib.serialize(L);
  const L2 = lib.deserialize(json);
  eq(lib.getDumpForClip(L2, "1a2b3c4d").patchName, "TEST LEAD1", "association survives serialize/deserialize");
  const out = Buffer.from(lib.getDumpBytes(L2, dumpId));
  ok(out.equals(SYX), "payload survives serialize/deserialize byte-identical");
  eq(lib.deserialize(null).schemaVersion, lib.SCHEMA_VERSION, "deserialize(null) -> fresh library");
})();

// ---- decideLaunch (launch -> uuid -> assoc -> dedupe) ----------------------
(function () {
  const L = lib.createLibrary();
  const { dumpId } = lib.addDump(L, SYX, { trackName: "Lead" });
  lib.associate(L, "1a2b3c4d", dumpId, { destinationPort: "USB MIDI 1" });
  const loaded = {};
  const NAME = "Lead Riff [sx:1a2b3c4d]";

  eq(lib.decideLaunch(L, NAME, loaded).action, "send", "first launch -> send");
  const d1 = lib.decideLaunch(L, NAME, loaded);
  eq(d1.dumpId, dumpId, "decideLaunch returns dumpId");
  eq(d1.port, "USB MIDI 1", "decideLaunch returns port");

  lib.markSent(loaded, "USB MIDI 1", dumpId);
  eq(lib.decideLaunch(L, NAME, loaded).action, "skip", "relaunch same patch -> skip (dedupe)");
  eq(lib.decideLaunch(L, NAME, loaded).reason, "already-loaded", "skip reason");

  eq(lib.decideLaunch(L, "Plain clip no tag", loaded).action, "none", "untagged clip -> none");
  eq(lib.decideLaunch(L, "Other [sx:99999999]", loaded).action, "none", "tagged but no assoc -> none");

  // send-disabled association
  lib.associate(L, "1a2b3c4d", dumpId, { sendOnLaunch: false });
  eq(lib.decideLaunch(L, NAME, {}).action, "none", "sendOnLaunch=false -> none");
})();

// ---- listDumps -------------------------------------------------------------
(function () {
  const L = lib.createLibrary();
  lib.addDump(L, SYX, { trackName: "Lead" });
  const rows = lib.listDumps(L);
  eq(rows.length, 1, "listDumps row count");
  eq(rows[0].manufacturer, "Yamaha", "listDumps shows manufacturer");
})();

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
