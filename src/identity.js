"use strict";
// ============================================================================
// Clip identity & duplicate reconciliation  —  SysEx Clip Manager
//
// SPIKE #3 (logic half). Live/SDK expose NO persistent clip ID, so we mint a
// UUID and embed it in the clip NAME — the only per-clip field that survives
// save/load + duplicate + machine transfer. Duplicating a clip copies the name
// => the UUID collides; this module detects collisions and re-mints, doing a
// COPY-ON-WRITE of the library association so the duplicate starts pointing at
// the same dump and then diverges independently.
//
// What this proves headless: the reconciliation ALGORITHM is correct and
// idempotent. What it CANNOT prove (needs Live): that the clip name actually
// survives Live's save/load + duplicate. That's spike #3's machine half.
//
// Pure logic, Node-for-Max compatible. Verified by test/identity.test.js.
// ============================================================================

// Tag embedded in the clip name. Visible-but-ignorable; the human part is free.
//   "My Riff [sx:1a2b3c4d]"          (clip identity only, no dump yet)
//   "My Riff [sx:1a2b3c4d:f20df031]" (identity + the content-hash of its dump)
// The optional 2nd field is the dump's hash — the clip's pointer into the
// content-addressed file store (store.js). Carrying it IN the name means the
// clip→dump association persists with the clip itself (no Live-Set dict needed,
// which doesn't work in Live 12 — spike 2). The hash travels through duplicate
// (both copies want the same patch); reconcile re-mints the uuid but KEEPS it.
// NOTE: ASCII square-bracket form. Live rejects the unicode ⟨ ⟩ angle brackets
// on clip-name entry (spike 3b, 2026-06-08), so the tag uses [sx:...] instead.
const TAG_RE = /\s*\[sx:([0-9a-f]{8})(?::([0-9a-f]{8}))?\]/i;

function makeTag(uuid, hash) {
  return "[sx:" + uuid + (hash ? ":" + hash : "") + "]";
}
function extractUuid(name) {
  const m = (name || "").match(TAG_RE);
  return m ? m[1].toLowerCase() : null;
}
// The dump-hash carried in the clip name, or null. This IS the clip→dump link.
function extractDumpRef(name) {
  const m = (name || "").match(TAG_RE);
  return m && m[2] ? m[2].toLowerCase() : null;
}
function stripTag(name) {
  return (name || "").replace(TAG_RE, "").trim();
}

// Set (or replace) the dump-hash on a clip name, minting a uuid if needed.
// Pass hash=null to clear the dump ref but keep the identity. Returns
// { name, uuid, hash, changed }.
function setDumpRef(name, hash, mint = defaultMint) {
  const t = ensureTagged(name, mint);
  const newName = stripTag(t.name) + " " + makeTag(t.uuid, hash || undefined);
  return { name: newName, uuid: t.uuid, hash: hash || null, changed: newName !== name };
}

// Default UUID minter — 8 hex chars from crypto. Injectable for deterministic tests.
function defaultMint() {
  try {
    return require("crypto").randomBytes(4).toString("hex");
  } catch (_) {
    // Node-for-Max / fallback: not cryptographically strong, fine for a tag.
    let s = "";
    for (let i = 0; i < 8; i++) s += ((i * 2654435761) % 16).toString(16);
    return s;
  }
}

// Ensure a clip name carries a UUID tag; mint+append if absent.
// Returns { name, uuid, changed }.
function ensureTagged(name, mint = defaultMint) {
  const existing = extractUuid(name);
  if (existing) return { name, uuid: existing, changed: false };
  const uuid = mint();
  const base = stripTag(name) || "Clip";
  return { name: base + " " + makeTag(uuid), uuid, changed: true };
}

// Reconcile a set of clips against the library.
//   clips:   [{ runtimeId, name }]   runtimeId = the per-instance handle (distinct
//                                    for duplicates even when names match)
//   library: { clipAssociations: { <uuid>: { dumpId, ... } }, ... }   (mutated)
//   mint:    uuid generator (injectable)
// Returns { renames: [{ runtimeId, oldName, newName, oldUuid, newUuid }],
//           tagged: [{ runtimeId, newName, uuid }],   // freshly-tagged (had none)
//           collisions: number }
function reconcile(clips, library, mint = defaultMint) {
  library.clipAssociations = library.clipAssociations || {};
  const renames = [];
  const tagged = [];
  const seen = new Map(); // uuid -> first runtimeId that owns it
  let collisions = 0;

  for (const clip of clips) {
    let uuid = extractUuid(clip.name);

    // Untagged clip: mint + tag it.
    if (!uuid) {
      const u = mint();
      const newName = (stripTag(clip.name) || "Clip") + " " + makeTag(u);
      clip.name = newName;
      tagged.push({ runtimeId: clip.runtimeId, newName, uuid: u });
      seen.set(u, clip.runtimeId);
      continue;
    }

    // First clip to claim this uuid keeps it.
    if (!seen.has(uuid)) {
      seen.set(uuid, clip.runtimeId);
      continue;
    }

    // Collision: this clip is a duplicate sharing a uuid → re-mint. The dump-hash
    // (if any) is KEPT — both copies legitimately point at the same patch; only the
    // identity must diverge. That makes copy-on-write automatic: the ref lives in
    // the name, so each clip can later be re-pointed independently.
    collisions++;
    let nu = mint();
    while (seen.has(nu)) nu = mint(); // never collide with an existing uuid
    const oldName = clip.name;
    const hash = extractDumpRef(clip.name);
    const newName = stripTag(clip.name) + " " + makeTag(nu, hash || undefined);

    // Copy-on-write the association so the duplicate starts at the same dump.
    const src = library.clipAssociations[uuid];
    if (src) {
      library.clipAssociations[nu] = Object.assign({}, src);
    }
    clip.name = newName;
    seen.set(nu, clip.runtimeId);
    renames.push({ runtimeId: clip.runtimeId, oldName, newName, oldUuid: uuid, newUuid: nu });
  }

  return { renames, tagged, collisions };
}

// Find inconsistencies for the UI to surface.
//   orphanAssociations: library entries whose uuid no longer appears on any clip
//   untaggedReferences:  clip uuids with no library association
function detectOrphans(clips, library) {
  const liveUuids = new Set(clips.map((c) => extractUuid(c.name)).filter(Boolean));
  const assoc = (library && library.clipAssociations) || {};
  const orphanAssociations = Object.keys(assoc).filter((u) => !liveUuids.has(u));
  const untaggedReferences = [...liveUuids].filter((u) => !assoc[u]);
  return { orphanAssociations, untaggedReferences };
}

module.exports = {
  TAG_RE,
  makeTag,
  extractUuid,
  extractDumpRef,
  setDumpRef,
  stripTag,
  ensureTagged,
  reconcile,
  detectOrphans,
  defaultMint,
};
