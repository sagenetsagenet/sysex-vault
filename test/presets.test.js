"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const presets = require("../src/presets.js");

let pass = 0, fail = 0;
function ok(c, label) {
  if (c) { pass++; console.log("PASS " + label); }
  else { fail++; console.log("FAIL " + label); }
}
function eq(a, b, label) {
  ok(JSON.stringify(a) === JSON.stringify(b), label + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");
}

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), "sxpreset-"));

// empty store -> empty list
eq(presets.load(BASE), [], "empty index loads as []");
eq(presets.names(BASE), [], "empty names []");

// add (SAVE) appends in order, lowercases hash
presets.add(BASE, "Lead Bass", "AABBCCDD");
presets.add(BASE, "Pad", "11223344");
eq(presets.names(BASE), ["Lead Bass", "Pad"], "two presets in insertion order");
eq(presets.hashOf(BASE, "Lead Bass"), "aabbccdd", "hash stored lowercased");

// add same name = upsert (overwrite hash, keep position, no dupe)
presets.add(BASE, "Lead Bass", "99887766");
eq(presets.names(BASE), ["Lead Bass", "Pad"], "upsert keeps single entry + order");
eq(presets.hashOf(BASE, "Lead Bass"), "99887766", "upsert repointed hash");

// index by menu position
eq(presets.hashAt(BASE, 1), "11223344", "hashAt(1) = Pad");
eq(presets.nameAt(BASE, 0), "Lead Bass", "nameAt(0)");
eq(presets.hashAt(BASE, 9), null, "out-of-range index -> null");
eq(presets.hashAt(BASE, -1), null, "negative index -> null");

// SAVE AS never overwrites: collides -> " 2", " 3"
const a1 = presets.addAs(BASE, "Pad", "55555555");
eq(a1.name, "Pad 2", "addAs collides -> 'Pad 2'");
const a2 = presets.addAs(BASE, "Pad", "66666666");
eq(a2.name, "Pad 3", "addAs again -> 'Pad 3'");
eq(presets.names(BASE), ["Lead Bass", "Pad", "Pad 2", "Pad 3"], "addAs appended uniquely");

// trims whitespace on name
presets.add(BASE, "  Spacey  ", "abcdef01");
eq(presets.hashOf(BASE, "Spacey"), "abcdef01", "name trimmed");

// remove
presets.remove(BASE, "Pad 2");
eq(presets.names(BASE), ["Lead Bass", "Pad", "Pad 3", "Spacey"], "remove drops entry");

// persistence: a fresh load from disk sees the same data
eq(presets.load(BASE).length, 4, "reloads from disk");

// tolerant of a corrupt file
fs.writeFileSync(presets.indexPath(BASE), "{ not json ");
eq(presets.load(BASE), [], "corrupt index -> [] (no throw)");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
