# SysEx Clip Manager — De-risk Spikes

Throwaway experiments to validate the riskiest assumptions **before** building the
device. Each ends in go / no-go / pivot.

## Status

| # | Spike | Runnable headless? | Status |
|---|---|---|---|
| 3a | Duplicate-reconciliation **logic** (collision → re-mint → copy-on-write → idempotent) | ✅ yes | **DONE — 30/30 tests pass** (`test/identity.test.js`) |
| — | Parser on a **real `.syx` from disk** | ✅ yes | **DONE** — `data/test-dx7-vced.syx` → `Bass - Yamaha - TEST LEAD1` |
| 1 | `[sysexin]` captures a real large dump intact | ❌ needs Max + synth | **TODO (you)** |
| 2 | Dict payload round-trips `.als` save/load → 2nd machine | ❌ needs Max + Live | **TODO (you)** |
| 3b | Clip name (`⟨sx:UUID⟩` tag) survives Live save/load + duplicate | ❌ needs Live | **TODO (you)** |
| 4 | Transmit audibly loads a patch + measure dump time | ❌ needs hardware | **TODO (you)** |

The logic half of the architecture-critical spike (3a) is proven; what remains for
#3 is purely "does Live preserve the clip name" (3b). Use the included
`data/test-dx7-vced.syx` as the payload for #1/#4. `src/sysex.js` + `src/identity.js`
run directly inside a Node-for-Max `node.script` object — no porting.

---

## Spike 1 — `[sysexin]` captures a real large dump intact
**Question:** can Max reliably receive a full, large SysEx dump?
**Setup:** new M4L MIDI Effect; `[sysexin]` → `[zl group 100000]`/`[node.script]` accumulator; print length + first/last bytes.
**Steps:**
1. Connect a synth; pick its smallest single-patch dump first, then its **largest** (a full bank / cartridge — DX7 32-voice ≈ 4 KB; bigger synths far more).
2. Trigger the dump from the synth.
3. Log: total byte count, that it starts `F0` ends `F7`, message count.
**Pass:** byte count matches the synth's expected dump size; framing intact; repeatable 5/5 times back-to-back.
**Fail signals:** truncated/short counts, dropped bytes on large dumps, missing `F7`, only-first-message captured on multi-message banks.
**If fail:** try `node.script` raw MIDI / a longer accumulation timeout / chunked framing before declaring no-go.

## Spike 2 — payload survives `.als` save/load and machine transfer
**Question:** does a SysEx payload stored in the device persist in the project and travel?
**Setup:** device stores a base64 blob in a `[dict]` (or `pattrstorage`) that is saved with the device.
**Steps:**
1. Load `data/test-dx7-vced.syx` into the device's Dict (base64).
2. **Save** the Live Set. Close Live. Reopen → confirm the blob is still there, byte-identical (compare length + checksum).
3. Copy the `.als` (and project folder) to a **second machine**; open → confirm the blob is intact.
4. Stress: store **many/large** dumps (e.g. 50× a big bank); re-check Set save time and file size.
**Pass:** blob byte-identical after reload and after transfer; Set size/save time acceptable with realistic volume.
**Fail signals:** blob missing/empty/truncated after reload; Set bloat or save hangs with volume.
**If fail:** pivot storage to a project-folder sidecar file + a "Collect" helper (documented in ARCHITECTURE R4).

## Spike 3b — clip name survives save/load + duplicate
**Question:** is the clip **name** (our identity carrier) actually preserved by Live?
**Steps:**
1. Name a MIDI clip exactly: `Riff ⟨sx:1a2b3c4d⟩` (copy the tag verbatim).
2. **Save / close / reopen** → confirm the name (tag included) is byte-identical.
3. **Duplicate the clip** (and **duplicate the track**) → confirm the copy carries the **same** name+tag (this is the expected collision our reconciler fixes).
4. Confirm the `⟨ ⟩` unicode characters survive (if Live mangles them, switch the tag to ASCII like `[sx:1a2b3c4d]`).
**Pass:** tag survives save/load exactly; duplicates copy it verbatim (so reconciliation has something to detect).
**Fail signals:** Live truncates/strips/normalizes the name or the unicode marker.
**If fail:** change the tag encoding (ASCII, shorter) — the reconciler logic is encoding-agnostic.

## Spike 4 — transmit loads a patch + timing
**Question:** does sending the dump actually load the patch, and how long does it take?
**Steps:**
1. `[midiout]` (or `node.script`) the bytes of `data/test-dx7-vced.syx` to the synth's MIDI port.
2. Confirm the synth **audibly** loads the patch (edit buffer / the named voice).
3. **Measure** elapsed transmit time for the small dump and for a large bank; note any synth-side apply delay.
4. Try with/without inter-message throttle on a slow synth.
**Pass:** patch loads reliably; you have real numbers for dump duration (drives the "patch-before-notes" timing design, ARCHITECTURE R2).
**Fail signals:** synth ignores it (wrong device-id/port), partial loads, or dump time so long that pre-launch sending is impractical.
**If fail:** verify port/device-id; add throttle; reconsider send-on-select vs send-on-launch.

---

### Go/no-go
- **#3b is the make-or-break.** If the clip name doesn't survive save/load (even with an ASCII tag), the whole "association follows the clip" premise needs rethinking — stop and redesign before building the device.
- #1, #2, #4 failing are usually *fixable* (different MIDI path, sidecar storage, throttling) rather than architecture-killing — but measure before committing.
