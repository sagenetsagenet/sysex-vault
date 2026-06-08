"use strict";
// Generate src/manufacturers.js directly from the MIDI Association's public
// SysEx ID registry at https://midi.org/sysexidtable.
//
// This is an INDEPENDENT compilation by SAGENET, scraped from the public MMA
// registry. It does not derive from any third-party tabularization, and carries
// no GPL-3.0 (or other) inherited license. The underlying data are factual
// manufacturer-ID assignments published by the MIDI Association.
//
// Run: node scripts/scrape_mma.js
//   --html <path>   parse a local HTML capture instead of fetching live
//   --check         do not write; diff against existing src/manufacturers.js
const fs = require("fs");
const path = require("path");

const SRC_URL = "https://midi.org/sysexidtable";
const OUT = path.join(__dirname, "..", "src", "manufacturers.js");

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// Normalize typographic punctuation to ASCII so the generated data file stays
// clean and portable (these are display names; matching is by ID key).
function normalizePunct(s) {
  return s
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ");
}

function stripTags(s) {
  return normalizePunct(decodeEntities(s.replace(/<[^>]*>/g, ""))).trim();
}

function parseTable(html) {
  const tblMatch = html.match(/<table[\s\S]*?<\/table>/i);
  if (!tblMatch) throw new Error("no <table> found in source HTML");
  const rows = tblMatch[0].match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const pairs = [];
  for (const row of rows) {
    const cells = (row.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map(stripTags);
    if (cells.length < 2) continue;
    pairs.push([cells[0], cells[1]]);
  }
  return pairs;
}

// Same normalization + filtering rules the project has always used:
// drop the header row, bracketed reserved/extension markers, ID ranges, and
// any ID field that is not a clean run of 1-2 hex bytes.
function buildMap(pairs) {
  const map = {};
  const dupes = [];
  let skipped = 0;
  for (const [idField0, name0] of pairs) {
    const idField = (idField0 || "").trim();
    const name = (name0 || "").trim();
    if (!idField || !name) { skipped++; continue; }
    if (/sysex id number/i.test(idField)) { skipped++; continue; } // header
    if (name[0] === "[" || idField[0] === "[") { skipped++; continue; } // reserved/extension
    if (/\bto\b/i.test(idField)) { skipped++; continue; } // ranges

    const tokens = idField.split(/\s+/).map((t) => t.replace(/H$/i, "").toUpperCase());
    if (!tokens.every((t) => /^[0-9A-F]{1,2}$/.test(t))) { skipped++; continue; }
    const key = tokens.map((t) => t.padStart(2, "0")).join("");

    if (map[key] && map[key] !== name) dupes.push([key, map[key], name]);
    map[key] = name;
  }
  return { map, dupes, skipped };
}

function render(map) {
  const keys = Object.keys(map).sort();
  const body = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(map[k])},`).join("\n");
  return `"use strict";
// AUTO-GENERATED — do not hand-edit. Regenerate: node scripts/scrape_mma.js
// Full MIDI Manufacturer SysEx ID table, ${keys.length} entries.
// Source: MIDI Association public registry, https://midi.org/sysexidtable.
// Independent compilation by SAGENET. No third-party tabularization; no GPL-3.0
// dependency. Keyed by uppercase hex of the ID bytes ("41" 1-byte; "00203C"
// 3-byte). Universal IDs 7D/7E/7F are handled in sysex.js, not here.
module.exports = {
${body}
};
`;
}

async function getHtml() {
  const argHtml = process.argv.indexOf("--html");
  if (argHtml !== -1 && process.argv[argHtml + 1]) {
    return fs.readFileSync(process.argv[argHtml + 1], "utf8");
  }
  const res = await fetch(SRC_URL, { headers: { "User-Agent": "Mozilla/5.0 (SAGENET build)" } });
  if (!res.ok) throw new Error(`fetch ${SRC_URL} -> HTTP ${res.status}`);
  return res.text();
}

(async () => {
  const html = await getHtml();
  const pairs = parseTable(html);
  const { map, dupes, skipped } = buildMap(pairs);
  const out = render(map);
  const count = Object.keys(map).length;

  if (process.argv.includes("--check")) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
    const stripHeader = (s) => s.replace(/^[\s\S]*?module\.exports = \{/, "module.exports = {");
    const same = stripHeader(cur) === stripHeader(out);
    console.log(`scraped ${count} manufacturers, skipped ${skipped} non-data rows, ${dupes.length} dupes.`);
    console.log(`table body matches existing src/manufacturers.js: ${same}`);
    if (!same) {
      // show a quick line-level diff of the data bodies
      const a = stripHeader(cur).split("\n");
      const b = stripHeader(out).split("\n");
      const setA = new Set(a), setB = new Set(b);
      const onlyCur = a.filter((l) => !setB.has(l) && l.includes(":"));
      const onlyNew = b.filter((l) => !setA.has(l) && l.includes(":"));
      console.log(`  only in existing (${onlyCur.length}):`); onlyCur.slice(0, 40).forEach((l) => console.log("   -" + l));
      console.log(`  only in scraped  (${onlyNew.length}):`); onlyNew.slice(0, 40).forEach((l) => console.log("   +" + l));
    }
    process.exit(same ? 0 : 1);
  }

  fs.writeFileSync(OUT, out);
  console.log(`Wrote ${OUT}: ${count} manufacturers, skipped ${skipped} non-data rows.`);
  if (dupes.length) {
    console.log(`Duplicate keys (last wins): ${dupes.length}`);
    dupes.slice(0, 10).forEach((d) => console.log(`  ${d[0]}: "${d[1]}" -> "${d[2]}"`));
  }
})().catch((e) => { console.error(e.message); process.exit(2); });
