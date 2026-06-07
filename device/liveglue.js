// ============================================================================
// liveglue.js — Max [js] object (Live's JS engine, NOT node.script)
//
// The LiveAPI layer for the PER-TRACK SysEx Clip Manager. It controls ONLY its
// own track (this_device -> canonical_parent). All decisions (hashing, identity,
// stagger math) live in the TESTED node modules; this file is pure LiveAPI glue.
//
// PROTOCOL (this object's outlet 0 -> [node.script] inlet; [route]'s non-sysex
// outlet -> this object's inlet):
//   node -> here:  "needbars"            (gather set-wide [sx:] bars, reply "bars …")
//                  "createclip <bar> <name…>"   (park a clip on my track + name it)
//                  "reconcile"           (gather my-track clips, reply for re-mint)
//                  "apply_renames"       (write reconciled names + re-stagger moves)
//   here -> node:  "bars <b1> <b2> …"    (reply to needbars)
//                  "launch <name…>"      (a parked clip's bar is now playing)
//                  "reconcile_clips …"   (via Dict, see reconcile())
//
// UNTESTED HEADLESS — LiveAPI/Dict/outlet exist only in Max. Built to the probe's
// confirmed API shapes (create_midi_clip OK; arrangement_clips enumerable;
// current_song_time observable; External Instrument forwards downstream SysEx).
// ============================================================================
autowatch = 1;
inlets = 1;
outlets = 1;

var trackPath = null;     // e.g. "live_set tracks 3"
var beatsPerBar = 4;      // recomputed from the time signature
var parked = [];          // [{ name, start, end }] my-track [sx:] arrangement clips
var fired = {};           // name -> 1, reset on stop / backward jump
var lastTime = -1;
var playObs = null, timeObs = null;

function P(s) { post("[liveglue] " + s + "\n"); }
function strval(v) { return (v instanceof Array) ? (v.length === 1 ? v[0] : v.join(" ")) : v; }
function numval(v) { return (v instanceof Array) ? v[v.length - 1] : v; }
function isTag(name) { return /\[sx:[0-9a-f]{8}/i.test(String(name)); }
function joinArgs(a, from) { return Array.prototype.slice.call(a, from).join(" "); }

function loadbang() { init(); }
function rescan() { init(); }

function init() {
  try {
    var dev = new LiveAPI(null, "this_device");
    var cp = dev.get("canonical_parent");           // ["id", N]
    var tid = numval(cp);
    var track = new LiveAPI(null, "id " + tid);
    trackPath = String(track.path).replace(/^"|"$/g, "");
    // beats-per-bar from the time signature (quarter-note beats per measure)
    var ls = new LiveAPI(null, "live_set");
    var num = numval(ls.get("signature_numerator")) || 4;
    var den = numval(ls.get("signature_denominator")) || 4;
    beatsPerBar = num * 4 / den;
    setupTransportObserver();
    refreshParked();
    P("track = " + trackPath + ", beatsPerBar = " + beatsPerBar + ", parked = " + parked.length);
  } catch (e) { P("init ERR " + e); }
}

function barToBeats(bar) { return (bar - 1) * beatsPerBar; }
function beatsToBar(beats) { return Math.round(beats / beatsPerBar) + 1; }

// --- transport observer: fire a parked clip's dump when the playhead enters it ---
function setupTransportObserver() {
  try { if (playObs) playObs.property = ""; } catch (e) {}
  try { if (timeObs) timeObs.property = ""; } catch (e) {}
  playObs = new LiveAPI(function (a) { onPlay(a); }, "live_set");
  playObs.property = "is_playing";
  timeObs = new LiveAPI(function (a) { onTime(a); }, "live_set");
  timeObs.property = "current_song_time";
}
function onPlay(args) {
  var playing = numval(args[args.length - 1]);
  if (!playing) { fired = {}; lastTime = -1; }     // reset on stop
  else { refreshParked(); }                         // recapture positions on play
}
function onTime(args) {
  var t = numval(args[args.length - 1]);            // beats
  if (t < lastTime - 0.001) fired = {};             // looped / jumped back -> allow refire
  lastTime = t;
  for (var i = 0; i < parked.length; i++) {
    var p = parked[i];
    if (t >= p.start && t < p.end && !fired[p.name]) {
      fired[p.name] = 1;
      outlet(0, "launch", p.name);                  // node extracts hash + transmits
    }
  }
}

// Enumerate my own track's [sx:] arrangement clips -> parked[].
function refreshParked() {
  parked = [];
  if (!trackPath) return;
  var track = new LiveAPI(null, trackPath);
  var n = 0;
  try { n = track.getcount("arrangement_clips"); } catch (e) { return; }
  for (var c = 0; c < n; c++) {
    var clip = new LiveAPI(null, trackPath + " arrangement_clips " + c);
    var name = strval(clip.get("name"));
    if (!isTag(name)) continue;
    var start = numval(clip.get("start_time"));
    var end = numval(clip.get("end_time"));
    if (!(end > start)) end = start + beatsPerBar;
    parked.push({ name: name, start: start, end: end });
  }
}

// --- park flow ---
// node asks for every [sx:] clip bar across the WHOLE set (stateless stagger).
function needbars() {
  var bars = [];
  var ls = new LiveAPI(null, "live_set");
  var nT = 0;
  try { nT = ls.getcount("tracks"); } catch (e) {}
  for (var t = 0; t < nT; t++) {
    var tp = "live_set tracks " + t;
    var tr = new LiveAPI(null, tp);
    var nc = 0;
    try { nc = tr.getcount("arrangement_clips"); } catch (e) { nc = 0; }
    for (var c = 0; c < nc; c++) {
      var clip = new LiveAPI(null, tp + " arrangement_clips " + c);
      var name = strval(clip.get("name"));
      if (isTag(name)) bars.push(beatsToBar(numval(clip.get("start_time"))));
    }
  }
  outlet(0, ["bars"].concat(bars));   // -> node computes nextStaggerBar
  P("gathered " + bars.length + " parked bar(s) set-wide");
}

// node replies with the chosen bar + the full clip name to create on my track.
function createclip(bar) {
  var name = joinArgs(arguments, 1);
  try {
    var startBeats = barToBeats(bar);
    P("createclip want bar=" + bar + " (beatsPerBar=" + beatsPerBar + ") -> startBeats=" + startBeats);
    var track = new LiveAPI(null, trackPath);
    var res = track.call("create_midi_clip", startBeats, beatsPerBar);
    var clipId = numval(res);
    var clip = new LiveAPI(null, "id " + clipId);
    var actual = numval(clip.get("start_time"));
    P("created clip id=" + clipId + " actual start_time=" + actual + " beats (bar " + beatsToBar(actual) + ")");
    // If create_midi_clip ignored our time and placed at the playhead, MOVE it.
    if (Math.abs(actual - startBeats) > 0.01) {
      try {
        clip.set("start_time", startBeats);
        P("moved start_time -> " + numval(clip.get("start_time")));
      } catch (e2) { P("could not move clip: " + e2); }
    }
    clip.set("name", name);
    P("parked '" + name + "' at bar " + bar);
    refreshParked();
  } catch (e) { P("createclip ERR " + e); }
}

// --- duplicate reconciliation: gather my-track clips for node to re-mint ---
function reconcile() {
  var clips = [];
  if (!trackPath) { return; }
  var track = new LiveAPI(null, trackPath);
  var n = 0;
  try { n = track.getcount("arrangement_clips"); } catch (e) {}
  for (var c = 0; c < n; c++) {
    var clip = new LiveAPI(null, trackPath + " arrangement_clips " + c);
    clips.push({ runtimeId: numval(clip.id), name: strval(clip.get("name")), start: numval(clip.get("start_time")) });
  }
  var d = new Dict("reconcileClips");
  d.parse(JSON.stringify({ clips: clips }));
  outlet(0, "reconcile");
  P("gathered " + clips.length + " own-track clip(s) for reconcile");
}

// node wrote Dict "reconcileRenames": [{runtimeId, newName, newBar?}] -> apply.
function apply_renames() {
  var d = new Dict("reconcileRenames");
  var obj;
  try { obj = JSON.parse(d.stringify()); } catch (e) { P("bad renames dict"); return; }
  var list = [].concat(obj.renames || [], obj.tagged || []);
  var applied = 0;
  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    var c = new LiveAPI(null, "id " + r.runtimeId);
    if (!c || numval(c.id) == 0) continue;
    if (r.newName) c.set("name", r.newName);
    if (typeof r.newBar === "number") {
      try { c.set("start_time", barToBeats(r.newBar)); } catch (e) {}   // re-stagger duplicate
    }
    applied++;
  }
  refreshParked();
  P("applied " + applied + " rename/move(s)");
}

// swallow any status messages node emits that aren't ours (imported/received/list…)
function anything() {}
