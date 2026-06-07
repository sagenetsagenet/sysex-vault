"use strict";
// ============================================================================
// SysEx library + clip-association store  —  the device "brain"
//
// Pure logic (Buffer for base64), Node-for-Max compatible. Verified by
// test/library.test.js. Holds the project-local library that the M4L device
// persists into the .als (via Dict). Content-addressed dumps (dedupe by hash),
// clipUUID -> dumpId associations (copy-on-write friendly, see identity.js), and
// the send-on-launch dedupe (don't re-transmit a patch the port already holds).
// ============================================================================

const sysex = require("./sysex.js");
const identity = require("./identity.js");

const SCHEMA_VERSION = 1;

// Small, fast content hash for dedupe + dumpId (FNV-1a 32-bit -> 8 hex).
function hashBytes(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i] & 0xff;
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ("0000000" + h.toString(16)).slice(-8);
}

function toBytes(x) {
  if (Array.isArray(x)) return x;
  if (Buffer.isBuffer(x)) return Array.prototype.slice.call(x);
  if (x && typeof x.length === "number") return Array.prototype.slice.call(x);
  return [];
}
function b64encode(bytes) {
  return Buffer.from(bytes).toString("base64");
}
function b64decode(str) {
  return Array.prototype.slice.call(Buffer.from(str, "base64"));
}

function createLibrary() {
  return { schemaVersion: SCHEMA_VERSION, sysexLibrary: {}, clipAssociations: {} };
}

// Add a dump (raw bytes) to the library. Content-addressed: identical bytes
// dedupe to the same entry. Returns { dumpId, info, deduped }.
function addDump(lib, rawBytes, opts) {
  opts = opts || {};
  const bytes = toBytes(rawBytes);
  const id = "dump_" + hashBytes(bytes);
  if (lib.sysexLibrary[id]) {
    return { dumpId: id, info: lib.sysexLibrary[id], deduped: true };
  }
  const ident = sysex.identifyDump(bytes);
  const entry = {
    id,
    sysexData: b64encode(bytes),
    byteSize: bytes.length,
    checksum: hashBytes(bytes),
    messageCount: ident.messageCount,
    manufacturer: ident.manufacturer,
    manufacturerShort: ident.manufacturerShort,
    manufacturerId: ident.manufacturerId,
    deviceModel: ident.deviceModel,
    patchName: ident.patchName,
    name: sysex.buildDumpName(opts.trackName || "Track", ident),
    timestamp: opts.timestamp || null, // caller stamps (no Date in module)
    origin: opts.origin || "received",
    sourceFile: opts.sourceFile || null,
  };
  lib.sysexLibrary[id] = entry;
  return { dumpId: id, info: entry, deduped: false };
}

function getDumpBytes(lib, dumpId) {
  const e = lib.sysexLibrary[dumpId];
  return e ? b64decode(e.sysexData) : null;
}

// Associate a clip (by its persistent UUID) with a dump.
function associate(lib, clipUuid, dumpId, opts) {
  opts = opts || {};
  lib.clipAssociations[clipUuid] = Object.assign(
    {},
    lib.clipAssociations[clipUuid],
    { clipUuid, dumpId, sendOnLaunch: opts.sendOnLaunch !== false },
    opts.destinationPort ? { destinationPort: opts.destinationPort } : {},
    opts.trackName ? { lastSeenTrackName: opts.trackName } : {}
  );
  return lib.clipAssociations[clipUuid];
}

function getAssociation(lib, clipUuid) {
  return lib.clipAssociations[clipUuid] || null;
}
function getDumpForClip(lib, clipUuid) {
  const a = lib.clipAssociations[clipUuid];
  if (!a || !a.dumpId) return null;
  return lib.sysexLibrary[a.dumpId] || null;
}

// Import a .syx (raw bytes) and add it; returns addDump result.
function importSyx(lib, rawBytes, opts) {
  opts = Object.assign({ origin: "imported" }, opts || {});
  return addDump(lib, rawBytes, opts);
}
// Export a dump's raw bytes (e.g. to write a .syx file).
function exportDump(lib, dumpId) {
  return getDumpBytes(lib, dumpId);
}

// ---- send-on-launch dedupe -------------------------------------------------
// loadedState: { <port>: <dumpId> } — what each port currently holds (runtime,
// not persisted). Decide whether a launch needs to transmit.
function shouldSend(loadedState, port, dumpId) {
  if (!dumpId) return false;
  return (loadedState[port] || null) !== dumpId;
}
function markSent(loadedState, port, dumpId) {
  loadedState[port] = dumpId;
}

// Decide what a clip launch should do, from the clip's NAME (the LiveAPI side
// only reads the name and the loadedState; all logic is here so it's testable).
// Returns { action: "send"|"skip"|"none", reason, dumpId?, port? }.
function decideLaunch(lib, clipName, loadedState) {
  const uuid = identity.extractUuid(clipName);
  if (!uuid) return { action: "none", reason: "untagged" };
  const a = getAssociation(lib, uuid);
  if (!a || !a.dumpId) return { action: "none", reason: "no-association" };
  if (a.sendOnLaunch === false) return { action: "none", reason: "send-disabled" };
  const port = a.destinationPort || null;
  if (port && !shouldSend(loadedState, port, a.dumpId)) {
    return { action: "skip", reason: "already-loaded", dumpId: a.dumpId, port };
  }
  return { action: "send", reason: "ok", dumpId: a.dumpId, port };
}

// ---- persistence (Dict <-> object) -----------------------------------------
function serialize(lib) {
  return JSON.stringify(lib);
}
function deserialize(json) {
  if (!json) return createLibrary();
  const obj = typeof json === "string" ? JSON.parse(json) : json;
  obj.schemaVersion = obj.schemaVersion || SCHEMA_VERSION;
  obj.sysexLibrary = obj.sysexLibrary || {};
  obj.clipAssociations = obj.clipAssociations || {};
  return obj;
}

// Library browser rows for the UI.
function listDumps(lib) {
  return Object.keys(lib.sysexLibrary).map((id) => {
    const e = lib.sysexLibrary[id];
    return { dumpId: id, name: e.name, manufacturer: e.manufacturerShort, model: e.deviceModel, byteSize: e.byteSize };
  });
}

module.exports = {
  SCHEMA_VERSION,
  hashBytes,
  b64encode,
  b64decode,
  createLibrary,
  addDump,
  getDumpBytes,
  associate,
  getAssociation,
  getDumpForClip,
  decideLaunch,
  importSyx,
  exportDump,
  shouldSend,
  markSent,
  serialize,
  deserialize,
  listDumps,
};
