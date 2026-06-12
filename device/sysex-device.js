"use strict";
// ============================================================================
// Sysex Vault — Node-for-Max device script (runs in [node.script])
//
// PER-TRACK model. The device sits on a MIDI track, BEFORE its External Instrument.
//   • CAPTURE: [sysexin] (track input) -> here -> content-addressed file store.
//   • PARK:    when armed + a dump arrives, ask liveglue.js for set-wide [sx:] bars,
//              pick a staggered bar, and have liveglue create+name a clip on the track.
//   • PLAY:    liveglue sees the playhead enter a parked clip -> sends its NAME here ->
//              we read [sx:uuid:hash], load the dump, and emit it via [midiout] (no
//              port = downstream into the chain -> External Instrument -> synth).
// No .als persistence, no port management. All logic is in the TESTED ../src modules.
// ============================================================================

const Max = require("max-api");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sysex = require("../src/sysex.js");
const identity = require("../src/identity.js");
const store = require("../src/store.js");
const placement = require("../src/placement.js");
const presets = require("../src/presets.js");

const STORE_DIR = path.join(os.homedir(), "Music", "Ableton", "User Library", "Sysex Vault", "dumps");

let armed = false;
let lastHash = null;        // most-recent dump (for the manual transmitlast button)
let pendingPark = null;     // { hash, byteSize, base } awaiting liveglue's "bars" reply
let rx = null;              // F0..F7 accumulation buffer
let pendingName = "";       // last name typed in the dashboard text field (for SAVE/SAVE AS)
let currentHash = null;     // preset selected in the dropdown (what SEND PATCH transmits)

// ---- transmit speed (bytes/sec). Index from the UI live.tab. ---------------
// 3125 B/s = full standard-MIDI bandwidth (31.25 kbaud / 10 bits per byte).
const TX_RATES = [1562, 3125, 6250, 12500];   // VINTAGE ½× / STANDARD 1× / FAST 2× / TURBO 4×
let txRate = 3125;                              // default = STANDARD

function status(s) { Max.outlet("status", s); }

// Split a byte stream into complete F0..F7 SysEx messages (a "dump" may be a bank
// of several). Each must be sent WHOLE — splitting inside one corrupts it.
function splitMessages(bytes) {
  const msgs = []; let cur = null;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] & 0xff;
    if (b === 0xf0) cur = [0xf0];
    else if (cur) cur.push(b);
    if (b === 0xf7 && cur) { msgs.push(cur); cur = null; }
  }
  if (cur && cur.length) msgs.push(cur);        // tolerate an unterminated tail
  return msgs;
}

// Send a dump paced to txRate: emit each COMPLETE message, then wait long enough
// for it to clear at the chosen rate before the next. A single-message dump sends
// in one piece (no delay), exactly like an un-throttled send.
function sendThrottled(bytes) {
  const msgs = splitMessages(bytes);
  if (!msgs.length) return;
  let i = 0;
  (function next() {
    const m = msgs[i++];
    Max.outlet("sysex", ...m);                   // one complete F0..F7 -> [route] -> [midiout]
    if (i < msgs.length) setTimeout(next, Math.max(1, (m.length / txRate) * 1000));
  })();
}

// ---- capture ---------------------------------------------------------------
function onByte(b) {
  b = b & 0xff;
  if (b === 0xf0) { rx = [0xf0]; return; }
  if (rx === null) rx = [];                                  // tolerate missing leading F0
  rx.push(b);
  if (b === 0xf7) {
    let bytes = rx; rx = null;
    if (bytes[0] !== 0xf0) bytes = [0xf0].concat(bytes);
    finishReceive(bytes);
  }
}

// Kick off the park flow: ask liveglue for set-wide bars; onBars makes the clip.
function park(hash, byteSize, base) {
  pendingPark = { hash, byteSize, base: base || "SysEx" };
  Max.outlet("needbars");                                     // -> liveglue gathers set-wide bars
  Max.post(`[sysex] parking… (gathering bars)`);
}

function finishReceive(bytes) {
  const info = sysex.identifyDump(bytes);
  const r = store.put(STORE_DIR, bytes);
  lastHash = r.hash;
  Max.post(`[sysex] received ${bytes.length} bytes — ${info.manufacturerShort} ${info.patchName || ""} -> dump ${r.hash}${r.deduped ? " (dedupe)" : ""}`);
  status("RX " + (info.patchName || info.manufacturerShort || r.hash));
  if (armed) {                                                 // received dumps only park when armed
    armed = false;
    park(r.hash, bytes.length, info.patchName || info.manufacturerShort);
  }
}

// ---- park: liveglue replied with every [sx:] clip bar in the Set ------------
function onBars(...bars) {
  if (!pendingPark) return;
  const bar = placement.nextStaggerBar(bars, { dumpBytes: pendingPark.byteSize });
  const uuid = identity.defaultMint();
  const name = pendingPark.base + " " + identity.makeTag(uuid, pendingPark.hash);
  Max.outlet("createclip", bar, name);                        // -> liveglue creates+names the clip
  Max.post(`[sysex] parking dump ${pendingPark.hash} at bar ${bar} as "${name}"`);
  status("PARKED bar " + bar);
  pendingPark = null;
}

// ---- play: liveglue says a parked clip's bar is now playing -----------------
function onLaunch(...parts) {
  const clipName = parts.join(" ");
  const hash = identity.extractDumpRef(clipName);
  if (!hash) { Max.post(`[sysex] launch: clip has no dump ref (${clipName})`); return; }
  const bytes = store.get(STORE_DIR, hash);
  if (!bytes) { Max.post(`[sysex] launch: dump ${hash} not in store`); return; }
  sendThrottled(bytes);                                       // paced to txRate -> [midiout] downstream
  Max.post(`[sysex] sent dump ${hash} @ ${txRate} B/s (clip "${clipName}")`);
  status("SENT " + hash);
}

// ---- handlers --------------------------------------------------------------
Max.addHandler("byte", onByte);
Max.addHandler("bars", onBars);
Max.addHandler("launch", onLaunch);
Max.addHandler("arm", () => { armed = true; rx = null; Max.post("[sysex] ARMED — send a dump from the synth"); status("ARMED"); });
Max.addHandler("disarm", () => { armed = false; Max.post("[sysex] disarmed"); status("IDLE"); });
Max.addHandler("speed", (idx) => {
  txRate = TX_RATES[idx | 0] || 3125;
  Max.post(`[sysex] tx speed = ${txRate} B/s`);
  status("SPEED " + txRate);
});
// EXPORT the last buffer (most-recent captured/imported dump) to a .syx file.
Max.addHandler("exportlast", (filePath) => {
  if (!filePath || filePath === "cancel") return;
  if (!lastHash) { Max.post("[sysex] export: nothing in the buffer yet"); status("NO BUFFER"); return; }
  const bytes = store.get(STORE_DIR, lastHash);
  if (!bytes) return Max.post(`[sysex] export: dump ${lastHash} missing`);
  let p = String(filePath);
  if (!/\.syx$/i.test(p)) p += ".syx";
  try { fs.writeFileSync(p, Buffer.from(bytes)); Max.post(`[sysex] exported ${lastHash} -> ${p}`); status("EXPORTED " + lastHash); }
  catch (e) { Max.post(`[sysex] export failed: ${e}`); }
});

// manual ops (UI / debugging)
// IMPORT a .syx -> store it AND park a clip (importing is explicit, so always parks).
Max.addHandler("import", (filePath) => {
  try {
    if (!filePath || filePath === "cancel") return;
    const bytes = Array.prototype.slice.call(fs.readFileSync(filePath));
    const info = sysex.identifyDump(bytes);
    const r = store.put(STORE_DIR, bytes);
    lastHash = r.hash;
    Max.post(`[sysex] imported ${info.manufacturerShort} ${info.patchName || ""} (${bytes.length} b) -> dump ${r.hash}${r.deduped ? " (dedupe)" : ""}`);
    status("IMPORT " + (info.patchName || r.hash));
    park(r.hash, bytes.length, info.patchName || info.manufacturerShort || "Import");
  } catch (e) { Max.post(`[sysex] import failed: ${e}`); }
});
Max.addHandler("export", (hash, filePath) => {
  try {
    const bytes = store.get(STORE_DIR, hash);
    if (!bytes) return Max.post(`[sysex] export: no dump ${hash}`);
    fs.writeFileSync(filePath, Buffer.from(bytes));
    Max.post(`[sysex] exported ${hash} -> ${filePath}`);
  } catch (e) { Max.post(`[sysex] export failed: ${e}`); }
});
Max.addHandler("transmit", (hash) => onLaunch(`x [sx:00000000:${hash}]`));
Max.addHandler("transmitlast", () => {
  if (!lastHash) return Max.post("[sysex] transmitlast: nothing captured yet");
  onLaunch(`x [sx:00000000:${lastHash}]`);
});

// ---- presets: a preset = a saved dump, recalled by name --------------------
// Repopulate the dashboard dropdown ([umenu]) from the on-disk preset index.
// "menu clear" / "menu append <name>" -> [route menu] -> [umenu].
function pushMenu() {
  Max.outlet("menu", "clear");
  presets.names(STORE_DIR).forEach((n) => Max.outlet("menu", "append", n));
}
// the dashboard text field reports what's typed; SAVE/SAVE AS consume it.
Max.addHandler("setname", (...parts) => { pendingName = parts.join(" ").trim(); });
// SAVE: store the last captured/imported dump under the typed name (upsert).
Max.addHandler("savepreset", () => {
  if (!lastHash) { Max.post("[sysex] save: nothing captured yet"); return status("NO BUFFER"); }
  if (!pendingName) { Max.post("[sysex] save: type a name first"); return status("NAME?"); }
  presets.add(STORE_DIR, pendingName, lastHash);
  pushMenu();
  Max.post(`[sysex] saved preset "${pendingName}" -> ${lastHash}`);
  status("SAVED " + pendingName);
});
// SAVE AS: like SAVE but never overwrite — collisions get " 2", " 3", ...
Max.addHandler("savepresetas", () => {
  if (!lastHash) { Max.post("[sysex] save as: nothing captured yet"); return status("NO BUFFER"); }
  if (!pendingName) { Max.post("[sysex] save as: type a name first"); return status("NAME?"); }
  const r = presets.addAs(STORE_DIR, pendingName, lastHash);
  pushMenu();
  Max.post(`[sysex] saved preset as "${r.name}" -> ${lastHash}`);
  status("SAVED " + r.name);
});
// dropdown select: set the current preset (SEND PATCH transmits this). No send here.
Max.addHandler("selectpreset", (idx) => {
  const e = presets.entryAt(STORE_DIR, idx | 0);
  if (!e) { currentHash = null; return; }
  currentHash = e.hash;
  Max.post(`[sysex] selected preset "${e.name}" (${e.hash})`);
  status("SEL " + e.name);
});
// SEND PATCH: transmit the selected preset, falling back to the last dump.
Max.addHandler("sendcurrent", () => {
  const hash = currentHash || lastHash;
  if (!hash) { Max.post("[sysex] send: no preset selected and nothing captured"); return status("NO PRESET"); }
  onLaunch(`x [sx:00000000:${hash}]`);
});
Max.addHandler("list", () => {
  const rows = store.list(STORE_DIR).map((h) => {
    const bytes = store.get(STORE_DIR, h);
    const info = bytes ? sysex.identifyDump(bytes) : {};
    return { hash: h, mfr: info.manufacturerShort, patch: info.patchName, bytes: bytes ? bytes.length : 0 };
  });
  Max.post(`[sysex] store: ${rows.length} dump(s) at ${STORE_DIR}`);
  rows.forEach((r) => Max.post(`   ${r.hash}  ${r.mfr || "?"}  ${r.patch || "-"}  ${r.bytes}b`));
  Max.outlet("list", JSON.stringify(rows));
  status("LIB " + rows.length + " dumps");
});

// duplicate reconciliation: liveglue writes Dict "reconcileClips" then sends "reconcile".
// We re-mint colliding UUIDs (keep the hash) AND assign a fresh staggered bar so the
// duplicate doesn't sit on top of the original; liveglue applies names + moves.
Max.addHandler("reconcile", async () => {
  try {
    const d = await Max.getDict("reconcileClips");
    const clips = (d && d.clips) || [];
    const res = identity.reconcile(clips, { clipAssociations: {} }, identity.defaultMint);
    // re-stagger every re-minted (duplicate) clip onto a fresh bar
    const usedBars = clips.map((c) => Math.round((c.start || 0) / 4) + 1);
    const renames = res.renames.map((r) => {
      const bar = placement.nextStaggerBar(usedBars);
      usedBars.push(bar);
      return { runtimeId: r.runtimeId, newName: r.newName, newBar: bar };
    });
    await Max.setDict("reconcileRenames", { renames: renames, tagged: res.tagged });
    Max.outlet("apply_renames");
    Max.post(`[sysex] reconcile: ${res.collisions} collision(s), ${renames.length} re-staggered`);
  } catch (e) { Max.post(`[sysex] reconcile failed: ${e}`); }
});

store.ensureDir(STORE_DIR);
const nDumps = store.list(STORE_DIR).length;
pushMenu();                                       // fill the dropdown from saved presets
Max.post(`[sysex] device ready — store ${STORE_DIR} (${nDumps} dump(s), ${presets.names(STORE_DIR).length} preset(s))`);
status("READY " + nDumps);
