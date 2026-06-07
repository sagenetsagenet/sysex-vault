#!/usr/bin/env python3
"""Generate probe.amxd — a tiny LiveAPI probe device wrapping probe.js ([js])."""
import json, struct, os

HERE = os.path.dirname(os.path.abspath(__file__))

def newobj(oid, text, x, y, w, nin, nout, extra=None):
    box = {"id": oid, "maxclass": "newobj", "text": text,
           "numinlets": nin, "numoutlets": nout,
           "outlettype": ["" for _ in range(nout)],
           "patching_rect": [float(x), float(y), float(w), 20.0]}
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
boxes.append(comment("c1", "LiveAPI probe — put on a MIDI track w/ External Instrument, lock, click buttons. Read Max Console.", 16, 12, 560))
boxes.append(newobj("obj-1", "js probe.js", 16, 56, 90, 1, 1,
    extra={"saved_object_attributes": {"filename": "probe.js", "parameter_enable": 0}}))
btns = ["track", "ports", "devices", "trigger", "all", "clip"]
for i, b in enumerate(btns):
    oid = "m-" + b
    boxes.append(msg(oid, b, 16 + (i % 3) * 110, 100 + (i // 3) * 36, 100))
    lines.append(line(oid, 0, "obj-1", 0))
boxes.append(comment("c2", "'all' = track+ports+devices+trigger.  'clip' creates test clips (deletable).", 16, 176, 560))

patcher = {"patcher": {
    "fileversion": 1,
    "appversion": {"major": 9, "minor": 1, "revision": 4, "architecture": "x64", "modernui": 1},
    "classnamespace": "box",
    "rect": [120.0, 120.0, 620.0, 240.0],
    "openrect": [0.0, 0.0, 0.0, 0.0],
    "default_fontsize": 10.0, "default_fontname": "Arial",
    "gridsize": [8.0, 8.0],
    "boxes": boxes, "lines": lines,
}}

js = json.dumps(patcher, indent=4).encode("utf-8")
payload = js + b"\x00"
def chunk(tag, data): return tag + struct.pack("<I", len(data)) + data
blob = chunk(b"ampf", b"mmmm") + chunk(b"meta", struct.pack("<I", 1)) + chunk(b"ptch", payload)
out = os.path.join(HERE, "probe.amxd")
open(out, "wb").write(blob)

raw = open(out, "rb").read()
i = raw.find(b"ptch"); ln = struct.unpack("<I", raw[i+4:i+8])[0]
back = json.loads(raw[i+8:i+8+ln].rstrip(b"\x00").decode("utf-8"))
print("wrote %s (%d bytes), boxes=%d, lines=%d, reparses OK"
      % (out, len(raw), len(back["patcher"]["boxes"]), len(back["patcher"]["lines"])))
