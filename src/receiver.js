"use strict";
// ============================================================================
// receiver.js — pure SysEx receive state machine (TESTED headless).
//
// Frames an incoming MIDI byte stream into complete F0..F7 SysEx messages. It
// exists to fix the "can't receive a second patch" bug: the buffer MUST clear
// cleanly so the next dump starts from empty. The device calls reset() every
// time RECEIVE/ARM is clicked, guaranteeing a fresh buffer for the next patch.
//
// Robustness rules:
//   • F0 always (re)starts a message — a stray/garbage tail from a prior dump
//     can never wedge the next one.
//   • A dump that arrives without a leading F0 is still captured (synthesised).
//   • MIDI realtime bytes (clock 0xF8, active-sensing 0xFE, etc.) that some
//     interfaces interleave are IGNORED so they never corrupt a dump nor start
//     a phantom buffer that blocks the next real F0.
// ============================================================================

// 0xF8..0xFF: system realtime + tune-request/undefined. Never part of a SysEx body.
function isRealtime(b) { return b >= 0xF8 && b <= 0xFF; }

function create() {
  return { buf: null, lastCompleteLen: 0 };
}

// Clear the buffer — "click RECEIVE clears the buffer for the next patch".
function reset(st) { st.buf = null; }

// True while a message is mid-accumulation (used to surface an "incoming" indicator).
function pending(st) { return st.buf ? st.buf.length : 0; }

// Feed one byte. Returns a COMPLETE message (array, F0..F7) when one closes,
// otherwise null. Caller-supplied bytes are masked to 8 bits.
function feed(st, b) {
  b = b & 0xff;
  if (isRealtime(b)) return null;                 // never corrupt/start a dump with realtime
  if (b === 0xF0) { st.buf = [0xF0]; return null; } // F0 always starts fresh
  if (st.buf === null) st.buf = [];               // tolerate a dump missing its leading F0
  st.buf.push(b);
  if (b === 0xF7) {
    let msg = st.buf;
    st.buf = null;
    if (msg[0] !== 0xF0) msg = [0xF0].concat(msg);
    st.lastCompleteLen = msg.length;
    return msg;
  }
  return null;
}

module.exports = { create, reset, feed, pending, isRealtime };
