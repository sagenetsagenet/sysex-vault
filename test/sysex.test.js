"use strict";
const sx = require("../src/sysex.js");

let pass = 0,
  fail = 0;
function ok(cond, label) {
  if (cond) {
    pass++;
    console.log("PASS " + label);
  } else {
    fail++;
    console.log("FAIL " + label);
  }
}
function eq(a, b, label) {
  ok(a === b, label + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");
}

// ---- helpers to synthesize messages ----------------------------------------
function msg(...bytes) {
  return bytes.flat();
}
function ascii(s, len) {
  const out = [];
  for (let i = 0; i < len; i++) out.push(i < s.length ? s.charCodeAt(i) : 0x20);
  return out;
}

// Roland-style 1-byte
const roland = msg(0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x01, 0xf7);
// Korg 1-byte
const korg = msg(0xf0, 0x42, 0x30, 0x36, 0x00, 0xf7);
// Novation 3-byte extended
const novation = msg(0xf0, 0x00, 0x20, 0x29, 0x01, 0x02, 0x03, 0xf7);
// Universal non-realtime
const universal = msg(0xf0, 0x7e, 0x00, 0x06, 0x01, 0xf7);
// Unknown id — 0x60 is in the reserved range, not an assigned manufacturer
const unknown = msg(0xf0, 0x60, 0x01, 0x02, 0xf7);

// ---- manufacturer detection ------------------------------------------------
eq(sx.readManufacturer(roland).name, "Roland Corporation", "Roland 1-byte 0x41 (official)");
eq(sx.readManufacturer(roland).idHex, "41", "Roland id hex");
eq(sx.readManufacturer(korg).name, "Korg Inc.", "Korg 0x42 (official)");
eq(sx.readManufacturer(novation).name, "Focusrite/Novation", "Novation 3-byte 00 20 29 (official)");
eq(sx.readManufacturer(novation).short, "Novation", "Novation short display name");
eq(sx.readManufacturer(novation).idHex, "002029", "Novation id hex");
eq(sx.readManufacturer(novation).kind, "standard", "Novation kind=standard");
eq(sx.readManufacturer(universal).kind, "universal", "Universal 0x7E kind");
eq(sx.readManufacturer(universal).name, "Universal Non-Realtime", "Universal name");
ok(!sx.readManufacturer(unknown).known, "Unassigned 0x60 -> known=false");
eq(sx.readManufacturer(unknown).name, "Unknown (60)", "Unassigned name shows raw id");

// full MMA table coverage + short display names
eq(sx.readManufacturer(roland).short, "Roland", "Roland short (from 'Roland Corporation')");
eq(sx.readManufacturer(korg).short, "Korg", "Korg short (from 'Korg Inc.')");
eq(sx.readManufacturer(msg(0xf0, 0x3e, 0x00, 0xf7)).short, "Waldorf", "Waldorf 0x3E short");
eq(sx.readManufacturer(msg(0xf0, 0x00, 0x20, 0x3c, 0x00, 0xf7)).name, "Elektron ESI AB", "Elektron 00 20 3C official");
eq(sx.readManufacturer(msg(0xf0, 0x00, 0x20, 0x3c, 0x00, 0xf7)).short, "Elektron", "Elektron short");
eq(sx.readManufacturer(msg(0xf0, 0x00, 0x20, 0x33, 0x00, 0xf7)).short, "Access", "Access 00 20 33 short");
ok(Object.keys(sx.MANUFACTURERS).length > 500, "full table loaded (>500 entries)");

// ---- multi-message splitting -----------------------------------------------
const dump2 = msg(roland, korg);
eq(sx.splitMessages(dump2).length, 2, "split two concatenated messages");
const withGarbage = msg([0x00, 0x12], roland, [0x34], korg);
eq(sx.splitMessages(withGarbage).length, 2, "split ignores non-F0 garbage between/around");
const truncated = msg(0xf0, 0x41, 0x10, 0x42); // no F7
eq(sx.splitMessages(truncated)[0].complete, false, "truncated message flagged complete:false");
eq(sx.splitMessages([0x01, 0x02, 0x03]).length, 0, "no F0 -> zero messages");

// ---- Yamaha DX7 VCED (single voice), name at data[145..154] ----------------
(function () {
  const name = "SYNBRASS 1"; // 10 chars
  const data = new Array(155).fill(0x00);
  ascii(name, 10).forEach((c, i) => (data[145 + i] = c));
  const vced = msg(0xf0, 0x43, 0x00, 0x00, 0x01, 0x1b, data, 0x00 /*sum*/, 0xf7);
  const info = sx.identifyDump(vced);
  eq(info.manufacturerShort, "Yamaha", "DX7 VCED -> Yamaha (short)");
  eq(info.manufacturer, "Yamaha Corporation", "DX7 VCED -> Yamaha (official)");
  eq(info.deviceModel, "DX7 (voice)", "DX7 VCED -> device model");
  eq(info.patchName, "SYNBRASS 1", "DX7 VCED -> patch name extracted");
})();

// ---- Yamaha DX7 VMEM (32-voice bank), voice0 name at data[118..127] --------
(function () {
  const name = "STRINGS 01"; // 10 chars
  const data = new Array(4096).fill(0x00);
  ascii(name, 10).forEach((c, i) => (data[118 + i] = c));
  const vmem = msg(0xf0, 0x43, 0x00, 0x09, 0x20, 0x00, data, 0x00 /*sum*/, 0xf7);
  const info = sx.identifyDump(vmem);
  eq(info.manufacturerShort, "Yamaha", "DX7 VMEM -> Yamaha (short)");
  eq(info.deviceModel, "DX7 (32-voice bank)", "DX7 VMEM -> device model");
  eq(info.patchName, "STRINGS 01", "DX7 VMEM -> first voice name extracted");
})();

// ---- identifyDump aggregate + naming ---------------------------------------
(function () {
  const info = sx.identifyDump(roland);
  eq(info.messageCount, 1, "identify roland messageCount");
  eq(info.manufacturerShort, "Roland", "identify roland manufacturer (short)");
  eq(sx.buildDumpName("Bass", info), "Bass - Roland - Dump", "naming: no patch -> Dump");

  const name = "SYNBRASS 1";
  const data = new Array(155).fill(0x00);
  ascii(name, 10).forEach((c, i) => (data[145 + i] = c));
  const vced = msg(0xf0, 0x43, 0x00, 0x00, 0x01, 0x1b, data, 0x00, 0xf7);
  const dxInfo = sx.identifyDump(vced);
  eq(sx.buildDumpName("Lead", dxInfo), "Lead - Yamaha - SYNBRASS 1", "naming: with patch name");
})();

// ---- empty / garbage -------------------------------------------------------
(function () {
  const info = sx.identifyDump([0x10, 0x20, 0x30]);
  eq(info.messageCount, 0, "garbage -> 0 messages");
  eq(info.manufacturer, "None", "garbage -> manufacturer None");
})();

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
