// ============================================================================
// probe.js — throwaway LiveAPI probe ([js] in Live's JS engine)
//
// Answers the 3 unknowns blocking liveglue.js, by interrogating the REAL Live Set
// and posting findings to the Max console. Put this device on a MIDI track that
// has an External Instrument. Lock the patch and click each message button.
//   button "track"   -> which track am I on, its name/index
//   button "ports"   -> the track's input + output routing (readable port names?)
//   button "devices" -> enumerate devices on the track; can we read the External
//                       Instrument's MIDI-To?  (unknown #1)
//   button "clip"    -> try to CREATE a parked clip (arrangement @ bar 999, and
//                       session slot) and report which works  (unknown #3a)
//   button "trigger" -> what playback state is observable (session vs arrangement)
//                       to know WHEN a parked clip plays  (unknown #3b)
//   button "all"     -> run them all
// Nothing here is destructive except "clip" (creates test clips you can delete).
// ============================================================================
autowatch = 1;
inlets = 1;
outlets = 0;

function P(s) { post(s + "\n"); }
function g(api, prop) {
  try {
    var v = api.get(prop);
    if (v instanceof Array) return v.length === 1 ? v[0] : v.join(" | ");
    return v;
  } catch (e) { return "<err: " + e + ">"; }
}

function ownTrack() {
  var dev = new LiveAPI(null, "this_device");
  var cp = dev.get("canonical_parent"); // ["id", N]
  var tid = (cp instanceof Array) ? cp[cp.length - 1] : cp;
  return new LiveAPI(null, "id " + tid);
}

function track() {
  var t = ownTrack();
  P("=== TRACK ===");
  P("path: " + t.path);
  P("id: " + t.id);
  P("name: " + g(t, "name"));
  P("has_midi_input: " + g(t, "has_midi_input"));
  P("devices on track: " + t.getcount("devices"));
}

function ports() {
  var t = ownTrack();
  P("=== PORTS / ROUTING (unknown #1: is output readable?) ===");
  // these are the modern LOM routing properties; raw-dump them
  var props = [
    "input_routing_type", "input_routing_channel",
    "output_routing_type", "output_routing_channel",
    "available_input_routing_types", "available_output_routing_types",
    "available_input_routing_channels", "available_output_routing_channels",
    "current_input_routing", "current_output_routing",
    "input_routings", "output_routings",
    "current_input_sub_routing", "current_output_sub_routing"
  ];
  for (var i = 0; i < props.length; i++) {
    P(props[i] + " = " + g(t, props[i]));
  }
}

function devices() {
  var t = ownTrack();
  var n = t.getcount("devices");
  P("=== DEVICES (unknown #1: External Instrument MIDI-To?) ===");
  for (var i = 0; i < n; i++) {
    var d = new LiveAPI(null, t.path.replace(/^"|"$/g, "") + " devices " + i);
    P("--- device[" + i + "] ---");
    P("  name: " + g(d, "name"));
    P("  class_name: " + g(d, "class_name"));
    P("  class_display_name: " + g(d, "class_display_name"));
    P("  type: " + g(d, "type"));
    // Try every property that might carry the External Instrument's MIDI output
    var maybe = ["output_routing_type", "output_routing_channel",
                 "current_output_routing", "midi_output_routing",
                 "routing", "parameters"];
    for (var j = 0; j < maybe.length; j++) {
      var val = g(d, maybe[j]);
      if (val !== undefined && String(val).indexOf("<err") !== 0) {
        P("  " + maybe[j] + " = " + val);
      }
    }
    // If it has parameters, list their names (MIDI-To may surface as one)
    try {
      var pc = d.getcount("parameters");
      var names = [];
      for (var k = 0; k < pc && k < 24; k++) {
        var pa = new LiveAPI(null, t.path.replace(/^"|"$/g, "") + " devices " + i + " parameters " + k);
        names.push(g(pa, "name"));
      }
      P("  parameters(" + pc + "): " + names.join(", "));
    } catch (e) { P("  parameters: <err " + e + ">"); }
  }
}

function clip() {
  var t = ownTrack();
  var tp = t.path.replace(/^"|"$/g, "");
  P("=== CREATE CLIP (unknown #3a) ===");
  // Arrangement @ bar 999 (4/4 -> beat = (999-1)*4 = 3992), 1-bar length (4 beats)
  try {
    t.call("create_midi_clip", 3992, 4);
    P("arrangement create_midi_clip(3992,4): OK");
  } catch (e) { P("arrangement create_midi_clip: ERR " + e); }
  // Session slot fallback: find first empty slot, create_clip
  try {
    var ns = t.getcount("clip_slots");
    var made = false;
    for (var s = 0; s < ns; s++) {
      var slot = new LiveAPI(null, tp + " clip_slots " + s);
      if (g(slot, "has_clip") != 1) {
        slot.call("create_clip", 4);
        P("session create_clip in slot " + s + ": OK");
        made = true; break;
      }
    }
    if (!made) P("session: no empty slot found");
  } catch (e) { P("session create_clip: ERR " + e); }
}

function trigger() {
  var t = ownTrack();
  var song = new LiveAPI(null, "live_set");
  P("=== TRIGGER / PLAYBACK STATE (unknown #3b) ===");
  P("song is_playing: " + g(song, "is_playing"));
  P("song current_song_time (beats): " + g(song, "current_song_time"));
  P("song back_to_arranger: " + g(song, "back_to_arranger"));
  P("track playing_slot_index (session): " + g(t, "playing_slot_index"));
  P("track fired_slot_index: " + g(t, "fired_slot_index"));
  // Is there any 'currently playing arrangement clip' notion?
  P("track arrangement_clips count: " + (function () {
    try { return t.getcount("arrangement_clips"); } catch (e) { return "<no such child: " + e + ">"; }
  })());
}

function all() { track(); ports(); devices(); trigger(); P("(run 'clip' separately — it creates test clips)"); }

function bang() { all(); }
function loadbang() { P("[probe] ready — click 'all', then 'clip' separately."); }
