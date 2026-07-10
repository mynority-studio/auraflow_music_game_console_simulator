# FluidR3_GS Electric Piano Candidate Audit

Source:

- `/Users/mynority/.codex/attachments/27738f0c-fbd0-439a-b63b-b16d30c394bc/FluidR3_GS.sf2`

Result:

- This file is not the full FluidR3 GM instrument bank.
- `INFO/INAM` reports: `Fluid R3 GS+SFX Portion`.
- The file contains 33 presets, all in GS/SFX ranges.
- It does not contain GM bank 0 program 4 or program 5.
- It does not contain usable electric piano/Rhodes/FM EP preset, instrument, or sample names.

Preset list:

```text
128:56 SFX
2:120 String Slap
1:121 Fl. Key Click
1:120 Gtr. Cut Noise
1:124 Telephone 2
3:122 Wind
4:122 Stream/River
4:124 Scratch
8:125 StarShip
1:127 Machine Gun
2:126 Screaming
2:123 Horse Gallop
1:126 Laughs
7:125 Jet Plane
6:125 Train
5:126 Footsteps
5:125 Siren
5:124 Wind Chimes
5:122 Bubble
4:126 Heart Beat
4:125 Car-Crash
3:127 Explosion
3:126 Punch
3:125 Car-Pass
3:124 Door Slam
3:123 Bird  2
2:127 Lazergun
2:125 Car-Stop
2:124 Door Creaking
1:125 Car-Engine
1:123 Dog
1:122 Rain
2:122 Thunder
```

Decision:

- Do not delete or replace the current GM5 FM electric piano from this source, because doing so would leave GM5 without a valid instrument candidate.
- To audition replacement FM/Rhodes electric piano candidates, use the full FluidR3 GM bank or another SF2 that actually contains GM4/GM5 electric piano presets.
