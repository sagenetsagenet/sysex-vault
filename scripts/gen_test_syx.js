"use strict";
// Generate a spec-valid Yamaha DX7 VCED (single-voice) .syx file with a real
// voice name + correct checksum — a concrete payload for the machine spikes
// (import / transmit) and to exercise the parser on a real file from disk.
const fs = require("fs");
const path = require("path");

const VOICE_NAME = "TEST LEAD1"; // exactly 10 chars (DX7 voice name field)

// 155-byte VCED data block; name occupies the last 10 bytes (offsets 145..154).
const data = new Array(155).fill(0x00);
// plausible-ish operator/envelope bytes so it's not all zeros (cosmetic)
for (let i = 0; i < 145; i++) data[i] = (i * 7) % 100;
for (let i = 0; i < 10; i++) data[145 + i] = VOICE_NAME.charCodeAt(i);

// Yamaha checksum: two's-complement of the 7-bit sum of the data bytes.
let sum = 0;
for (const b of data) sum = (sum + b) & 0xff;
const checksum = (128 - (sum & 0x7f)) & 0x7f;

const bytes = [0xf0, 0x43, 0x00, 0x00, 0x01, 0x1b, ...data, checksum, 0xf7];

const out = path.join(__dirname, "..", "data", "test-dx7-vced.syx");
fs.writeFileSync(out, Buffer.from(bytes));
console.log(`Wrote ${out} (${bytes.length} bytes), voice "${VOICE_NAME}", checksum 0x${checksum.toString(16)}`);
