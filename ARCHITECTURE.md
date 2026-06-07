# Ableton Live SysEx Clip Manager — Architecture & Feasibility

**Status:** Design draft, 2026-06-05.
**Confidence key:** ✅ verified firsthand (this codebase/session) · 🟢 high (established knowledge) · 🟡 medium — *spike to confirm* · 🔴 known blocker / open problem.

---

## 0. Executive summary & verdict

**The single most important finding:** neither the Ableton Extensions SDK nor the
Live Object Model (LOM, used by Max for Live) exposes a **persistent unique clip
identifier**. Clip handles/ids in both layers are **runtime-only** — they change on
every project reload and are meaningless across machines. 🔴 Everything in this
brief about "association surviving save/load, duplicate, and transfer" hinges on
solving this ourselves. It is the project's central engineering problem, not a
detail.

**Second finding:** the **Extensions SDK cannot touch MIDI at all** — no SysEx
in/out, no port access. ✅ (Verified: the SDK's entire surface is tracks, clips,
devices, scenes, params, audio render/import, context menus, dialogs. No MIDI
I/O exists.) Therefore **all SysEx transmit/receive must be Max for Live.** The
Extensions SDK cannot be the engine; at most it's a UX layer.

**Recommended architecture: Hybrid (Option D), built in two phases.**
- **Phase 1 / MVP — pure Max for Live (Option A):** one master M4L device owns
  SysEx I/O, the project-local library, clip-launch detection, and the UI.
  This proves every *hard* capability in the one environment that has them.
- **Phase 2 / Production — add the Extensions SDK as a thin UX shell:** its
  *only* unique value is the native right-click **clip context menu** ("Receive
  SysEx Dump") — Max for Live **cannot** add items to Live's context menus; the
  SDK can. ✅ The SDK reads the clicked clip and pokes the M4L device over a
  localhost bridge.

Do **not** start with the hybrid. Every genuinely hard capability lives in M4L;
prove those first. The SDK is sugar layered on a working M4L core.

**Feasibility verdict:** the core product is **feasible** but **not fully native
and not zero-friction** — two requirements ("clip-launch auto-sends the patch
transparently before notes" and "duplicated clips keep independent associations
automatically") are achievable only with active workarounds that carry real
reliability caveats. A reliable, useful MVP is very achievable; a flawless
"total recall, zero intervention" product is a hard target with honest asterisks.

---

## 1. Architecture proposal

### 1.1 Why not each pure option

| Option | Verdict | Why |
|---|---|---|
| **A. Master M4L device (project-wide DB)** | ✅ Best MVP core | Only environment with SysEx I/O, clip observation, and in-set persistence. Weakness: no right-click clip menu; UI is a device panel, not "in" the clip. |
| **B. Per-track M4L device** | ❌ | Multiplies state, complicates a *project-wide* library and cross-track dedupe, and still can't add context menus. Per-track device is useful only as a **MIDI-output shim** (see 1.3), not as the store. |
| **C. Extensions SDK backend** | ❌ as engine | SDK has **no MIDI** ✅ — cannot send/receive SysEx at all. Cannot be the engine. |
| **D. Hybrid (M4L core + SDK shell)** | ✅ Production | M4L does the work; SDK adds the native right-click entry point. Cost: a cross-process bridge (they can't call each other directly). |

### 1.2 Recommended component diagram (Phase 2 / production hybrid)

```
            Live right-click on a MIDI clip
                        │
                        ▼
   ┌──────────────────────────────────────────┐
   │  Extensions SDK extension (Node.js host)  │   ← ONLY does: context-menu items,
   │  "Receive/Send/Import/Export SysEx Dump"  │     reads clicked clip's name(→UUID),
   │  reads clip.name (embedded UUID)          │     relays intent over localhost UDP.
   └───────────────┬──────────────────────────┘     (No MIDI. No persistence of payloads.)
                   │  UDP localhost  {cmd, clipUUID}
                   ▼
   ┌──────────────────────────────────────────┐
   │     Master Max for Live MIDI device       │   ← THE ENGINE. One per Set, on any
   │  ┌────────────────────────────────────┐   │     MIDI track (or a dedicated track).
   │  │ SysEx I/O  [sysexin] / [midiout]   │   │   • receive/transmit SysEx
   │  │ Library (Dict/pattrstorage in .als)│   │   • project-local store (travels in Set)
   │  │ Clip-launch observer (LiveAPI)     │   │   • auto-send on launch
   │  │ Identity: mint+embed UUID in name  │   │   • duplicate reconciliation
   │  │ UI (clip panel + library browser)  │   │   • manufacturer/patch parsing
   │  └────────────────────────────────────┘   │
   └───────────────┬──────────────────────────┘
                   │ MIDI (SysEx) directly to the named hardware port
                   ▼
        ┌────────────────────────┐
        │  Hardware synthesizer   │
        └────────────────────────┘
```

### 1.3 The MIDI routing question (real, decide early) 🟡
The brief wants SysEx sent "to the same destination as the track's External
Instrument." Two ways:
- **(Recommended) Direct port targeting:** the master device's `[midiout]`
  targets the **named hardware MIDI port** directly, bypassing track routing.
  Reliable; SysEx definitely reaches the port. Cost: the device must *know* the
  port — read it from the External Instrument if the LOM exposes its routing
  (🟡 uncertain it does), else a per-instrument dropdown in the UI.
- **Through-track routing:** a tiny **per-track MIDI-output shim** emits SysEx
  into the track's own MIDI output chain so it follows the External Instrument's
  routing. Cleaner conceptually, but whether SysEx passes cleanly *through* the
  External Instrument device to the port is 🟡 — **spike this.**

---

## 2. Feasibility analysis

### 2.1 Max for Live — capability findings

| Question | Finding |
|---|---|
| Receive raw SysEx reliably? | 🟢 Yes — `[sysexin]` (or `[midiin]`+parse) captures full SysEx. 🟡 Caveat: very large dumps and back-to-back multi-packet dumps need buffering/timeout logic; reliability for *large* cartridge dumps must be spiked. |
| Transmit SysEx reliably? | 🟢 Yes — `[midiout]`/`[midiformat]` or a `js`/`node.script` byte stream to a chosen port. 🟡 Throttling may be needed for slow synths (inter-byte/inter-message delay). |
| Identify the currently selected clip? | 🟢 Yes — `live_set view detail_clip` / `highlighted_clip_slot`. (Note: this is the *one* selection capability the Extensions SDK lacks ✅.) |
| Observe clip **launch**? | 🟢 Yes — observe each track's `playing_slot_index` (or clip `playing_status`). Fires when a slot starts. |
| Persist large binary inside the project? | 🟡 Yes-with-care — a `[dict]` or `pattrstorage` saved with the device is written **into the `.als`**, so it travels with save/load/transfer. SysEx stored base64/hex. Concern: many large dumps bloat the Set and pattr/Dict aren't meant for MBs of binary — **size-test early.** |
| Add a right-click **clip context-menu** item? | 🔴 **No.** M4L cannot add items to Live's native context menus. This is the gap the Extensions SDK fills. |

### 2.2 Ableton Live 12 Extensions SDK — capability findings (✅ all verified this session)

| Question | Finding |
|---|---|
| Add clip context-menu items? | ✅ **Yes** — `registerContextMenuAction("MidiClip", …)`; the command receives the clicked clip's handle. (We ship this pattern already.) |
| Access clip metadata? | ✅ Partial — `name` (read/write), start/end, loop, color, muted, and MIDI **notes**. **No** SysEx, no arbitrary custom fields. |
| Create **persistent** clip associations? | 🔴 **No native mechanism.** The clip's only identifier is a runtime `Handle.id` (bigint) that does **not** survive reload. There is no clip UUID, no custom-metadata store keyed to a clip. The only writable, persistent, per-clip field is **`name`**. |
| Do SysEx / any MIDI I/O? | 🔴 **No.** The SDK has zero MIDI surface. Hard blocker for using it as the engine. |
| Talk to a Max for Live device? | 🔴 No direct API. ✅ But the SDK runs in a **Node.js** host, so it can bridge via **localhost UDP** or a **watched file** to M4L's `[udpreceive]`/file read. |
| Persist its *own* data? | 🟢 `environment.storageDirectory` gives per-extension persistent storage — but it's **global to the extension, not per-project**, so it's wrong for project-portable data. Project-local storage must live in the M4L device (in the `.als`). |

### 2.3 The clip-identity problem (the crux) 🔴
No persistent clip ID exists anywhere. We must **mint our own UUID and store it
where it travels with the clip.** The only per-clip property that survives
save/load **and** duplication **and** machine transfer is the **clip name**.

**Approach:** embed a compact tag in the clip name, e.g.
`My Riff ⟨sx:1a2b3c4d⟩` (or a zero-width/parenthetical marker the user can ignore).
The visible name stays editable; the tag is the key into the library Dict.

**The duplicate paradox** 🔴 — duplication copies the *entire* name, so the copy
inherits the **same** UUID → collision. The brief explicitly wants duplicated
clips to be **independent**. There is **no "clip was duplicated" event** in either
layer. Resolution = active **reconciliation**: the master device periodically (or
on transport/selection change) scans all clips, detects two clips sharing one
UUID, and **re-mints** one of them, **copy-on-write**-ing the library entry
(the duplicate starts pointing at the same payload, then diverges when the user
assigns a new dump — exactly the Track1→Track2 story in the brief). This works
but is **heuristic**, not event-driven, and is the #1 reliability risk (see §8).

---

## 3. Data model

Project-local library, stored in the master M4L device's Dict (→ saved in `.als`).

```jsonc
// Top-level library object (one per Set)
{
  "schemaVersion": 1,
  "sysexLibrary": {
    "<dumpId>": {
      "id": "dump_7f3a…",            // payload identity (stable, content-addressable ok)
      "sysexData": "BASE64…",         // raw bytes, base64 (or hex); may be multi-message
      "byteSize": 4104,
      "checksum": "crc32:ab12…",      // integrity + dedupe
      "messageCount": 1,              // some dumps are multiple F0…F7 messages
      "manufacturerId": [0x43],       // 1- or 3-byte MMA id (raw bytes)
      "manufacturer": "Yamaha",
      "deviceFamily": "DX",           // best-effort
      "deviceModel": "DX7",           // best-effort
      "patchName": "Juno Pad",        // extracted if the model parser knows the offset
      "timestamp": "2026-06-05T18:00:00Z",
      "origin": "received|imported",
      "sourceFile": "Bass-DX7.syx"    // if imported
    }
  },
  // Clip association is INDIRECT: clipUUID → dumpId (copy-on-write friendly)
  "clipAssociations": {
    "<clipUUID>": {
      "clipUUID": "1a2b3c4d",         // the value embedded in the clip name
      "dumpId": "dump_7f3a…",
      "lastSeenTrackName": "Bass",    // metadata/UX only; NOT identity
      "lastSeenClipName": "My Riff",
      "destinationPort": "USB MIDI 1",// resolved/explicit MIDI out
      "sendOnLaunch": true
    }
  },
  // Runtime only (never persisted): which patch each port currently holds,
  // so we can skip redundant resends on launch.
  "_loadedState": { "USB MIDI 1": "dump_7f3a…" }
}
```

Notes: payloads keyed separately from associations → duplicate clips can share a
payload (copy-on-write) and diverge cleanly. `trackId`/`clipId` from the brief
are intentionally **demoted to non-identity metadata** because they aren't
persistent; `clipUUID` (name-embedded) is the real key.

---

## 4. Communication flows

### 4.1 Receive Dump
```
User right-clicks clip ─▶ SDK ext reads clip.name
   • if no ⟨sx:UUID⟩ tag → mint UUID, write it into clip.name
   • UDP →  M4L: { cmd:"receive", clipUUID }
M4L: arm [sysexin], show "listening…"
User dumps from synth ─▶ [sysexin] collects bytes until idle-timeout
M4L: parse manufacturer/model/patchName; base64; checksum
M4L: store payload → sysexLibrary[dumpId]; clipAssociations[clipUUID].dumpId = dumpId
M4L: name the dump "[Track] - [Manufacturer] - [Patch|Dump]"; update UI
```

### 4.2 Save Project
```
Live saves .als ─▶ M4L device state (Dict/pattrstorage) serialized INTO the .als
   → sysexLibrary + clipAssociations travel with the Set automatically.
   (Clip UUIDs already live in clip names, also in the .als.)
No sidecar files required → portable to another machine. 🟡 verify Dict-in-Set size behavior.
```

### 4.3 Load Project
```
Live loads .als ─▶ M4L device restores Dict
M4L: reconciliation pass —
   • for each MIDI clip: read ⟨sx:UUID⟩ from name
   • rebuild a live map: clipUUID → (track,slot) runtime handles
   • detect collisions (duplicate UUIDs) → re-mint + copy-on-write
   • orphans (assoc with no clip / clip with no payload) → flag in UI
_loadedState cleared (we don't know hardware state after load).
```

### 4.4 Launch Clip
```
playing_slot_index changes ─▶ M4L sees clip C start on track T
   • clipUUID = parse C.name ; dumpId = clipAssociations[clipUUID]?.dumpId
   • if none → do nothing (normal playback)
   • port = destinationPort
   • if _loadedState[port] == dumpId → SKIP (already loaded) ──┐ (dedupe, avoids re-dumping every launch)
   • else: transmit SysEx to port (throttled) ; _loadedState[port]=dumpId
   • 🔴 TIMING: large dumps take 10s–100s of ms to 1s+. To honor "patch THEN
     notes", either (a) accept that the synth applies the patch slightly late,
     or (b) have the device DELAY/buffer the clip's first notes until TX done
     (adds latency, complex), or (c) pre-send on clip SELECT, not launch.
```

---

## 5. MVP specification (smallest useful, pure Max for Live)

Goal: prove the hard parts, deliver real value, **no Extensions SDK yet.**
- One master M4L MIDI device. UI panel (no right-click menu — use device buttons).
- **Receive**: select a clip in Live → "Receive Dump" button → arm `[sysexin]`
  → store, parse manufacturer (table lookup) → auto-name `[Track]-[Mfr]-Dump`.
- **Identity**: mint UUID, embed in clip name; basic load-time reconciliation
  (collision re-mint).
- **Send on launch**: observe `playing_slot_index`; transmit associated dump to a
  **user-selected MIDI port** (dropdown), with the `_loadedState` dedupe.
- **Storage**: Dict-in-Set; survives save/load/transfer.
- **Import/Export `.syx`**: file read/write of raw bytes ↔ library.
- **Library browser**: list dumps (track, clip, manufacturer, size); rename; delete.
- Explicitly **out of MVP**: right-click clip menu, patch-name extraction, device-
  model detection, note-buffering for perfect patch-before-notes timing,
  multi-dump-per-clip.

**MVP de-risk order (spikes, do before committing):**
1. `[sysexin]` captures a real large dump intact (DX7 32-voice cartridge, a
   Roland/Elektron dump). 🟡
2. Dict/pattrstorage round-trips that payload through a `.als` save/load and to a
   second machine. 🟡
3. Clip-name UUID survives save/load + duplicate; reconciliation re-mints. 🔴
4. Transmit reaches the synth and loads the patch audibly; measure dump time. 🟡🔴

If 1–4 pass, the product is real. If any fails, that's the architecture pivot point.

## 6. Production specification (full)
- Extensions SDK shell: native right-click **Receive / Send / Import / Export /
  Rename** on MIDI clips; SDK↔M4L localhost-UDP bridge; auto-mint UUID on first
  touch.
- **Manufacturer detection**: full MMA manufacturer-ID table (see §  Manufacturer).
- **Model + patch-name extraction**: per-manufacturer parser modules (DX7 voice
  name, Roland address maps, Sequential, Korg, etc.) — pluggable, additive.
- Naming `[Track] - [Manufacturer] - [Patch|Dump]`.
- **Reliable patch-before-notes**: optional note-buffer mode (hold first events
  N ms / until TX complete); per-instrument transmit throttle; "load on select"
  pre-arm option for live performance.
- Multiple dumps per clip (multi-part/multitimbral synths); per-clip destination
  override; per-instrument default port read from External Instrument if exposed.
- Library: search/filter, dedupe by checksum, orphan cleanup, drag-reassign,
  bulk export, manufacturer/model facets.
- Robustness: integrity checksums, schema migration, conflict UI for duplicate
  reconciliation, "hardware state unknown after load → force resend" control.

## 7. Implementation plan / milestones
- **M0 — Spikes (1–2 wks):** the four MVP de-risk spikes above. Gate: go/no-go.
- **M1 — M4L receive+store+library (MVP core):** `[sysexin]`, Dict store, manufacturer
  table, auto-name, library browser, import/export `.syx`.
- **M2 — Identity & persistence:** UUID-in-name, save/load round-trip, load-time
  reconciliation + duplicate re-mint (copy-on-write).
- **M3 — Send-on-launch:** launch observer, port selection, `_loadedState` dedupe,
  transmit throttle; measure/handle timing.
- **M4 — Extensions SDK shell:** clip context-menu items + UDP bridge to M4L;
  auto-mint UUID from the SDK side.
- **M5 — Detection depth:** model + patch-name parsers (start DX7/Roland), naming.
- **M6 — Production hardening:** note-buffer timing mode, multi-dump, orphan/conflict
  UI, schema migration, docs, packaging (.amxd + .ablx + EULA/SDK-license review via Lex).

## 8. Risk analysis
| # | Risk | Sev | Mitigation |
|---|---|---|---|
| R1 | **No persistent clip ID; duplicates collide on shared name-UUID** | 🔴 High | Name-embedded UUID + active reconciliation (collision detect → re-mint → copy-on-write). Accept heuristic, not event-driven. Conflict UI in production. |
| R2 | **Patch-before-notes timing** (dumps are slow; not instant) | 🔴 High | `_loadedState` dedupe (don't resend same patch); optional note-buffer hold; "load on select" for live use; document the trade-off. |
| R3 | **Extensions SDK can't do MIDI or talk to M4L** | 🟢 Resolved | Keep all engine work in M4L; SDK is shell only; UDP/file bridge via Node host. |
| R4 | **Large binary in the `.als` via Dict/pattr** (bloat, limits) | 🟡 Med | Size-test early; hex/base64; dedupe by checksum; cap/warn; option to offload to a project-folder sidecar (with a "Collect" helper) if Set bloat is unacceptable. |
| R5 | **SysEx routing to the right hardware port** | 🟡 Med | Default to explicit port dropdown; attempt to read External Instrument routing from LOM (🟡); spike through-track SysEx. |
| R6 | **`[sysexin]` reliability for large/rapid dumps** | 🟡 Med | Idle-timeout framing, multi-message accumulation; spike worst-case devices; fall back to `node.script` MIDI if needed. |
| R7 | **User edits/strips the UUID from the clip name** | 🟡 Med | Use an unobtrusive marker; re-mint if missing; never rely on visible name for identity, only the tag. |
| R8 | **Clip name as identity is a hack** (collisions across same-named clips) | 🟡 Med | UUID is random, not the human name; the human part stays free-text. |
| R9 | **SDK beta + LOM changes across Live versions** | 🟡 Med | Pin to Live 12; keep SDK surface minimal (just context menu); isolate version-specific bits. |

## Manufacturer detection (parsing notes)
SysEx framing: `F0 <manufacturer-id> … F7`.
- **1-byte IDs** `0x01–0x7D`: e.g. Sequential `0x01`, Roland `0x41`, Yamaha `0x43`,
  Korg `0x42`, Kawai `0x40`, Oberheim `0x10` (🟢 well-known; **verify the full set
  against the official MMA table — do not hand-wave the long tail**).
- **3-byte extended IDs** begin `0x00`: `0x00 <hi> <lo>` — used by most newer/US/EU
  makers (Elektron, Novation, Access, Waldorf, etc.). 🟡 Exact triplets must come
  from the **official MMA Manufacturer ID list** — ship that table as data, don't
  guess values.
- **Universal**: `0x7E` (non-realtime) and `0x7F` (realtime) are not manufacturers
  (handle separately).
- **Model/patch-name extraction is per-manufacturer-proprietary**: e.g. Roland
  `F0 41 <dev> <model-id> <cmd> <address…>`; Yamaha DX7 voice name sits at a known
  offset in a voice/bulk dump. This is a **pluggable per-model parser library**,
  additive over time; MVP does manufacturer-only, then patch names per model.

---

## Appendix — why the Extensions SDK can't carry this (verified facts)
From direct inspection of the SDK this session: the public surface is
`Application/Song/Track/AudioTrack/MidiTrack/Clip/MidiClip/AudioClip/ClipSlot/
TakeLane/Device/DeviceParameter/Scene/CuePoint`, plus `Commands` (register/execute
*extension* commands only), `Ui` (context-menu actions, modal/progress dialogs),
`Resources` (render/import **audio** only), `Environment` (per-extension storage
dir, temp dir, locale). **No MIDI, no SysEx, no selection getter, no persistent
custom metadata, no inter-process API, no clip UUID.** Clip identity is a runtime
`Handle.id: bigint`. These are hard limits, not omissions I can code around.
```
```
