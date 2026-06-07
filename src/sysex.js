"use strict";
// ============================================================================
// SysEx parser + MIDI Manufacturer ID table  —  SysEx Clip Manager
//
// Pure logic, no runtime deps (loads the generated manufacturers table),
// Node-for-Max compatible (CommonJS). Verified by test/sysex.test.js.
// Handles: splitting a raw dump into individual F0..F7 messages, manufacturer-ID
// extraction (1-byte / 3-byte extended / universal), short display names,
// best-effort device/patch-name extraction (pluggable per-model), and the
// "[Track] - [Manufacturer] - [Patch|Dump]" naming convention.
//
// The full manufacturer table (594 entries) lives in ./manufacturers.js,
// AUTO-GENERATED from the MMA registry (see scripts/gen_manufacturers.js).
// ============================================================================

const MANUFACTURERS = require("./manufacturers.js"); // hex key -> official name

// Universal / special IDs (not manufacturers).
const SPECIAL = {
  "7D": "Non-Commercial / Test",
  "7E": "Universal Non-Realtime",
  "7F": "Universal Realtime",
};

// Short, friendly display names for common makers (official names are verbose).
// Keyed by ID hex; everything else falls back to a light legal-suffix strip.
const DISPLAY_OVERRIDES = {
  "01": "Sequential", "04": "Moog", "06": "Lexicon", "07": "Kurzweil",
  "0F": "Ensoniq", "10": "Oberheim", "18": "E-mu", "3E": "Waldorf",
  "40": "Kawai", "41": "Roland", "42": "Korg", "43": "Yamaha", "44": "Casio",
  "47": "Akai", "00000E": "Alesis", "002029": "Novation", "002033": "Access",
  "00203C": "Elektron",
};
const LEGAL_SUFFIX =
  /\s*(,|\.)?\s*\b(corporation|corp\.?|company|co\.?|inc\.?|incorporated|ltd\.?|llc|gmbh|ab|kg|b\.?v\.?|s\.?a\.?|pty|plc)\b\.?$/i;
function shortenName(name) {
  let s = name;
  for (let i = 0; i < 4; i++) {
    const next = s.replace(LEGAL_SUFFIX, "").trim();
    if (next === s) break;
    s = next;
  }
  return s.replace(/[.,]\s*$/, "").trim() || name;
}
function displayName(idHex, officialName) {
  return DISPLAY_OVERRIDES[idHex] || shortenName(officialName);
}

const F0 = 0xf0;
const F7 = 0xf7;

function toArray(bytes) {
  if (Array.isArray(bytes)) return bytes;
  if (bytes && typeof bytes.length === "number") return Array.prototype.slice.call(bytes);
  return [];
}
function hex(bytes) {
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join("");
}

// Split a raw byte stream into individual SysEx messages (each F0..F7).
// Tolerant: skips bytes before an F0; a trailing F0 with no F7 is returned as a
// truncated message flagged complete:false.
function splitMessages(bytes) {
  const data = toArray(bytes);
  const messages = [];
  let i = 0;
  while (i < data.length) {
    if (data[i] !== F0) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < data.length && data[j] !== F7) j++;
    if (j < data.length) {
      messages.push({ bytes: data.slice(i, j + 1), complete: true });
      i = j + 1;
    } else {
      messages.push({ bytes: data.slice(i), complete: false });
      break;
    }
  }
  return messages;
}

// Read the manufacturer from a single F0..F7 message.
function readManufacturer(msg) {
  const b = toArray(msg);
  if (b[0] !== F0) return { kind: "invalid", idBytes: [], idHex: "", name: "Invalid (no F0)", short: "Invalid", known: false };
  const first = b[1];
  if (first === undefined) return { kind: "invalid", idBytes: [], idHex: "", name: "Empty", short: "Empty", known: false };

  // Universal / special.
  const spKey = first.toString(16).toUpperCase().padStart(2, "0");
  if (SPECIAL[spKey]) {
    return { kind: "universal", idBytes: [first], idHex: spKey, name: SPECIAL[spKey], short: SPECIAL[spKey], known: true };
  }

  // 3-byte extended ID (starts 0x00) vs 1-byte ID.
  const idBytes = first === 0x00 ? [0x00, b[2] ?? 0, b[3] ?? 0] : [first];
  const key = hex(idBytes);
  const name = MANUFACTURERS[key];
  return {
    kind: "standard",
    idBytes,
    idHex: key,
    name: name || "Unknown (" + key + ")",
    short: name ? displayName(key, name) : "Unknown",
    known: !!name,
  };
}

// ---- Per-model patch-name extractors (pluggable, best-effort) --------------
// NOTE: byte offsets follow published device specs; validate against real dumps.
function asciiClean(bytes) {
  return bytes
    .map((c) => (c >= 0x20 && c <= 0x7e ? String.fromCharCode(c) : " "))
    .join("")
    .replace(/\s+$/g, "");
}

// Yamaha DX7: VCED single voice (155 data bytes, name = last 10) and
// VMEM 32-voice bank (128 bytes/voice packed, name = bytes 118..127 of voice 0).
function extractYamahaDX7(msg) {
  const b = toArray(msg);
  if (b[1] !== 0x43) return null;
  const format = b[3];
  if (format === 0x00) {
    const data = b.slice(6, b.length - 2);
    if (data.length < 155) return null;
    return { deviceModel: "DX7 (voice)", patchName: asciiClean(data.slice(145, 155)) };
  }
  if (format === 0x09) {
    const data = b.slice(6, b.length - 2);
    if (data.length < 128) return null;
    return { deviceModel: "DX7 (32-voice bank)", patchName: asciiClean(data.slice(118, 128)), isBank: true, voiceCount: 32 };
  }
  return null;
}

const MODEL_EXTRACTORS = [extractYamahaDX7];

function extractModelInfo(msg) {
  for (const fn of MODEL_EXTRACTORS) {
    try {
      const r = fn(msg);
      if (r) return r;
    } catch (_) {
      /* never let an extractor break identification */
    }
  }
  return null;
}

// ---- High-level: identify a dump (1+ messages) -----------------------------
function identifyDump(bytes) {
  const data = toArray(bytes);
  const msgs = splitMessages(data);
  const perMessage = msgs.map((m) => {
    const mfr = readManufacturer(m.bytes);
    const model = extractModelInfo(m.bytes);
    return {
      byteSize: m.bytes.length,
      complete: m.complete,
      manufacturer: mfr.name,
      manufacturerShort: mfr.short,
      manufacturerId: mfr.idHex,
      manufacturerKnown: mfr.known,
      kind: mfr.kind,
      deviceModel: model ? model.deviceModel : null,
      patchName: model ? model.patchName : null,
    };
  });
  const first = perMessage[0] || null;
  return {
    byteSize: data.length,
    messageCount: msgs.length,
    allComplete: msgs.every((m) => m.complete),
    manufacturer: first ? first.manufacturer : "None",
    manufacturerShort: first ? first.manufacturerShort : "None",
    manufacturerId: first ? first.manufacturerId : "",
    manufacturerKnown: first ? first.manufacturerKnown : false,
    deviceModel: (perMessage.find((m) => m.deviceModel) || {}).deviceModel || null,
    patchName: (perMessage.find((m) => m.patchName) || {}).patchName || null,
    messages: perMessage,
  };
}

// ---- Naming convention -----------------------------------------------------
// "[Track] - [Manufacturer] - [Patch]"  /  "[Track] - [Manufacturer] - Dump"
function buildDumpName(trackName, info) {
  const track = (trackName || "Track").trim();
  const mfr = (info && info.manufacturerShort) || "Unknown";
  const patch = info && info.patchName ? info.patchName.trim() : "";
  return track + " - " + mfr + " - " + (patch || "Dump");
}

module.exports = {
  MANUFACTURERS,
  SPECIAL,
  splitMessages,
  readManufacturer,
  extractModelInfo,
  identifyDump,
  buildDumpName,
  displayName,
  _hex: hex,
};
