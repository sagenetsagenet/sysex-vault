# Building the Max device shell (spike harness)

I can't reliably hand-author/verify a binary `.amxd` here, so this is the
~10-minute recipe to build the thin shell in Max around the **tested** logic.
All the brain is in `sysex-device.js` (which calls `../src/*.js`). The patch is
just cabling: MIDI in/out, a Dict, and a few buttons.

## Prereqs & layout
- Ableton Live 12 + Max for Live (Max 8).
- Keep the folder layout intact — `node.script` resolves `../src/*` relative to
  the script:
  ```
  sysex-clip-manager/
    src/    (sysex.js, identity.js, library.js, manufacturers.js)
    device/ (sysex-device.js, your .amxd lives HERE)
    data/   (test-dx7-vced.syx)
  ```

## Make the device
1. In Live: create a **MIDI track**, add **Max MIDI Effect** → **Edit** (opens Max).
   (MIDI Effect so it can see `[sysexin]`/`[midiout]` and the LiveAPI.)
2. Drop a **`[node.script sysex-device.js]`** object. Point it at
   `device/sysex-device.js`. (First time: it may run `npm install` — there are no
   deps, so it just resolves `max-api`, which Max provides.)
   - The Max window console shows `[sysex] device ready` when it loads.

## Wiring (objects → connections)
**Receive (Spike 1):**
- `[sysexin]`  →  `[prepend byte]`  →  `[node.script]`
  (`[sysexin]` emits each incoming SysEx data byte as an int; `prepend byte`
  turns it into `byte 240…` so it hits the script's `byte` handler, which
  accumulates F0..F7 and identifies the dump.)

**Transmit (Spike 4):**
- `[node.script]`  →  `[route sysex]`  →  `[midiout]`
  (the script sends `sysex 240 67 … 247`; `route sysex` strips the selector,
  leaving the byte list for `[midiout]`. Pick the synth's port on `[midiout]`.)

**Persistence (Spike 2):**
- Add a `[dict sysexLibrary]` object somewhere in the patch (name MUST be
  `sysexLibrary`). The script reads/writes it via `getDict/setDict`. Saving the
  Set saves the dict's contents with the device → travels in the `.als`.

**Buttons (message boxes → `[node.script]`):**
- `load` / `save`  — restore/persist the library
- `import data/test-dx7-vced.syx Bass`  — import the test dump (Spike 2 payload)
- `transmit dump_<id> USBMIDI1`  — send a dump (Spike 4); get `<id>` from the
  `received`/`imported` outlet or the console
- `arm <clipUuid> <trackName> <port>`  — receive the next dump into a clip
- `list`  — dump the library browser rows

## Running the spikes with this harness
- **Spike 1:** wire receive, dump a patch from the synth → watch the
  `[spike1] received N bytes …` console line. Try the largest bank; repeat 5×.
- **Spike 2:** `import …` the test `.syx` → `save` → save the Set → reopen →
  `load` → `list` and confirm it's intact; copy the `.als`+folder to a 2nd machine.
- **Spike 4:** `import …` then `transmit dump_<id> <port>` → confirm the synth
  loads the patch; time small vs. large dumps.
- **Spike 3b** needs no device — just name a clip `Riff [sx:1a2b3c4d]`, save/load,
  and duplicate it (see ../SPIKES.md).

## LiveAPI: launch-observer + reconcile (`[js liveglue.js]`)
LiveAPI lives in Max's **`js`** engine (not `node.script`), so this is a second
object. `liveglue.js` does ONLY LiveAPI I/O and hands every decision to node.

Add **`[js liveglue.js]`** and wire:
- **Launch → patch send:** `liveglue` observes each track's `playing_slot_index`;
  on launch it sends `launch <clipName>` out its outlet → `[node.script]`. Node
  runs `library.decideLaunch` (extract UUID → association → dedupe) and transmits
  if needed. So: `[js liveglue.js]  →  [node.script]`.
- **Reconcile (de-dupe identities):** send `reconcile` to `[js liveglue.js]`
  (e.g. on a `loadbang`-delayed bang, or a button). It gathers all session clips
  into Dict `reconcileClips`, then bangs `reconcile` to node. Node re-mints
  duplicate UUIDs (copy-on-write) and writes Dict `reconcileRenames`. Finally
  send `apply_renames` (a message) to `[js liveglue.js]` to write the new names
  back to the clips. So: `[node.script] (reconciled) → [delay] → message "apply_renames" → [js liveglue.js]`.
- Add the two extra `[dict reconcileClips]` and `[dict reconcileRenames]` objects
  (named exactly) so both engines see the same data.
- `[js liveglue.js]` calls `setupObservers()` on `loadbang`; send `rescan` after
  adding/removing tracks (auto re-observe is a flagged refinement).

> All decisions (which dump, dedupe, re-mint, copy-on-write) run in the **tested**
> node modules. `liveglue.js` is the only untested piece — pure LiveAPI cabling.

## Phase 2 (later)
- **Extension SDK shell:** the native right-click "Receive SysEx Dump" clip menu
  → localhost UDP → this device (see ../ARCHITECTURE.md §1.2). The SDK extension
  reuses `identity.extractUuid` to key the clicked clip.
