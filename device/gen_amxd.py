#!/usr/bin/env python3
"""
Generate "Sysex Vault.amxd" — PER-TRACK SysEx patch manager (formerly "SysEx Clip Manager").

Dark cyber-industrial presentation: graphite surfaces, cyan primary accent,
sparing violet — a premium MIDI/SysEx editor look (Elektron Transfer / Sequential
editor vibe), Ableton-native. Functionality is unchanged from the prior build.

Place on a MIDI track, BEFORE its External Instrument.
PRESENTATION (what Live shows): the "Sysex Control" 3-column dashboard mockup —
  Quick Actions / Sysex Builder + Byte Editor / Preset Manager. These are
  PLACEHOLDER visuals (not wired) for design review; real controls are hidden.
REAL CONTROLS (presentation=0, still wired): ARM, SPEED, IMPORT/EXPORT/LIST/TEST, LCD.
PATCHING (hidden): [sysexin]->[node.script]->[route]->[midiout](downstream) + [js liveglue.js].
"""
import json, struct, os

HERE = os.path.dirname(os.path.abspath(__file__))
SYX = os.path.join(os.path.dirname(HERE), "data", "test-dx7-vced.syx")

# ---- dark cyber-industrial palette (premium SysEx editor) ----
def hexrgba(h, a=1.0):
    h = h.lstrip("#")
    return [int(h[i:i+2], 16) / 255.0 for i in (0, 2, 4)] + [a]

BG      = hexrgba("070C12")   # deep charcoal-blue — main background
PANEL   = hexrgba("0E1621")   # secondary panels (speed/info bezels)
PANEL2  = hexrgba("101722")   # ARM bezel interior
RAISED  = hexrgba("162233")   # raised interactive base (ARM idle)
BTNBG   = hexrgba("182332")   # button / inactive segment
BTNON   = hexrgba("20394A")   # pressed / active segment
BTNBORD = hexrgba("2A3B50")   # default button border
CYAN    = hexrgba("20D7FF")   # primary accent — borders, headers, active
VIOLET  = hexrgba("9A6BFF")   # secondary accent — used sparingly
TXT     = hexrgba("E8EDF5")   # primary text
TXT2    = hexrgba("A7B4C6")   # secondary text
TXT3    = hexrgba("6F8095")   # muted text
INACT   = hexrgba("5A6472")   # inactive indicator
LCDBG   = hexrgba("0A1018")   # inset readout background
BLACK   = BG                  # on-accent text sits on the deep background tone

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

def tbutton(text, x, y, w, h, bg, bgon, txt, txton, size=12, rounded=6, bord=None, pres=True):
    oid = nid("b")
    if bord is None:
        bord = txt
    add(base(oid, "textbutton", x, y, w, h, pres,
        {"numinlets": 1, "numoutlets": 1, "outlettype": [""],
         "text": text, "fontsize": size, "rounded": rounded,
         "bgcolor": bg, "bgovercolor": bgon, "bgoncolor": bgon,
         "textcolor": txt, "textovercolor": txton, "textoncolor": txton,
         "border": 1, "outlinecolor": bord}))
    return oid

def livetab(x, y, w, h, enum, init, pres=True):
    oid = "speed"
    add(base(oid, "live.tab", x, y, w, h, pres,
        {"numinlets": 1, "numoutlets": 3, "outlettype": ["", "", ""],
         "parameter_enable": 1,
         "bgcolor": BTNBG, "activebgcolor": BTNON, "textcolor": TXT2,
         "activetextcolor": CYAN, "focusbordercolor": CYAN, "fontsize": 10,
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

# ---- dashboard helpers (presentation cards / cells / pills) ----
def card(x, y, w, h, icon, title, subtitle, accent, star=False):
    panel(x, y, w, h, RAISED, rounded=8, border=1, bordercolor=BTNBORD)
    if icon:  # icon optional — without it the card hugs the centered text
        label(icon, x + 6, y + (h - 18) // 2, 16, 18, accent, 14, "Arial", 1)
    # title + subtitle centered across the FULL card width
    label(title, x, y + 5, w, 13, TXT, 10, "Arial Bold", 1)
    label(subtitle, x, y + 19, w, 11, TXT3, 8, "Arial", 1)
    if star:
        label("★", x + w - 16, y + 5, 12, 12, TXT3, 9, "Arial", 1)

def bytecell(x, y, w, h, hexstr, selected=False):
    bc = CYAN if selected else BTNBORD
    tc = CYAN if selected else TXT
    panel(x, y, w, h, BTNBG, rounded=4, border=2 if selected else 1, bordercolor=bc)
    label(hexstr, x, y + (h - 12) // 2, w, 12, tc, 8, "Courier New", 1)

def deadpill(x, y, w, h, text, accent, filled=False):
    if filled:
        panel(x, y, w, h, accent, rounded=6)
        label(text, x, y + (h - 12) // 2, w, 12, BG, 9, "Arial Bold", 1)
    else:
        panel(x, y, w, h, BTNBG, rounded=6, border=1, bordercolor=accent)
        label(text, x, y + (h - 12) // 2, w, 12, accent, 9, "Arial Bold", 1)

def hdr(text, x, y, w):
    label(text, x, y, w, 11, TXT3, 8, "Arial Bold", 0)

def clickzone(oid, x, y, w, h, accent):
    # transparent momentary button that sits ON TOP of a card to make it clickable;
    # outputs a bang-ish 1/0 we trigger off of. Author AFTER the card so it draws on top.
    # FEEDBACK: subtle accent tint on hover, STRONG accent flash while pressed so the
    # click is unmistakable (the underlying card text still shows through the tint).
    rgb = accent[:3]
    hover = rgb + [0.22]
    press = rgb + [0.85]      # near-opaque flash while held — unmistakable click feedback
    add(base(oid, "textbutton", x, y, w, h, True,
        {"numinlets": 1, "numoutlets": 1, "outlettype": [""],
         "text": "", "fontsize": 8, "rounded": 8, "border": 0, "blinktime": 220,
         "bgcolor": [0, 0, 0, 0], "bgovercolor": hover, "bgoncolor": press,
         "textcolor": [0, 0, 0, 0], "textovercolor": [0, 0, 0, 0], "textoncolor": [0, 0, 0, 0]}))
    return oid

def flashled(oid, x, y, sz, accent):
    # A real [button] (bang) — UNLIKE textbutton, [button] honours `blinktime`
    # and reliably FLASHES `blinkcolor` for blinktime ms on every bang. We bang it
    # from the clickzone so each card click produces an unmistakable light-up.
    # Idle = a faint hollow ring; on click = a bright filled accent dot.
    add(base(oid, "button", x, y, sz, sz, True,
        {"numinlets": 1, "numoutlets": 1, "outlettype": ["bang"],
         "blinktime": 260, "bgcolor": [0, 0, 0, 0],
         "blinkcolor": accent[:3] + [1.0], "outlinecolor": accent[:3] + [0.45]}))
    return oid

def pillbutton(oid, x, y, w, h, text, accent, filled=False, size=9):
    # Real clickable pill (replaces the painted deadpill) so it FLASHES on click.
    # Not necessarily wired yet — the visual press feedback is the point here.
    if filled:                      # solid accent fill -> darken on press
        bg, bgon = accent, [c * 0.65 for c in accent[:3]] + [1.0]
        tc, tcon = BG, BG
    else:                           # outlined -> fill with accent on press
        bg, bgon = BTNBG, accent[:3] + [1.0]
        tc, tcon = accent, BG
    add(base(oid, "textbutton", x, y, w, h, True,
        {"numinlets": 1, "numoutlets": 1, "outlettype": [""],
         "text": text, "fontsize": size, "fontname": "Arial Bold", "rounded": 6,
         "blinktime": 220,
         "bgcolor": bg, "bgovercolor": bgon, "bgoncolor": bgon,
         "textcolor": tc, "textovercolor": tcon, "textoncolor": tcon,
         "border": 1, "outlinecolor": accent}))
    return oid

def umenu(oid, x, y, w, h, pres=True):
    # dynamic dropdown; items are pushed at runtime by the node engine
    # ("clear"/"append <name>"). Outlet 0 = selected index (int).
    add(base(oid, "umenu", x, y, w, h, pres,
        {"numinlets": 1, "numoutlets": 3, "outlettype": ["int", "", ""],
         "bgcolor": BTNBG, "textcolor": TXT, "fontsize": 9, "fontname": "Arial",
         "arrowcolor": CYAN, "bordercolor": BTNBORD, "items": ""}))
    return oid

def textedit(oid, x, y, w, h, pres=True):
    # single-line typed name field. A bang in -> outputs current text out outlet 0.
    add(base(oid, "textedit", x, y, w, h, pres,
        {"numinlets": 1, "numoutlets": 2, "outlettype": ["", "bang"],
         "bgcolor": BTNBG, "textcolor": TXT, "fontsize": 9, "fontname": "Arial",
         "bordercolor": BTNBORD, "text": ""}))
    return oid

# ============================ PRESENTATION (the UI) ==========================
# Faithful reproduction of the "Sysex Control" dashboard mockup, COMPACTED to fit
# the M4L device window height (~176px usable). Device Info moved into the right
# column to relieve the center stack. NOTE: the byte builder / editor, preset
# manager, device-info, and send/request/receive cards are PLACEHOLDER visuals
# (NOT wired). The real functional controls are created afterward with
# presentation=0 (hidden but still fully connected), for a later wiring pass.
W, H = 266, 166
panel(0, 0, W, H, BG, rounded=12, border=1, bordercolor=BTNBORD)        # window

# --- header bar (tight gap to divider) ---
label("✈", 12, 6, 16, 16, CYAN, 12, "Arial", 1)
label("Sysex Vault", 30, 6, 150, 15, TXT, 12, "Arial Bold", 0)
label("⟳   ⚙   ⤓", W - 86, 7, 78, 12, TXT3, 10, "Arial", 2)
panel(12, 23, W - 24, 1, BTNBORD)                                      # header divider (close under title)

# --- LEFT: PRESETS (dropdown recalls a saved dump; type a name + SAVE) ---
hdr("PRESETS", 12, 30, 106)
umenu("pmenu", 12, 42, 106, 18)                        # WIRED: select a saved preset
label("NEW NAME", 12, 63, 106, 9, TXT3, 7, "Arial Bold", 0)
textedit("pname", 12, 73, 106, 18)                     # WIRED: type a preset name
pillbutton("bsave",   12, 95, 51, 16, "SAVE",    CYAN)  # WIRED: save last dump as typed name
pillbutton("bsaveas", 67, 95, 51, 16, "SAVE AS", CYAN)  # WIRED: save as new (unique) name

# --- RIGHT: PRESET MANAGER  (the two WORKING buttons) ---
hdr("PRESET MANAGER", 128, 30, 126)
card(128, 44, 126, 34, "⬆", "SEND PATCH",    "Send Patch to Device", CYAN)
# WIRED: Send = transmit the last captured/imported patch downstream to the synth.
clickzone("sndbtn2", 128, 44, 126, 34, CYAN)
flashled("ledSnd", 234, 54, 14, CYAN)          # flashes on every SEND click
card(128, 82, 126, 34, "⬇", "RECEIVE PATCH", "Receive from Device",  VIOLET)
# WIRED: Receive = arm the device to capture the next dump from the synth.
clickzone("rcvbtn2", 128, 82, 126, 34, VIOLET)
flashled("ledRcv", 234, 92, 14, VIOLET)        # flashes on every RECEIVE click
pillbutton("bmanage", 128, 120, 126, 18, "MANAGE PRESETS", CYAN, filled=True)

# --- STATUS BAR (VISIBLE): the device's live activity readout. The node engine
#     drives this on every action: ○ READY / ◀ ARMED / ◀ incoming… / ✓ RX <name>
#     / ▶ sending… / ✓ sent. This is the on-screen indication of data in/out. ---
panel(12, 144, W - 24, 18, LCDBG, rounded=6, border=1, bordercolor=BTNBORD)   # LCD bezel
add(base("statusLCD", "comment", 17, 147, W - 34, 13, True,
    {"numinlets": 1, "numoutlets": 0,
     "text": "○ READY", "textcolor": CYAN, "fontsize": 10,
     "fontname": "Courier New", "textjustification": 0}))

# --- REAL functional controls: kept WIRED, hidden from presentation for now ---
# (presentation=0 — they remain in the patch and stay connected to the engine.)
ARM    = tbutton("◉ ARM", 680, 120, 90, 24, RAISED, CYAN, CYAN, BG, size=11, bord=CYAN, pres=False)
IMPORT = tbutton("IMPORT", 680, 150, 90, 22, BTNBG, BTNON, TXT, CYAN,   bord=BTNBORD, pres=False)
EXPORT = tbutton("EXPORT", 680, 178, 90, 22, BTNBG, BTNON, TXT, CYAN,   bord=BTNBORD, pres=False)
LIST   = tbutton("LIST",   680, 206, 90, 22, BTNBG, BTNON, TXT, CYAN,   bord=BTNBORD, pres=False)
TEST   = tbutton("TEST ▶", 680, 234, 90, 22, BTNBG, BTNON, TXT, VIOLET, bord=BTNBORD, pres=False)
SPEED  = livetab(680, 262, 200, 24, ["VINTAGE", "STANDARD", "FAST", "TURBO"], 1, pres=False)

# ============================ PATCHING (hidden) =============================
PY = 230
patch("nsx", "sysexin", 16, PY, 60, 1, 1)
patch("npre", "prepend byte", 16, PY + 36, 90, 1, 1)
patch("node", "node.script sysex-device.js", 16, PY + 80, 180, 1, 2,
      {"saved_object_attributes": {"autostart": 1, "defer": 0, "node_bin_path": "",
       "npm_bin_path": "", "watch": 1},
       "textfile": {"text": "", "filename": "sysex-device.js", "flags": 0,
                    "embed": 1, "autowatch": 1}})
patch("rte", "route sysex status menu", 16, PY + 124, 150, 1, 4)
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
# --- presets glue (dropdown select / typed name / save / send-current) ---
patch("psel", "prepend selectpreset", 16, PY + 236, 130, 1, 1)   # pmenu index -> node
patch("pnm",  "prepend setname",      150, PY + 236, 110, 1, 1)  # textedit text -> node
patch("tsave",   "t b b", 270, PY + 236, 50, 1, 2)               # SAVE: bang name THEN save
pmsg("msave",    "savepreset",   270, PY + 268, 80)
patch("tsaveas", "t b b", 360, PY + 236, 50, 1, 2)               # SAVE AS: bang name THEN save-as
pmsg("msaveas",  "savepresetas", 360, PY + 268, 90)
patch("ssend", "t b", 450, PY + 236, 50, 1, 1)                   # SEND PATCH -> transmit selected
pmsg("msnd",   "sendcurrent", 450, PY + 268, 80)
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
line("rte", 2, "pmenu", 0)           # route(menu)   -> dropdown (clear/append <name>)
line("rte", 3, "glue", 0)            # route(rest)   -> liveglue
line("glue", 0, "node", 0)           # liveglue -> node
line("ltd", 0, "mrescan", 0)
line("mrescan", 0, "glue", 0)

# UI -> node
line(ARM, 0, "sarm", 0); line("sarm", 0, "marm", 0); line("marm", 0, "node", 0)
# WIRED dashboard buttons:
#   RECEIVE PATCH -> sarm("t b") -> "arm"        (capture next dump from synth)
#   SEND PATCH    -> ssend("t b") -> "sendcurrent" (transmit selected preset / last dump)
line("rcvbtn2", 0, "sarm", 0)
line("sndbtn2", 0, "ssend", 0); line("ssend", 0, "msnd", 0); line("msnd", 0, "node", 0)
# fan each card's click bang to its LED so the press FLASHES (reliable [button] blink)
line("rcvbtn2", 0, "ledRcv", 0)
line("sndbtn2", 0, "ledSnd", 0)

# --- presets wiring ---
# dropdown select -> set current preset (no send)
line("pmenu", 0, "psel", 0); line("psel", 0, "node", 0)
# typed name -> node (also fires on Enter / focus-out, keeping pendingName fresh)
line("pname", 0, "pnm", 0); line("pnm", 0, "node", 0)
# SAVE / SAVE AS: [t b b] fires RIGHT outlet first (bang the name field so its text
# reaches node as "setname …"), THEN the LEFT outlet (the save message). FIFO into
# node guarantees pendingName is set before the save runs.
line("bsave", 0, "tsave", 0)
line("tsave", 1, "pname", 0); line("tsave", 0, "msave", 0); line("msave", 0, "node", 0)
line("bsaveas", 0, "tsaveas", 0)
line("tsaveas", 1, "pname", 0); line("tsaveas", 0, "msaveas", 0); line("msaveas", 0, "node", 0)
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
    "rect": [100.0, 100.0, 368.0, 200.0],
    "openinpresentation": 1,
    "default_fontsize": 11.0, "default_fontname": "Arial",
    "gridsize": [8.0, 8.0],
    "boxes": boxes, "lines": lines,
}}

js = json.dumps(patcher, indent=4).encode("utf-8")
payload = js + b"\x00"
def chunk(tag, data): return tag + struct.pack("<I", len(data)) + data
blob = chunk(b"ampf", b"mmmm") + chunk(b"meta", struct.pack("<I", 1)) + chunk(b"ptch", payload)
out = os.path.join(HERE, "Sysex Vault.amxd")
open(out, "wb").write(blob)
raw = open(out, "rb").read(); i = raw.find(b"ptch"); ln = struct.unpack("<I", raw[i+4:i+8])[0]
back = json.loads(raw[i+8:i+8+ln].rstrip(b"\x00").decode("utf-8"))
print("wrote %s (%d bytes), boxes=%d, lines=%d, json reparses OK"
      % (out, len(raw), len(back["patcher"]["boxes"]), len(back["patcher"]["lines"])))
