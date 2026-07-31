# MIDI Analysis Monitor

Read-only analysis for uploaded Standard MIDI Files. The result is a
`MidiAnalysisReport`; it is deliberately separate from `HarmonicPlan` and never
writes inferred material back into the generation engine.

## Supported scope

- Harmonic inference: SMF format 0/1 with PPQ time division.
- Diagnostic-only parsing: SMF format 2 and SMPTE time division.
- Byte-declared maps: tempo (`FF 51`), time signature (`FF 58`), key signature
  (`FF 59`), text/name events, physical tracks, channels, Bank/Program and CC.
- Inferred layers: note/pedal spans, Track×Channel lanes, lane roles, performed
  accents, meter candidates, measure map, register-based melody/accompaniment/
  bass parts, block/arpeggio/sustained textures, global/local key candidates,
  within-measure chord boundaries, independently decoded chord slices and a
  per-measure note layer.

## Evidence contract

Declared metadata and inferred musical meaning are never merged:

- `baseline` is a lossless analysis view over values explicitly present in the
  byte stream. Empty means “not declared”; it never silently receives 120 BPM,
  4/4 or C major.
- `source: declared` means the value was present in SMF bytes.
- `source: inferred` means the value was estimated from performed notes.
- Alternatives, confidence, evidence and warnings remain visible to the UI.
- Missing or ambiguous evidence may produce `unknown`/`N.C.` instead of a forced
  label.

## Analysis order

1. Parse the SMF and establish the declared baseline.
2. Pair notes and sustain-pedal releases, then inventory physical
   Track×Channel lanes.
3. Establish the meter and a measure map, including meter changes, pickup M0
   and partial measures.
4. Split mixed lanes only when a credible register gap and accompaniment
   texture both exist. A top note is not automatically called melody.
5. Detect chord-change boundaries inside each measure from coordinated bass and
   accompaniment attacks plus pitch-set change. Repeated attacks of the same
   chord do not create a boundary.
6. Build one harmonic window per detected slice. Accompaniment and
   bass are retained as separate evidence vectors; primary and secondary
   metrical accents are retained separately. Melody is strongly reduced and
   drums carry no harmonic weight.
7. Decode every chord slice independently from accompaniment quality plus the
   main-beat bass/root or inversion. Weak bass passing notes cannot outvote the
   downbeat simply by accumulating duration. No key, preceding chord,
   following chord, Roman function or cadence prior may alter the result.
8. Refine global major/minor only after chords are fixed, using the pitch
   profile, decoded bass/comp chord roots and qualities, and final tonic
   bass/chord.
   Build non-overlapping local-key blocks of up to four measures using the same
   evidence. A declared key signature is a weak prior, not a forced answer.
9. Revisit every sounding note in every overlapping measure. Record its metric
   and performed accent, chord/scale membership, melodic function
   (passing/neighbor/anticipation/suspension/appoggiatura/escape) and
   backbone/ornament score. Strong beats increase structural weight but do not
   override a supported non-chord-tone interpretation.

## Release gates

Run:

```sh
npm run test:midi-analysis
npm run audit:midi-analysis
```

The test gate locks exact metadata extraction, 4/4 and changing-meter measure
boundaries, pickup handling, register voice separation, block/arpeggio
classification, downbeat backbone vs passing/appoggiatura distinctions and one
or more independently identified chord slices per measure. The benchmark additionally
locks clean GM role classification, key Top-1 on the controlled corpus,
duration-weighted chord root/type accuracy, boundary F1, determinism, input
immutability and a 5000-note performance budget.

These gates describe the clean controlled corpus, not arbitrary MIDI. Mixed
single-channel piano without a clear register gap, melody embedded inside close
voicings, modal/atonal music, polychords, missing bar phase and dense jazz
extensions remain probabilistic and must keep their confidence/alternatives.
