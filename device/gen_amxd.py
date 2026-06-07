#!/usr/bin/env python3
"""
Generate sysex-clip-manager.amxd — PER-TRACK SysEx Clip Manager with a 90s-neon UI.

Place on a MIDI track, BEFORE its External Instrument.
PRESENTATION (what Live shows): ARM, SPEED (4-seg), IMPORT/EXPORT/LIST/TEST, status LCD.
PATCHING (hidden): [sysexin]->[node.script]->[route]->[midiout](downstream) + [js liveglue.js].
"""
import json, struct, os

HERE = os.path.dirname(os.path.abspath(__file__))
SYX = os.path.join(os.path.dirname(HERE), "data", "test-dx7-vced.syx")

# ---- 90s neon palette (normalized RGBA) ----
BG     = [0.055, 0.043, 0.125, 1.0]
PANEL  = [0.12, 0.08, 0.22, 1.0]
LCDBG  = [0.02, 0.06, 0.035, 1.0]
MAG    = [1.0, 0.16, 0.62, 1.0]
DKMAG  = [0.42, 0.05, 0.26, 1.0]
MAGHI  = [1.0, 0.42, 0.78, 1.0]
CYAN   = [0.0, 0.92, 1.0, 1.0]
DKCYAN = [0.0, 0.30, 0.38, 1.0]
YELLOW = [1.0, 0.86, 0.0, 1.0]
GREEN  = [0.25, 1.0, 0.55, 1.0]
WHITE  = [0.95, 0.97, 1.0, 1.0]
BLACK  = [0.0, 0.0, 0.0, 1.0]

_id = [0]
def nid(p="o"):
    _id[0] += 1
    return p + str(_id[0])

boxes, lines = [], []

def add(box):
    boxes.append({"box": box})

def base(oid, cls, x, y, w, h, pres=True, extra=None):
    b = {"id": oid, "maxclass": cls,
         "patching_rect": [float(x), float(y), float(w), float(h)]}
    if pres:
        b["presentation"] = 1
        b["presentation_rect"] = [float(x), float(y), float(w), float(h)]
    if extra:
        b.update(extra)
    return b

def panel(x, y, w, h, color, rounded=0, border=0, bordercolor=None):
    oid = nid("p")
    e = {"numinlets": 1, "numoutlets": 0, "mode": 0, "bgcolor": color,
         "rounded": rounded, "border": border}
    if bordercolor:
        e["bordercolor"] = bordercolor
    add(base(oid, "panel", x, y, w, h, True, e))
    return oid

def label(text, x, y, w, h, color, size=11, font="Arial Bold", just=0):
    oid = nid("c")
    add(base(oid, "comment", x, y, w, h, True,
        {"numinlets": 1, "numoutlets": 0,
         "text": text, "textcolor": color, "fontsize": size, "fontname": font,
         "textjustification": just}))
    return oid

def tbutton(text, x, y, w, h, bg, bgon, txt, txton, size=12, rounded=6):
    oid = nid("b")
    add(base(oid, "textbutton", x, y, w, h, True,
        {"numinlets": 1, "numoutlets": 1, "outlettype": [""],
         "text": text, "fontsize": size, "rounded": rounded,
         "bgcolor": bg, "bgovercolor": bgon, "bgoncolor": bgon,
         "textcolor": txt, "textovercolor": txton, "textoncolor": txton,
         "border": 1, "outlinecolor": txt}))
    return oid

def livetab(x, y, w, h, enum, init):
    oid = "speed"
    add(base(oid, "live.tab", x, y, w, h, True,
        {"numinlets": 1, "numoutlets": 3, "outlettype": ["", "", ""],
         "parameter_enable": 1,
         "bgcolor": PANEL, "activebgcolor": MAG, "textcolor": CYAN,
         "activetextcolor": BLACK, "focusbordercolor": CYAN, "fontsize": 10,
         "saved_attribute_attributes": {"valueof": {
             "parameter_enum": enum, "parameter_longname": "Speed",
             "parameter_mmax": len(enum) - 1, "parameter_shortname": "Speed",
             "parameter_type": 2, "parameter_initial": [init],
             "parameter_initial_enable": 1}}}))
    return oid

def patch(oid, text, x, y, w, nin, nout, extra=None):
    e = {"text": text, "numinlets": nin, "numoutlets": nout,
         "outlettype": ["" for _ in range(nout)]}
    if extra:
        e.update(extra)
    add(base(oid, "newobj", x, y, w, 20, False, e))
    return oid

def pmsg(oid, text, x, y, w):
    add(base(oid, "message", x, y, w, 20, False,
        {"text": text, "numinlets": 2, "numoutlets": 1, "outlettype": [""]}))
    return oid

def line(src, sout, dst, din):
    lines.append({"patchline": {"destination": [dst, din], "source": [src, sout]}})

# ============================ PRESENTATION (the UI) ==========================
panel(0, 0, 484, 178, BG)
panel(0, 0, 484, 3, CYAN)                       # top neon rule
panel(0, 175, 484, 3, MAG)                      # bottom neon rule
panel(8, 46, 162, 74, PANEL, rounded=10, border=2, bordercolor=MAG)   # ARM bezel
panel(176, 44, 300, 76, PANEL, rounded=10, border=2, bordercolor=CYAN) # speed bezel

label("◢◤  S Y S E X · V A U L T  ◣◥", 0, 8, 484, 22, MAG, 16, "Arial Black", 1)
label("P A T C H   R E C A L L   S Y S T E M   '9 X", 0, 30, 484, 12, CYAN, 9, "Arial Bold", 1)

# ARM (big)
ARM = tbutton("◉ ARM", 16, 52, 146, 62, DKMAG, MAG, CYAN, BLACK, size=20, rounded=8)

# SPEED selector
label("◄  X M I T   S P E E D  ►", 180, 48, 292, 12, CYAN, 10, "Arial Bold", 1)
SPEED = livetab(182, 66, 288, 26, ["VINTAGE", "STANDARD", "FAST", "TURBO"], 1)
label("½× 1562   1× 3125 std   2× 6250   4× 12500  B/s", 180, 98, 292, 12, YELLOW, 8, "Arial", 1)

# action row
IMPORT = tbutton("IMPORT", 16, 124, 110, 24, PANEL, CYAN, CYAN, BLACK, size=11)
EXPORT = tbutton("EXPORT", 132, 124, 110, 24, PANEL, CYAN, CYAN, BLACK, size=11)
LIST   = tbutton("LIST",   248, 124, 102, 24, PANEL, YELLOW, YELLOW, BLACK, size=11)
TEST   = tbutton("TEST ▶", 356, 124, 112, 24, PANEL, MAGHI, MAGHI, BLACK, size=11)

# status LCD
panel(8, 152, 468, 20, LCDBG, rounded=5, border=1, bordercolor=GREEN)
add(base("statusLCD", "comment", 16, 154, 452, 16, True,
    {"numinlets": 1, "numoutlets": 0,
     "text": "> READY", "textcolor": GREEN, "fontsize": 11,
     "fontname": "Courier New", "textjustification": 0}))

# ============================ PATCHING (hidden) =============================
PY = 230
patch("nsx", "sysexin", 16, PY, 60, 1, 1)
patch("npre", "prepend byte", 16, PY + 36, 90, 1, 1)
patch("node", "node.script sysex-device.js", 16, PY + 80, 180, 1, 2,
      {"saved_object_attributes": {"autostart": 1, "defer": 0, "node_bin_path": "",
       "npm_bin_path": "", "watch": 1},
       "textfile": {"text": "", "filename": "sysex-device.js", "flags": 0,
                    "embed": 1, "autowatch": 1}})
patch("rte", "route sysex status", 16, PY + 124, 130, 1, 3)
patch("mout", "midiout", 16, PY + 160, 60, 1, 0)                 # NO ARG = downstream
patch("setp", "prepend set", 180, PY + 124, 80, 1, 1)
patch("glue", "js liveglue.js", 16, PY + 200, 110, 1, 1,
      {"saved_object_attributes": {"filename": "liveglue.js", "parameter_enable": 0}})
patch("ltd", "live.thisdevice", 300, PY, 110, 1, 3)
pmsg("mrescan", "rescan", 300, PY + 28, 60)

# UI control glue (in patching view)
patch("sarm", "t b", 220, PY, 50, 1, 1)
pmsg("marm", "arm", 220, PY + 28, 50)
patch("simp", "t b", 280, PY, 50, 1, 1)
patch("odlg", "opendialog", 280, PY + 28, 90, 1, 2)
patch("pimp", "prepend import", 280, PY + 56, 100, 1, 1)
patch("sexp", "t b", 390, PY, 50, 1, 1)
patch("sdlg", "savedialog", 390, PY + 28, 90, 1, 1)
patch("pexp", "prepend exportlast", 390, PY + 56, 120, 1, 1)
patch("slst", "t b", 500, PY, 50, 1, 1)
pmsg("mlst", "list", 500, PY + 28, 50)
patch("stst", "t b", 560, PY, 50, 1, 1)
pmsg("mtst", "transmitlast", 560, PY + 28, 90)
patch("pspd", "prepend speed", 182, PY + 36, 100, 1, 1)
# debug message buttons (handy, hidden)
pmsg("mss", "script start", 620, PY, 90)
pmsg("mni", "script npm install", 620, PY + 28, 130)

# ---- connections ----
# capture + transmit chain
line("nsx", 0, "npre", 0)
line("npre", 0, "node", 0)
line("node", 0, "rte", 0)
line("rte", 0, "mout", 0)            # route(sysex)  -> midiout (downstream)
line("rte", 1, "setp", 0)            # route(status) -> "set …"
line("setp", 0, "statusLCD", 0)      # -> LCD comment
line("rte", 2, "glue", 0)            # route(rest)   -> liveglue
line("glue", 0, "node", 0)           # liveglue -> node
line("ltd", 0, "mrescan", 0)
line("mrescan", 0, "glue", 0)

# UI -> node
line(ARM, 0, "sarm", 0); line("sarm", 0, "marm", 0); line("marm", 0, "node", 0)
line(IMPORT, 0, "simp", 0); line("simp", 0, "odlg", 0); line("odlg", 0, "pimp", 0); line("pimp", 0, "node", 0)
line(EXPORT, 0, "sexp", 0); line("sexp", 0, "sdlg", 0); line("sdlg", 0, "pexp", 0); line("pexp", 0, "node", 0)
line(LIST, 0, "slst", 0); line("slst", 0, "mlst", 0); line("mlst", 0, "node", 0)
line(TEST, 0, "stst", 0); line("stst", 0, "mtst", 0); line("mtst", 0, "node", 0)
line(SPEED, 0, "pspd", 0); line("pspd", 0, "node", 0)
line("mss", 0, "node", 0); line("mni", 0, "node", 0)

# Z-ORDER: in this Max/Live presentation, the FIRST box in the array draws ON TOP.
# We authored back-to-front (background first ... controls last), so reverse the
# array to push the full-cover background panel to the BACK and bring controls forward.
boxes.reverse()

patcher = {"patcher": {
    "fileversion": 1,
    "appversion": {"major": 9, "minor": 1, "revision": 4, "architecture": "x64", "modernui": 1},
    "classnamespace": "box",
    "rect": [100.0, 100.0, 700.0, 540.0],
    "openinpresentation": 1,
    "default_fontsize": 11.0, "default_fontname": "Arial",
    "gridsize": [8.0, 8.0],
    "boxes": boxes, "lines": lines,
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
