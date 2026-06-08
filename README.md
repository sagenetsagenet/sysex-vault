# Sysex Vault

**Total recall for hardware-synth patches in Ableton Live.** Attach a synth's SysEx
patch dump to a clip — when that clip plays, the device sends the dump back to the
synth so it loads the exact patch. Per-track, self-configuring, no port wrangling.

A Max for Live device (Live 12 + Max for Live). One instance per MIDI track.

---

## Download / install

1. Grab **`device/Sysex Vault.amxd`** (keep the `device/` and `src/` folders
   together — the device loads its code from `../src/`).
2. In Live, on a **MIDI track that drives a hardware synth via an External Instrument**,
   drop the device on **before the External Instrument** in the chain.
3. Set the track's **MIDI From** to the synth's input port and **Monitor → In** so
   incoming dumps reach the device.

That's it — the device reads everything else it needs from the track.

> **First load:** if the Max console shows `Cannot find module 'max-api'`, click the
> hidden **`script npm install`** then **`script start`** once (Node-for-Max bootstrap).

---

## How to use it

The panel:

```
 ◢◤  S Y S E X · V A U L T  ◣◥
 ┌────────┐   ◄ XMIT SPEED ►
 │ ◉ ARM  │   [VINTAGE][STANDARD][FAST][TURBO]
 └────────┘   ½×1562  1×3125 std  2×6250  4×12500 B/s
 [IMPORT] [EXPORT] [LIST] [TEST ▶]
 > READY                                  (status LCD)
```

**Capture a patch**
1. Click **`◉ ARM`** (or key-map it via Live's Key Map mode for a one-key command).
2. Send the patch dump from the synth (its "bulk dump"/"send" function).
3. The device stores it and **auto-creates a clip** out in the Arrangement (parked
   around bar 999, staggered so multiple synths don't collide), named like
   `TEST LEAD1 [sx:1a2b3c4d:f20df031]`.

**Recall a patch** — just **play the parked clip** (locate to it and hit play). The
device sends the stored dump downstream to the synth; the patch loads. Sweeping the
transport through a row of parked clips re-initializes a whole rig in sequence.

**Buttons**
- **IMPORT** — load a `.syx` from disk; it's stored *and* parked as a clip.
- **EXPORT** — save the last captured/imported dump to a `.syx`.
- **LIST** — show the dump library count on the LCD (details in the Max console).
- **TEST ▶** — re-send the last dump (handy for trying speeds).

**XMIT SPEED** — the SysEx transmit rate. `3125 B/s` (STANDARD) is the full
bandwidth of a standard MIDI cable (31.25 kbaud ÷ 10 bits/byte) and the safe
default. **VINTAGE** (½×) paces the bytes for old synths that drop data at full
speed; **FAST**/**TURBO** push harder over USB. Throttling happens between whole
SysEx messages, so individual messages are never fragmented.

---

## How it works (the short version)

- **No port management.** Capture is `[sysexin]` reading the track's MIDI input;
  transmit is a no-port `[midiout]` that injects downstream into the chain — the
  External Instrument forwards the SysEx to the synth. So the device just needs to
  sit on the track, before the External Instrument.
- **Persistence without the Live Set.** Dump *bytes* live in a content-addressed
  file store (`~/Music/Ableton/User Library/Sysex Vault/dumps/<hash>.syx`,
  deduped). The clip→dump *link* lives in the clip **name** as `[sx:uuid:hash]`,
  which Live preserves across save/load and duplicate. Nothing is written into the
  `.als` (the Live Set dict can't carry this data reliably in Live 12).
- **Duplicate a track** and its parked clip comes along; the device detects the
  identity collision, re-mints the clip's UUID (keeping the patch), and re-staggers
  it to a fresh bar so there's no double-fire.

---

## Requirements & limits

- **Ableton Live 12 + Max for Live.** macOS (a Windows port is untested).
- **Open limit:** Live's native `[sysexin]` is documented to truncate SysEx over
  ~3072 bytes at runtime. Small/medium dumps are fine; very large banks may need a
  more robust receive object (a future option).
- **Machine transfer:** dumps live on disk, not in the Set — moving a project to
  another machine needs the `dumps/` files copied alongside it (a "collect" helper
  is planned).

---

## Development

Pure, Node-for-Max-compatible engine with a headless test suite:

```
node test/sysex.test.js      # parser + 777-entry MMA manufacturer table
node test/identity.test.js   # clip-name identity + duplicate reconcile (+hash refs)
node test/library.test.js    # content-addressed dump library
node test/store.test.js      # file store
node test/placement.test.js  # stateless bar-stagger
```

155 tests total. The device patch is generated headless:

```
python3 device/gen_amxd.py   # writes device/Sysex Vault.amxd
```

- `src/` — the tested engine (sysex / identity / library / store / placement).
- `device/sysex-device.js` — Node-for-Max glue (capture, park, transmit, throttle).
- `device/liveglue.js` — the LiveAPI layer (`[js]`): own-track clip create/observe,
  transport-triggered playback, duplicate reconcile.
- `device/probe.js`, `device/sxpass.js` — throwaway LiveAPI probes used to de-risk
  the design (kept for reference).
- `ARCHITECTURE.md`, `SPIKES.md` — the original design + de-risk record.

---

## License

MIT — see [`LICENSE`](LICENSE). The MIDI manufacturer ID table in
`src/manufacturers.js` is an independent SAGENET compilation scraped from the
MIDI Association's public registry (`scripts/scrape_mma.js`); see
[`NOTICE.md`](NOTICE.md) for provenance and attribution detail.
