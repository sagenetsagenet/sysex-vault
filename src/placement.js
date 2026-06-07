"use strict";
// ============================================================================
// Parked-clip placement  —  SysEx Clip Manager
//
// STATELESS global stagger. Per-track devices don't share a counter; instead,
// at park-time a device asks LiveAPI for the bar position of EVERY [sx:...]-tagged
// clip across the whole Set (liveglue.js gathers them), and this module picks the
// next free bar. No shared state to corrupt; naturally handles duplicates and
// deletions because it reads the current truth each time. Spacing also sequences
// the parked dumps so synths receive one at a time on playback.
//
// Pure logic, Node-for-Max compatible. Verified by test/placement.test.js.
// ============================================================================

const DEFAULT_START_BAR = 999; // parking zone, out of the way of the music

// Gap (in bars) to leave before a newly-parked clip. Wider for big banks so the
// previous synth has time to swallow its dump before the next one fires.
function barSpacing(dumpBytes, override) {
  if (override) return override;
  const n = dumpBytes || 0;
  if (n > 8192) return 4;
  if (n > 2048) return 2;
  return 1;
}

// Given the bars already occupied by parked [sx:...] clips (set-wide), return the
// next free bar to park at. opts: { startBar, spacing, dumpBytes }.
//   - empty set            -> startBar
//   - otherwise            -> max(usedBars) + spacing  (never below startBar)
function nextStaggerBar(usedBars, opts) {
  opts = opts || {};
  const startBar = opts.startBar != null ? opts.startBar : DEFAULT_START_BAR;
  const spacing = barSpacing(opts.dumpBytes, opts.spacing);
  const valid = (usedBars || []).filter((b) => typeof b === "number" && isFinite(b));
  if (!valid.length) return startBar;
  return Math.max.apply(null, valid.concat(startBar - spacing)) + spacing;
}

module.exports = { DEFAULT_START_BAR, barSpacing, nextStaggerBar };
