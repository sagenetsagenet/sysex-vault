#!/usr/bin/env python3
"""
Generate sysex-clip-manager.amxd — the PER-TRACK SysEx Clip Manager device.

Place on a MIDI track, BEFORE its External Instrument. Signal:
   [sysexin] -> [prepend byte] -> [node.script]            (capture)
   [node.script] -> [route sysex] -> [midiout]  (NO PORT = downstream -> Ext.Instrument -> synth)
   [route] non-sysex -> [js liveglue.js]                   (park/launch/reconcile protocol)
   [js liveglue.js] -> [node.script]                       (bars / launch / replies)
   [live.thisdevice] -> "rescan" -> [js liveglue.js]
   buttons: arm / import / transmitlast / list / script start|npm install
node.script resolves ../src/*; save this .amxd in device/ alongside the .js files.
"""
import json, struct, os

HERE = os.path.dirname(os.path.abspath(__file__))
SYX = os.path.join(os.path.dirname(HERE), "data", "test-dx7-vced.syx")

def newobj(oid, text, x, y, w, nin, nout, attrs=None, extra=None):
    box = {"id": oid, "maxclass": "newobj", "text": text,
           "numinlets": nin, "numoutlets": nout,
           "outlettype": ["" for _ in range(nout)],
           "patching_rect": [float(x), float(y), float(w), 20.0]}
    if attrs: box["saved_object_attributes"] = attrs
    if extra: box.update(extra)
    return {"box": box}

def msg(oid, text, x, y, w):
    return {"box": {"id": oid, "maxclass": "message", "text": text,
                    "numinlets": 2, "numoutlets": 1, "outlettype": [""],
                    "patching_rect": [float(x), float(y), float(w), 20.0]}}

def comment(oid, text, x, y, w):
    return {"box": {"id": oid, "maxclass": "comment", "text": text,
                    "numinlets": 1, "numoutlets": 0,
                    "patching_rect": [float(x), float(y), float(w), 20.0]}}

def line(src, sout, dst, din):
    return {"patchline": {"destination": [dst, din], "source": [src, sout]}}

boxes, lines = [], []

boxes.append(comment("c1", "SysEx Clip Manager (per-track) — place BEFORE the track's External Instrument", 24, 12, 520))

# --- capture chain ---
boxes.append(newobj("obj-2", "sysexin", 24, 56, 60, 1, 1))                  # reads the track's MIDI input chain
boxes.append(newobj("obj-3", "prepend byte", 24, 92, 90, 1, 1))
boxes.append(newobj("obj-1", "node.script sysex-device.js", 24, 140, 180, 1, 2,
    attrs={"autostart": 1, "defer": 0, "node_bin_path": "", "npm_bin_path": "", "watch": 1},
    extra={"textfile": {"text": "", "filename": "sysex-device.js", "flags": 0, "embed": 1, "autowatch": 1}}))
boxes.append(comment("c3", "console: '[sysex] device ready'", 216, 142, 240))

# --- transmit chain: route sysex -> midiout (NO PORT = downstream) ---
boxes.append(newobj("obj-4", "route sysex", 24, 196, 80, 1, 2))
boxes.append(newobj("obj-5", "midiout", 24, 240, 60, 1, 0))                 # NO ARG: downstream into the chain
boxes.append(comment("c4", "no port = into the Live chain -> External Instrument -> synth", 96, 242, 360))

# --- LiveAPI layer ---
boxes.append(newobj("obj-6", "js liveglue.js", 300, 196, 110, 1, 1,
    attrs={"filename": "liveglue.js", "parameter_enable": 0}))
boxes.append(newobj("obj-8", "live.thisdevice", 300, 140, 110, 1, 3))
boxes.append(msg("obj-9", "rescan", 300, 168, 60))
boxes.append(comment("c6", "liveglue: own-track park / launch / reconcile (LiveAPI)", 300, 224, 340))

# --- buttons (right column) ---
imp = "import " + SYX + " Bass"
boxes.append(msg("obj-arm", "arm", 300, 260, 60))
boxes.append(comment("c7", "<- key-map this to arm capture, then dump from the synth", 368, 262, 320))
boxes.append(msg("obj-imp", imp, 300, 292, 460))
boxes.append(msg("obj-tl", "transmitlast", 300, 324, 90))
boxes.append(msg("obj-ls", "list", 400, 324, 60))
boxes.append(msg("obj-ss", "script start", 300, 356, 90))
boxes.append(msg("obj-ni", "script npm install", 400, 356, 130))

# --- connections ---
lines.append(line("obj-2", 0, "obj-3", 0))    # sysexin -> prepend byte
lines.append(line("obj-3", 0, "obj-1", 0))    # prepend -> node.script
lines.append(line("obj-1", 0, "obj-4", 0))    # node.script -> route
lines.append(line("obj-4", 0, "obj-5", 0))    # route(sysex)  -> midiout (downstream)
lines.append(line("obj-4", 1, "obj-6", 0))    # route(rest)   -> liveglue (needbars/createclip/…)
lines.append(line("obj-6", 0, "obj-1", 0))    # liveglue -> node.script (bars/launch/replies)
lines.append(line("obj-8", 0, "obj-9", 0))    # live.thisdevice -> "rescan"
lines.append(line("obj-9", 0, "obj-6", 0))    # "rescan" -> liveglue
for b in ("obj-arm", "obj-imp", "obj-tl", "obj-ls", "obj-ss", "obj-ni"):
    lines.append(line(b, 0, "obj-1", 0))      # buttons -> node.script

patcher = {"patcher": {
    "fileversion": 1,
    "appversion": {"major": 9, "minor": 1, "revision": 4, "architecture": "x64", "modernui": 1},
    "classnamespace": "box",
    "rect": [120.0, 120.0, 820.0, 420.0],
    "openrect": [0.0, 0.0, 0.0, 0.0],
    "default_fontsize": 10.0, "default_fontname": "Arial",
    "gridsize": [8.0, 8.0],
    "boxes": boxes, "lines": lines,
    # no platform_compatibility / minimum_* keys (omission = loads on any OS)
}}

js = json.dumps(patcher, indent=4).encode("utf-8")
payload = js + b"\x00"
def chunk(tag, data): return tag + struct.pack("<I", len(data)) + data
blob = chunk(b"ampf", b"mmmm") + chunk(b"meta", struct.pack("<I", 1)) + chunk(b"ptch", payload)
out = os.path.join(HERE, "sysex-clip-manager.amxd")
open(out, "wb").write(blob)

raw = open(out, "rb").read(); i = raw.find(b"ptch"); ln = struct.unpack("<I", raw[i+4:i+8])[0]
back = json.loads(raw[i+8:i+8+ln].rstrip(b"\x00").decode("utf-8"))
print("wrote %s (%d bytes), boxes=%d, lines=%d, json reparses OK"
      % (out, len(raw), len(back["patcher"]["boxes"]), len(back["patcher"]["lines"])))
