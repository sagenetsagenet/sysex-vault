"use strict";
// ============================================================================
// Preset index  —  Sysex Vault
//
// A "preset" = a saved SysEx dump, recalled by a human name. The dump bytes live
// in the content-addressed store (store.js, keyed by hash); this module is the
// thin NAME -> hash index on top of it, so the dashboard dropdown can list and
// recall dumps by name. Persisted as an ORDERED list at <baseDir>/presets.json:
//     { "presets": [ { "name": "Lead Bass", "hash": "1a2b3c4d" }, ... ] }
// Order = menu order. Pure fs + JSON; runs as-is inside Node-for-Max.
// Verified by test/presets.test.js.
// ============================================================================

const fs = require("fs");
const path = require("path");

function indexPath(baseDir) { return path.join(baseDir, "presets.json"); }

// Read the ordered preset list (always an array; tolerant of a missing/garbage file).
function load(baseDir) {
  try {
    const j = JSON.parse(fs.readFileSync(indexPath(baseDir), "utf8"));
    const arr = Array.isArray(j) ? j : (j && j.presets) || [];
    return arr
      .filter((p) => p && p.name && p.hash)
      .map((p) => ({ name: String(p.name), hash: String(p.hash).toLowerCase() }));
  } catch (e) { return []; }
}

function save(baseDir, list) {
  fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(indexPath(baseDir), JSON.stringify({ presets: list }, null, 2));
  return list;
}

function names(baseDir) { return load(baseDir).map((p) => p.name); }

// SAVE: upsert by exact name. If the name exists, repoint it at the new hash;
// otherwise append. Returns the new ordered list.
function add(baseDir, name, hash) {
  name = String(name).trim();
  const list = load(baseDir);
  const i = list.findIndex((p) => p.name === name);
  if (i >= 0) list[i].hash = String(hash).toLowerCase();
  else list.push({ name, hash: String(hash).toLowerCase() });
  return save(baseDir, list);
}

// Pick a name not already in `list`: "Bass" -> "Bass 2" -> "Bass 3" ...
function uniqueName(list, base) {
  base = String(base).trim();
  if (!list.some((p) => p.name === base)) return base;
  let n = 2;
  while (list.some((p) => p.name === base + " " + n)) n++;
  return base + " " + n;
}

// SAVE AS: always create a NEW entry (never overwrite). Returns { list, name }.
function addAs(baseDir, name, hash) {
  const list = load(baseDir);
  const nm = uniqueName(list, name);
  list.push({ name: nm, hash: String(hash).toLowerCase() });
  return { list: save(baseDir, list), name: nm };
}

function entryAt(baseDir, idx) {
  const list = load(baseDir);
  idx = idx | 0;
  return idx >= 0 && idx < list.length ? list[idx] : null;
}
function hashAt(baseDir, idx) { const e = entryAt(baseDir, idx); return e ? e.hash : null; }
function nameAt(baseDir, idx) { const e = entryAt(baseDir, idx); return e ? e.name : null; }

function hashOf(baseDir, name) {
  const p = load(baseDir).find((x) => x.name === String(name));
  return p ? p.hash : null;
}

function remove(baseDir, name) {
  return save(baseDir, load(baseDir).filter((p) => p.name !== String(name)));
}

module.exports = {
  indexPath, load, save, names, add, addAs, uniqueName,
  entryAt, hashAt, nameAt, hashOf, remove,
};
