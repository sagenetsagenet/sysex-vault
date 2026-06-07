"use strict";
const id = require("../src/identity.js");

let pass = 0,
  fail = 0;
function ok(c, label) {
  if (c) { pass++; console.log("PASS " + label); }
  else { fail++; console.log("FAIL " + label); }
}
function eq(a, b, label) {
  ok(a === b, label + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");
}

// deterministic minter: "00000001", "00000002", ... (8 hex-valid chars, like real mint)
function counterMint() {
  let n = 0;
  return () => String(++n).padStart(8, "0");
}

// ---- tag round-trip --------------------------------------------------------
eq(id.extractUuid("Bass [sx:1a2b3c4d]"), "1a2b3c4d", "extract uuid from name");
eq(id.stripTag("Bass [sx:1a2b3c4d]"), "Bass", "strip tag -> human name");
eq(id.extractUuid("plain name"), null, "untagged -> null");
(function () {
  const mint = counterMint();
  const r = id.ensureTagged("Lead", mint);
  eq(r.uuid, "00000001", "ensureTagged mints uuid");
  eq(r.name, "Lead [sx:00000001]", "ensureTagged appends tag");
  ok(r.changed, "ensureTagged changed=true when minting");
  const r2 = id.ensureTagged(r.name, mint);
  ok(!r2.changed, "ensureTagged idempotent when already tagged");
  eq(r2.uuid, "00000001", "ensureTagged keeps existing uuid");
})();

// ---- THE duplicate paradox: reconcile re-mints + copy-on-write -------------
(function () {
  const mint = counterMint();
  const library = { clipAssociations: {} };

  // 1. Clip A created + tagged, associated with dumpA.
  const a = id.ensureTagged("Bass", mint); // 00000001
  library.clipAssociations[a.uuid] = { dumpId: "dumpA" };
  const clipA = { runtimeId: 1, name: a.name };

  // 2. User duplicates A -> B: Live copies the NAME verbatim (same uuid embedded),
  //    but B is a new instance with a distinct runtimeId.
  const clipB = { runtimeId: 2, name: a.name };

  // 3. Reconcile.
  const res = id.reconcile([clipA, clipB], library, mint);
  eq(res.collisions, 1, "reconcile detects the duplicate collision");
  eq(res.renames.length, 1, "one clip re-minted");

  const uuidA = id.extractUuid(clipA.name);
  const uuidB = id.extractUuid(clipB.name);
  eq(uuidA, "00000001", "original clip keeps its uuid");
  ok(uuidB && uuidB !== uuidA, "duplicate got a NEW distinct uuid");

  // 4. Copy-on-write: both point at the SAME dump initially.
  eq(library.clipAssociations[uuidA].dumpId, "dumpA", "A still -> dumpA");
  eq(library.clipAssociations[uuidB].dumpId, "dumpA", "B copy-on-write -> dumpA");
  ok(library.clipAssociations[uuidA] !== library.clipAssociations[uuidB], "separate assoc objects (not shared ref)");

  // 5. Independent divergence: reassign B's dump; A must be untouched.
  library.clipAssociations[uuidB].dumpId = "dumpB";
  eq(library.clipAssociations[uuidA].dumpId, "dumpA", "A unaffected after B reassigned");
  eq(library.clipAssociations[uuidB].dumpId, "dumpB", "B now -> dumpB independently");

  // 6. Save/load round-trip (serialize library + clip names), then reconcile again.
  const savedLib = JSON.parse(JSON.stringify(library));
  const savedClips = [
    { runtimeId: 11, name: clipA.name }, // runtime ids change after reload — fine
    { runtimeId: 12, name: clipB.name },
  ];
  const res2 = id.reconcile(savedClips, savedLib, mint);
  eq(res2.collisions, 0, "after load, no false collisions (idempotent)");
  eq(res2.renames.length, 0, "after load, no spurious renames");
  eq(savedLib.clipAssociations[uuidA].dumpId, "dumpA", "A assoc survives save/load");
  eq(savedLib.clipAssociations[uuidB].dumpId, "dumpB", "B assoc survives save/load");
})();

// ---- triple-duplicate (A duplicated twice) ---------------------------------
(function () {
  const mint = counterMint();
  const library = { clipAssociations: {} };
  const a = id.ensureTagged("Pad", mint); // 00000001
  library.clipAssociations[a.uuid] = { dumpId: "dumpX" };
  const clips = [
    { runtimeId: 1, name: a.name },
    { runtimeId: 2, name: a.name },
    { runtimeId: 3, name: a.name },
  ];
  const res = id.reconcile(clips, library, mint);
  eq(res.collisions, 2, "two collisions among three identical clips");
  const uuids = clips.map((c) => id.extractUuid(c.name));
  eq(new Set(uuids).size, 3, "all three end with distinct uuids");
  uuids.forEach((u, i) => eq(library.clipAssociations[u].dumpId, "dumpX", "clip " + i + " -> dumpX (cow)"));
})();

// ---- orphan detection ------------------------------------------------------
(function () {
  const library = { clipAssociations: { aaaaaaaa: { dumpId: "d1" }, bbbbbbbb: { dumpId: "d2" } } };
  const clips = [
    { runtimeId: 1, name: "Keep [sx:aaaaaaaa]" }, // has assoc
    { runtimeId: 2, name: "New [sx:cccccccc]" },  // tagged, no assoc
  ];
  const o = id.detectOrphans(clips, library);
  eq(o.orphanAssociations.length, 1, "one orphan association (bbbbbbbb, no clip)");
  eq(o.orphanAssociations[0], "bbbbbbbb", "orphan is bbbbbbbb");
  eq(o.untaggedReferences.length, 1, "one clip uuid with no association");
  eq(o.untaggedReferences[0], "cccccccc", "untagged ref is cccccccc");
})();

// ---- dump-hash carried in the clip name [sx:uuid:hash] ---------------------
(function () {
  eq(id.makeTag("1a2b3c4d"), "[sx:1a2b3c4d]", "makeTag without hash");
  eq(id.makeTag("1a2b3c4d", "f20df031"), "[sx:1a2b3c4d:f20df031]", "makeTag with hash");
  eq(id.extractUuid("Riff [sx:1a2b3c4d:f20df031]"), "1a2b3c4d", "extract uuid when hash present");
  eq(id.extractDumpRef("Riff [sx:1a2b3c4d:f20df031]"), "f20df031", "extract dump hash");
  eq(id.extractDumpRef("Riff [sx:1a2b3c4d]"), null, "no hash -> null");
  eq(id.extractDumpRef("plain"), null, "untagged -> null hash");
  eq(id.stripTag("Riff [sx:1a2b3c4d:f20df031]"), "Riff", "stripTag removes uuid+hash tag");

  const mint = counterMint();
  const r = id.setDumpRef("Lead", "abcd1234", mint);
  eq(r.name, "Lead [sx:00000001:abcd1234]", "setDumpRef mints uuid + attaches hash");
  eq(r.hash, "abcd1234", "setDumpRef returns hash");
  const r2 = id.setDumpRef(r.name, "99887766", mint);
  eq(r2.name, "Lead [sx:00000001:99887766]", "setDumpRef replaces hash, keeps uuid");
  const r3 = id.setDumpRef(r2.name, null, mint);
  eq(r3.name, "Lead [sx:00000001]", "setDumpRef(null) clears hash, keeps identity");
})();

// ---- reconcile preserves the dump hash through a duplicate -----------------
(function () {
  const mint = counterMint();
  const a = id.setDumpRef("Bass", "f20df031", mint); // 00000001 + hash
  const clipA = { runtimeId: 1, name: a.name };
  const clipB = { runtimeId: 2, name: a.name }; // duplicate: same name+uuid+hash
  const res = id.reconcile([clipA, clipB], { clipAssociations: {} }, mint);
  eq(res.collisions, 1, "duplicate-with-hash collides");
  const uuidA = id.extractUuid(clipA.name), uuidB = id.extractUuid(clipB.name);
  ok(uuidB !== uuidA, "duplicate re-minted to a new uuid");
  eq(id.extractDumpRef(clipA.name), "f20df031", "original keeps its dump hash");
  eq(id.extractDumpRef(clipB.name), "f20df031", "duplicate KEEPS the same dump hash (both want the patch)");
})();

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
