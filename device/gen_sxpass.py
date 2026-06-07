#!/usr/bin/env python3
"""Generate sxpass.amxd — tests whether the External Instrument forwards SysEx
downstream (Option C). Place this device BEFORE the External Instrument on the
track; set the Ext. Instrument's MIDI-To to IAC Bus 2; watch IAC Bus 2 in MIDI
Monitor. Click each button; whichever (if any) makes the test SysEx appear on
IAC Bus 2 tells us the downstream-inject mechanism works."""
import json, struct, os
HERE = os.path.dirname(os.path.abspath(__file__))

TEST = "240 125 1 2 3 4 5 6 7 8 247"  # F0 7D 01..08 F7 — recognizable test sysex

def newobj(oid, text, x, y, w, nin, nout):
    return {"box": {"id": oid, "maxclass": "newobj", "text": text,
                    "numinlets": nin, "numoutlets": nout,
                    "outlettype": ["" for _ in range(nout)],
                    "patching_rect": [float(x), float(y), float(w), 20.0]}}
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
boxes.append(comment("c0", "SysEx passthrough test. Put this device BEFORE the External Instrument. Ext.Instrument MIDI-To = IAC Bus 2. Watch IAC Bus 2 in MIDI Monitor.", 16, 12, 640))

# Path A: downstream via no-arg [midiout]
boxes.append(msg("m-a", TEST, 16, 64, 200))
boxes.append(newobj("o-a", "midiout", 16, 104, 60, 1, 0))
boxes.append(comment("c-a", "A: click -> [midiout] (no port = into Live chain?)", 90, 106, 320))

# Path B: via [sysexout]
boxes.append(msg("m-b", TEST, 16, 152, 200))
boxes.append(newobj("o-b", "sysexout", 16, 192, 60, 1, 0))
boxes.append(comment("c-b", "B: click -> [sysexout] (no port = into Live chain?)", 90, 194, 320))

boxes.append(comment("c-z", "If the F0 7D ... F7 message shows on IAC Bus 2 -> Ext.Instrument forwards SysEx (Option C works).", 16, 232, 640))

lines.append(line("m-a", 0, "o-a", 0))
lines.append(line("m-b", 0, "o-b", 0))

patcher = {"patcher": {
    "fileversion": 1,
    "appversion": {"major": 9, "minor": 1, "revision": 4, "architecture": "x64", "modernui": 1},
    "classnamespace": "box",
    "rect": [120.0, 120.0, 680.0, 280.0],
    "openrect": [0.0, 0.0, 0.0, 0.0],
    "default_fontsize": 10.0, "default_fontname": "Arial",
    "gridsize": [8.0, 8.0],
    "boxes": boxes, "lines": lines,
}}
js = json.dumps(patcher, indent=4).encode("utf-8")
payload = js + b"\x00"
def chunk(tag, data): return tag + struct.pack("<I", len(data)) + data
blob = chunk(b"ampf", b"mmmm") + chunk(b"meta", struct.pack("<I", 1)) + chunk(b"ptch", payload)
out = os.path.join(HERE, "sxpass.amxd")
open(out, "wb").write(blob)
raw = open(out, "rb").read(); i = raw.find(b"ptch"); ln = struct.unpack("<I", raw[i+4:i+8])[0]
back = json.loads(raw[i+8:i+8+ln].rstrip(b"\x00").decode("utf-8"))
print("wrote %s (%d bytes), boxes=%d, lines=%d, reparses OK"
      % (out, len(raw), len(back["patcher"]["boxes"]), len(back["patcher"]["lines"])))
