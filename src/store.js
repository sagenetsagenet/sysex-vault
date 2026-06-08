"use strict";
// ============================================================================
// Content-addressed dump store  —  Sysex Vault
//
// Dumps live as plain .syx files on disk, named by their content hash:
//     <baseDir>/<hash>.syx
// This is the persistence layer that REPLACED the Live-Set dict (which can't
// carry node-written data into the .als in Live 12 — verified by decoding a
// real .als, spike 2, 2026-06-08). The clip NAME carries [sx:uuid:hash]
// (see identity.js) and the hash points here. Both halves are proven-persistent:
// clip names survive save/load+duplicate (spike 3b), and files are just files.
//
// Pure fs + the same FNV-1a hash as library.hashBytes (asserted equal in tests).
// Node core only — runs as-is inside Node-for-Max. Verified by test/store.test.js.
// ============================================================================

const fs = require("fs");
const path = require("path");

// MUST match library.hashBytes exactly (test/store.test.js asserts this). 8 hex.
function hashOf(bytes) {
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

function isHash(h) {
  return typeof h === "string" && /^[0-9a-f]{8}$/i.test(h);
}

function dumpPath(baseDir, hash) {
  return path.join(baseDir, hash.toLowerCase() + ".syx");
}

function ensureDir(baseDir) {
  fs.mkdirSync(baseDir, { recursive: true });
}

// Write bytes to the store (content-addressed, deduped). Returns
// { hash, path, byteSize, deduped }. Idempotent: identical bytes -> same file.
function put(baseDir, rawBytes) {
  const bytes = toBytes(rawBytes);
  const hash = hashOf(bytes);
  const p = dumpPath(baseDir, hash);
  if (fs.existsSync(p)) {
    return { hash, path: p, byteSize: bytes.length, deduped: true };
  }
  ensureDir(baseDir);
  fs.writeFileSync(p, Buffer.from(bytes));
  return { hash, path: p, byteSize: bytes.length, deduped: false };
}

function has(baseDir, hash) {
  return isHash(hash) && fs.existsSync(dumpPath(baseDir, hash));
}

// Read a dump's bytes (number[]) by hash, or null if absent.
function get(baseDir, hash) {
  if (!isHash(hash)) return null;
  const p = dumpPath(baseDir, hash);
  if (!fs.existsSync(p)) return null;
  return Array.prototype.slice.call(fs.readFileSync(p));
}

// List hashes present in the store.
function list(baseDir) {
  if (!fs.existsSync(baseDir)) return [];
  return fs
    .readdirSync(baseDir)
    .filter((f) => /^[0-9a-f]{8}\.syx$/i.test(f))
    .map((f) => f.slice(0, 8).toLowerCase());
}

module.exports = { hashOf, isHash, dumpPath, ensureDir, put, has, get, list };
