"use strict";
// Generate src/manufacturers.js from the MMA manufacturer SysEx ID CSV.
// Source CSV: https://github.com/insolace/MIDI-Sysex-MFG-IDs (GPL-3.0), a
// tabularization of the publicly available MMA registry. Run: node scripts/gen_manufacturers.js
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "data", "mma_mfg_ids_raw.csv");
const OUT = path.join(__dirname, "..", "src", "manufacturers.js");

// minimal RFC-4180-ish CSV line parser (handles quoted fields w/ commas + "" escapes)
function parseLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

let raw = fs.readFileSync(SRC, "utf8");
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // strip BOM
const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);

const map = {};
const dupes = [];
let skipped = 0;
for (let i = 1; i < lines.length; i++) {
  const f = parseLine(lines[i]);
  const idField = (f[0] || "").trim();
  const name = (f[1] || "").trim();
  if (!idField || !name) { skipped++; continue; }
  if (name[0] === "[" || idField[0] === "[") { skipped++; continue; } // reserved/extension
  if (/\bto\b/i.test(idField)) { skipped++; continue; }              // ranges

  // id like "41H" or "00H 20H 3CH" -> "41" / "00203C"
  const tokens = idField.split(/\s+/).map((t) => t.replace(/H$/i, "").toUpperCase());
  if (!tokens.every((t) => /^[0-9A-F]{1,2}$/.test(t))) { skipped++; continue; }
  const key = tokens.map((t) => t.padStart(2, "0")).join("");

  if (map[key] && map[key] !== name) dupes.push([key, map[key], name]);
  map[key] = name;
}

const keys = Object.keys(map).sort();
const body = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(map[k])},`).join("\n");
const header = `"use strict";
// AUTO-GENERATED — do not hand-edit. Regenerate: node scripts/gen_manufacturers.js
// Full MIDI Manufacturer SysEx ID table, ${keys.length} entries.
// Source: https://github.com/insolace/MIDI-Sysex-MFG-IDs (GPL-3.0), a
// tabularization of the publicly available MMA registry. Keyed by uppercase hex
// of the ID bytes ("41" 1-byte; "00203C" 3-byte). Universal IDs 7D/7E/7F are
// handled in sysex.js, not here.
module.exports = {
${body}
};
`;
fs.writeFileSync(OUT, header);
console.log(`Wrote ${OUT}: ${keys.length} manufacturers, skipped ${skipped} non-data rows.`);
if (dupes.length) {
  console.log(`Duplicate keys (last wins): ${dupes.length}`);
  dupes.slice(0, 10).forEach((d) => console.log(`  ${d[0]}: "${d[1]}" -> "${d[2]}"`));
}
