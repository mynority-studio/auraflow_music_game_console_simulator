# GU CP-80 Electric Grand / Chorused FM EP Integration

Date: 2026-07-10

## Scope

- Replaced Aura25 production bank `0:5` with the CP-80 layer from GeneralUser `0:2 Electric Grand Piano`.
- Added GeneralUser `8:5 Chorused FM EP` as an additional production-bank audition preset.
- Kept the Copych/ESP32 target at native `24 kHz`.
- Dropped the duplicate GeneralUser Grand Piano layer because Aura25 already ships its own `0:0` piano.

## Source Assets

- The temporary piano audition banks were folded into Aura25 and removed from runtime delivery.
- Runtime outputs:
  - `public/Aura25_GM128.sf2`

## Resulting Presets

| Preset | Name | Referenced samples | Footprint | Hidden sends |
| --- | --- | ---: | ---: | --- |
| `0:5` | `GU Electric Grand` | 8 | `0.317MB` | reverb `0`, chorus `0` |
| `8:5` | `GU Chorused FM EP` | 7 | `0.221MB` | reverb `0`, chorus capped at `80` |

The full runtime SF2 is `1.64MB` and all sample headers report `24000 Hz`.

## v4.4 Slimming Pass

- Removed the duplicate runtime SF2 `public/Aura25_GM128_generaluser_folkguitar_24k_locked.sf2`.
  It was byte-identical to `public/Aura25_GM128.sf2` (`sha256 293a282c780ea450beed43d3bf3475af468a91359043692fdbde020b57b12d10`), so this saves `1,724,040` repository/runtime bytes without changing sound.
- Kept only `public/Aura25_GM128.sf2` as the Aura25 delivery file; `AURA25_SF2_URL` now points to it directly.
- Audited the `0:5 GU Electric Grand` CP-80 sample payload: 8 samples, `332,568` referenced bytes, all `24000 Hz`.
- Exact and near-zero leading/trailing silence in those 8 CP-80 samples is `0` frames. Further PCM trimming would cut looped musical material, so no destructive trim was applied.

## Notes

- `0:5` now uses CP-80 multisamples only, so it no longer depends on the old short `EPiano2`/DX7-style production preset and does not duplicate Aura25's existing GM0 piano.
- `8:5` keeps the GU DX7 Strike/Wave material as an optional chorused FM EP, but its hidden send values are bounded so Copych zone-send behavior cannot flood the shared FX bus.
- Music generation consumes `8:5` for RNB/lofi `lead` GM5 parts. `comp` GM5 stays on dry `0:5` CP-80 to avoid chorused multi-note mud.
- Rendered IR now carries an optional `bank` field; MIDI export emits `CC0/CC32` before `Program Change`. Generated drums explicitly select bank `128`.
- The legacy `clean_aura25_sf2.py` GM5/DX7 release/gain special case was removed to avoid accidentally rewriting the new Electric Grand as if it were the old FM piano.
- v4.4 runtime ships only one Aura25 SF2. The duplicate locked filename matched `public/Aura25_GM128.sf2` byte-for-byte and was removed.

## Verification

- `pnpm exec vitest run src/core/sound/Aura25Palette.test.ts src/core/audio/copychOutputChainGuards.test.ts src/core/generation/newEngine/knowledge/songSpaceDelay.test.ts src/core/generation/newEngine/instrumental/gmMixProfile.test.ts src/core/generation/newEngine/render/renderMixBalance.test.ts`
- `python3 -m py_compile tools/soundfont/dampen_guitar_sends.py tools/soundfont/clean_aura25_sf2.py`
- `pnpm build`
- `pnpm test`
