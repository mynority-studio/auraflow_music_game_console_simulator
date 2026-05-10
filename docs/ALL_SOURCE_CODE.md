# Source Code Export

## File Tree

```
/.env.example
/.gitignore
/AURA_ARCHITECTURE.md
/index.html
/metadata.json
/package-lock.json (Skipped for brevity)
/package.json
/public/GM128_3BM.sf2 (Binary soundfont - Skipped)
/src/
  App.tsx
  index.css
  main.tsx
  vite-env.d.ts
  core/generation/
    Dictionary.ts
    MelodyEngine.ts
    Orchestrator.ts
    PRNGManager.ts
    PlaybackEngine.ts
    types.ts
    groove/
      GrooveEngine.ts
      plugins/GroovePlugin.ts
      plugins/HumanizePlugin.ts
    harmony/
      GlobalVoicer.ts
      HarmonyCore.ts
      plugins/AnticipationPlugin.ts
      plugins/HarmonyPlugin.ts
      plugins/PassingChordPlugin.ts
    idioms/
      BaseAccompIdiom.ts
      IdiomDispatcher.ts
      IdiomUtils.ts
      LickDictionary.ts
      PianoBaseIdiom.ts
      PopPianoIdiom.ts
    instruments/
      ElectricBass.ts
      ElectricPiano.ts
      GrandPiano.ts
      StandardDrumKit.ts
    manifests/
      InstrumentRegistry.ts
      MusicianRegistry.ts
      StyleRegistry.ts
    melody/
      RhythmCells.ts
      ToplineEngine.ts
      plugins/PassingNotePlugin.ts
      plugins/ToplinePlugin.ts
    personas/
      AlexPopPiano.ts
      DavePopDrums.ts
      MarcusNeoSoulKeys.ts
      NinaChillJazzPiano.ts
    styles/
      ChillJazzStyle.ts
      NeoSoulStyle.ts
      PopStyle.ts
      Shared.ts
    theory/
      MusicTheory.ts
  core/utils/
    PRNG.ts
/test.ts
/test_penalty.ts
/tsconfig.json
/vite.config.ts
```

## Component & Architecture Overview

# AuraArchitecture

### Version Info -> Update Log
- **v2.6.4**: Piano Velocity Dampening & High-Frequency Smoothing (Elegant Dynamics Update).
  - **Involved Modules**: `BaseAccompIdiom.ts`.
  - **C++ Porting Impact**:
    - **Velocity Curve Translation**: Hardcoded multipliers spanning 0.8-1.15 in both generative rules and deterministic dictionaries generated jarring MIDI velocities (often translating to peak sample layers in the downstream SoundFont synthesizer). The `rhythmVel` baselines were substantially lowered and clamped (0.6 -> 0.45), representing an overall downward shift in the dynamic curve.
    - **High-Frequency Pitch Smoothing (Anti-Harshness)**: Implemented a linear velocity roll-off starting at C5 (`pitch > 72`). High notes are now computationally clamped against an attenuation formula: `vel *= Math.max(0.6, 1.0 - (pitch - 72) * 0.015)`. This translates well to a simple floating point math function in a C++ rendering layer, solving the "startling" harsh attacks that plague algorithmic piano generation algorithms without using expensive filtering DSP.

- **v2.6.3**: Advanced Jazz Harmony & Solo Routing Fixes (The "Not-Just-Random-Notes" update).
  - **Involved Modules**: `Orchestrator.ts`, `BaseAccompIdiom.ts`.
  - **C++ Porting Impact**:
    - **Demolished the Chord Meat Grinder**: Previously, the `Orchestrator` violently clamped any `pianoLH` note exceeding `67` back into `[48, 67]`. This crushed beautifully voiced upper extensions (9ths/11ths/13ths) derived by the micro-renderer into tight, dissonant tone clusters. The engine now exclusively isolates authentic structural bass notes (`absPitch < 44`) to `[28, 47]`, allowing intelligently-arranged shell timings to ring out naturally without being crushed.
    - **Intelligent Parameter Snapping for Linear Licks**: Linear runs previously possessed zero contextual awareness. `LickDictionary` static offsets blindly collided with minor intervals (e.g. major 3rd injected onto a minor chord). Both the 20% Lick injects and 80% programmatic scale runs (Linear RH role) now natively implement `MusicTheory.snapToPool` utilizing `corePitches` and `extPitches`. This maps seamlessly to an efficient bitmask or array lookup inside the tight C++ generation loop, ensuring zero dissonance dynamically instead of via hardcoded rules.
    - **Active Tenor Bounce Fallback**: When the right hand enters the `RHRole.Linear` / `RHRole.Arp` state (monophonic runs), it surrenders its thick block chord responsibilities. The left hand dynamically steps in to catch the dropped extensions, generating rootless shell voicings down an octave and extracting the top three color notes `shellNotes.slice(-3)`. In C++, this implies a small dynamic swap of the Voice Leading struct pointer between hands based on the active state.

- **v2.6.2**: Orchestration Bugfix (Absolute Register Isolation).
  - **Involved Modules**: `Orchestrator.ts`.
  - **C++ Porting Impact**:
    - **Frequency Separation Fixed**: Previously, `Orchestrator` violently forced ALL `pianoLH` notes to sit within `[28, 43]` (E1-G2) using unconditional bitwise-like wrapping. This mistakenly dragged mid-range (Tenor) left-hand chord voicings down into the sub-bass mud.
    - **Split Folding Logic**: Implemented conditional folding. The engine now looks at the locally authored pitch layout: if a note is authored natively under `< 44`, it wraps it inside the pure bass frequency gap `[28, 47]`. If authored above, it rigidly clamps it to `[48, 67]` (C3-G4), strictly achieving the "Anti-mud C3+ LH rule" described in the constraints without muting the actual bass anchor. This maps cleanly to two `if/else while` loops in C++.

- **v2.6.1**: Jazz Piano Engine Consolidation & Lick Dictionary Injection.
  - **Involved Modules**: `IdiomDispatcher.ts`, `BaseAccompIdiom.ts`, `LickDictionary.ts` (New), `JazzPianoIdiom.ts` (Deleted).
  - **C++ Porting Impact**:
    - **Delegation Consolidation**: Eliminated the redundant `JazzPianoIdiom.ts`. `IdiomDispatcher` now routes Jazz directly through `GenericPianoIdiom` (`BaseAccompIdiom.ts`) to leverage its highly advanced micro-rendering constraint solver (which already integrates Personas flawlessly).
    - **Lick Dictionary (Vocabulary)**: Implemented an abstract 80/20 mechanism. For 80% of playback, the solver dictates note physical constraints. For the remaining 20% (tied to `accompPersona.signatureLickProb`), the engine suspends its algorithmic loop, looks up an array of physical offsets (`LickDictionary.getRandomLick()`), and applies them as a rigid transposed batch. This provides "true" jazz flavor vocabulary linearly.
    - **Data Layout for Licks**: `LickDictionary` is written as pure declarative Plain Data arrays (relative pitch offsets & onset floats). This translates to a `const` memory block or `PROGMEM` lookup table in C++. Wait-states and loop-stepping strictly obey the predetermined duration `lick.durationBeats`.

- **v2.6.0**: Advanced Jazz Piano Idiom (Interactive Comping & "Leo" Persona Upgrades).
  - **Involved Modules**: `types.ts`, `Orchestrator.ts`, `JazzPianoIdiom.ts`.
  - **C++ Porting Impact**:
    - **Melody Context Injection**: Modified `MusicContext` to include a reference to `melody?: NoteData[]`. `Orchestrator.ts` now explicitly passes `track.melody` via context before delegating to `IdiomDispatcher`. This allows accompaniment idioms to implement true "Density Feedback" without breaking the forward-only data flow or adding new interface parameters to all idiom plugins. In C++, this is just passing a pointer to the `NoteData` array.
    - **Interactive Comping & Texture State Machine**: Rewrote `JazzPianoIdiom.ts` to implement 3 discrete dynamic textures (`TEXTURE_ROOTLESS`, `TEXTURE_STRIDE`, `TEXTURE_BLOCK_CHORDS`) switching algorithmically based on section energy and bassist presence (acting as a finite state machine without dynamic allocation).
    - **Left/Right Hand Call-and-Response**: Implemented density parsing loop (`check if melody is busy around this beat`) inside the idiom. When busy, comping mutes; when resting, it inserts off-beat jabs.
    - **Micro-timing & Articulation Mutation**: Provided an isolated internal routine `humanizeMelody(melody)` inside `JazzPianoIdiom.ts` that mutates `onset`, `duration`, and `velocity` of the Topline notes IN-PLACE to construct typical jazz horn-like articulations (staccato last-notes, micro-delay laid-back feel, and contour-peak accents). This is totally compatible with C++ via looping over `NoteData` flat arrays and updating primitives directly.

- **v2.5.0**: Master Style Resolution & 80/20 Persona Architecture.
  - **Involved Modules**: `types.ts`, `MelodyEngine.ts`, `Orchestrator.ts`, `IdiomDispatcher.ts`, `MusicianRegistry.ts`.
  - **C++ Porting Impact**:
    - **Global Style Hierarchy**: Modified `MelodyEngine` to traverse the `BandSetup`. The `MainInst` or `Vocal` musician's intrinsic `styleId` becomes the song's ultimate `globalStyleId`, forcing all harmony, BPM, and groove logic to lock to their genre constraints.
    - **Idiom Decoupling from Persona**: Removed `idiomId` from `MusicianProfile`. The base Idiom layer (e.g., `JazzPianoIdiom`) is now dynamically calculated inside `IdiomDispatcher` using exactly `(GlobalStyle, Instrument)`, proving that musicians adapt to the band's chosen genre.
    - **80/20 Persona Setup**: Introduced `signatureLickProb` and `lickPool` to `MusicianPersona`. This structural scaffolding enables the "80% Base Idiom, 20% Signature Lick" constraint solver requirement without breaking C++ determinism. Memory overhead remains bounded.

- **v2.4.1**: Voice Leading Pitch Creep & Collision Fix.
  - **Involved Modules**: `IdiomUtils.ts`.
  - **C++ Porting Impact**:
    - Fixed a critical "pitch creep" bug where upper chord extensions were unconditionally stacked above the highest core note (`while (target <= outVoicing[outVoicing.length - 1]) target += 12;`), causing the voicing center of density to drift exponentially upward into unplayable registers.
    - Bounded extension stacking to naturally fit within a strictly calculated 10th/11th span (`target < bass + 3`, `target > bass + 16`).
    - Added a discrete `penalty` to the A* distance formula for core inversions that place Minor/Major 2nd clusters at the bottom of the voicing list, automatically favoring cleaner lower intervals.
    - Disabled `Drop 2` for voicings with more than 4 notes. Forcing a Drop 2 on a 5+ note chord often crushed the inner voices into the bottom note, creating harsh bass-register dissonances.
    - All data structures remain flat arrays of pitches (`std::vector<int>` or fixed arrays in C++).

- **v2.4.0**: Complete Decoupling of Piano Idioms (Anti-Style-Leakage).
  - **Involved Modules**: `MusicianRegistry.ts`, `IdiomDispatcher.ts`, `PopPianoIdiom.ts`, `JazzPianoIdiom.ts`, `LofiPianoIdiom.ts`, `BluesPianoIdiom.ts`, `Orchestrator.ts`.
  - **C++ Porting Impact**:
    - Extracted the massive monolithic solver from `BaseAccompIdiom.ts` into specialized idiom classes that are dynamically dispatched based on the `IdiomType` enum mapped in the Musician's profile.
    - `Orchestrator` now explicitly relies on `IdiomDispatcher.generateAccompaniment(accompMusician.idiomId, ...)` instead of hardcoding `RhythmSectionIdiom`. This ensures maximum 1:1 mapping flexibility where C++ can utilize a fast array of function pointers.
    - Each idiom plugin acts completely decoupled without `if (style == 'Pop')` statements anywhere in the core orchestrator, fully enforcing the rule that Orchestrator just tosses blueprints to plugins.
    - Extracted common physics logic to `IdiomUtils.ts` (`calculateVoicing`) to respect DRY and memory optimization constraints while keeping phrasing distinct.

- **v2.3.2**: Unified Piano Instrument Mapping.
  - **Involved Modules**: `MusicianRegistry.ts`.
  - **C++ Porting Impact**:
    - Replaced all uses of `instrumentId: 4` (Electric Piano) with `instrumentId: 0` (Acoustic Grand Piano) across `AccompInst` personas to ensure a consistent, clear acoustic tone instead of potentially muddy EPiano samples.

- **v2.3.1**: Anti-Style-Leakage Fix (Velocity Physics Normalization).
  - **Involved Modules**: `BaseAccompIdiom.ts`.
  - **C++ Porting Impact**:
    - Removed hardcoded velocity inflation (`* 1.1`) and excessive top-note peaking (`1.15x`) which forced chord top notes to hit max velocity (127) and trigger overly bright SF2 layers (simulating a false pop melody).
    - Flattened the velocity multipliers for block chords (`0.95`, `0.90`, `0.85`) to ensure cohesive, warm jazz comping where all voices blend naturally. This enforces the rule that Rh should act as true accompaniment without artificially sticking out.

- **v2.3.0**: Lazy Jazz Style Integration (Syncopated Comping & Advanced Extensions).
  - **Involved Modules**: `MusicianRegistry.ts`, `StyleRegistry.ts`, `PlaybackEngine.ts`.
  - **C++ Porting Impact**:
    - Introduced `Jazz` style preset into `StyleRegistry` with highly extended harmonic progressions (ii9-V13-Imaj9) and robust 0.7 `swingRatio`.
    - Added `Duke (Lazy Jazz)` AccompInst persona leveraging extreme extensionUsage (1.0) and syncopation.
    - Added `Jones (Lazy Jazz)` Drums persona with laid-back feel.
    - Added `Ron (Upright Jazz)` Bass persona for deep walking upright bass.
    - Added hard toggle in `PlaybackEngine` to cleanly mute `arranged.melody` processing if no `MainInst` or `Vocal` is present in the `MusicContext.band`, reducing unnecessary MIDI event mapping for pure accompaniment mode.

- **v2.2.0**: Blues Style Enhancement (Global Swing & Walking Boogie Bass).
  - **Involved Modules**: `types.ts`, `StyleRegistry.ts`, `PlaybackEngine.ts`, `BaseAccompIdiom.ts`, `MusicianRegistry.ts`.
  - **C++ Porting Impact**:
    - Global abstract `swingRatio` added to `StyleConfig` and `MusicContext`.
    - Swing implemented centrally in `PlaybackEngine` `processTrack` mutating raw MIDI `time` calculations in place mathematically without looping or allocating structures.
    - Added `LHRole.Walking` semantic representation mapping high `busyLevel` and `syncopation` onto a fixed 4-beat Boogie-Woogie/Walking bass pattern with deterministic ghost notes.
    - Added explicitly dedicated Blues bassist persona `Willie (Walking Blues)` in `MusicianRegistry` demonstrating seamless scale and feature addition leveraging the new role infrastructure.

- **v2.1.0**: Leader-Driven Style Resolution & Predefined Musician Profiles.
  - **Involved Modules**: `App.tsx`, `MusicianRegistry.ts`, `types.ts`.
  - **C++ Porting Impact**:
    - Global abstract "style" selection is removed from the root orchestrator input. Instead, the `MainInst` (or fallback `AccompInst`) dictates the core genre, tempo, and harmoniy layout.
    - Encapsulated persona parameters into rigid `MusicianProfile` definitions (emulating static config manifests / JSON in C++) rather than arbitrary sliders.
    - Added `MusicianRegistry` as the single source of truth for available roles and their intrinsic properties.

- **v2.0.0**: 5-Role Band Architecture & Musician Personas (Anti-Style-Leakage).
  - **Involved Modules**: `types.ts`, `Orchestrator.ts`, `Idioms` (Decoupled & New), `UI/App.tsx`.
  - **C++ Porting Impact**:
    - Replaced monolithic `PianoIdiom` generation with a dedicated iterative loop over `BandMusician` array (Vocal, MainInst, AccompInst, Bass, Drums).
    - Introduced `MusicianPersona` struct (`busyLevel`, `syncopation`, `extensionUsage`, `dynamics`) to shift hard-coded style checks into math-driven modifier scalars.
    - Decoupled `PianoIdiom` into base physical constraints (e.g., `BaseAccompIdiom`, `BaseBassIdiom`) where the Persona drives the scoring matrix without needing arbitrary style string matching.
    - `MusicContext` now receives the isolated `BandMusician` configs securely, adhering strictly to the Anti-Style-Leakage rule.

- **v1.9.5**: Algorithmic Outro Strategies & Structural Cadences.
  - **Involved Modules**: `types.ts`, `MelodyEngine.ts`, `HarmonyCore.ts`, `Orchestrator.ts`.
  - **C++ Porting Impact**:
    - Added `OutroStrategy` enum (`FadeOut`, `Ritardando`, `SuddenStop`, `MotifDecay`, `Unresolved`) to govern the outro behavior.
    - Updated `MusicContext` to accept `outroStrategy` and pass it down the pipeline.
    - `HarmonyCore.ts` specifically overrides the final cadence for the `Unresolved` strategy (forces IV or vi) and manipulates `endBeat` duration for `Ritardando`.
    - `Orchestrator.ts` manipulates sub-track arrays during the Outro section to simulate fading, sudden stops (truncation of durations/onsets), and subtractive motifs (dropping drums/LH elements).
    - Ensures pure memory footprint without adding new heavy objects, relying on simple array filtration and mathematical property adjustment.

- **v1.9.4**: Left Hand Curing - Deep Root Lock & Ghost Notes.
  - **Involved Modules**: `PianoIdiom.ts`.
  - **C++ Porting Impact**:
    - Introduced state tracker `lhPlayedDeepRootThisChord` to prevent repetitive sub-bass hits.
    - Rewrote Constraint Solver for LH/RH hocketing (interlock), ensuring LH leaves room for RH fill and syncopation.
    - Revamped LH micro-rendering to separate primary bass hits from rhythmic bouncing ("Tenor Bounce") and ghost notes.
    - Memory overhead zero; uses standard primitives tracked functionally across loop iterations.

- **v1.9.3**: Timbre Separation & Phantom Singer Representation.
  - **Involved Modules**: `PlaybackEngine.ts`.
  - **C++ Porting Impact**:
    - Changed the default Melody (Channel 0) instrument from `0` (Acoustic Grand) to `73` (Flute). This eliminates the "two pianos" conflicting harmonic masking issue and distinctly separates the top-line melody ("Phantom Singer") from the piano accompaniment (`PianoRH` and `PianoLH` remaining on `0`).

- **v1.9.2**: Smooth Mix Reversion & Native Dynamics Reliance.
  - **Involved Modules**: `PlaybackEngine.ts`.
  - **C++ Porting Impact**:
    - Removed abrupt/stepped Dynamic `CC 10/91/7` injection per section loop.
    - Scrapped `Fake Sidechain Compression` (CC 11 pump) as it sounded disjointed over the engine's strict quantized time.
    - Solidified the `applyMixConfig` single-pass CC dump layout for static channel spacing, relying fully on the orchestration engine generating mathematically perfect Velocity mappings on note-events for expression. 
    - Reverted Playback loop lookahead/intervals to safe `0.5s` & `50ms` parameters saving ESP32 CPU overhead now that tight CC streams are omitted.

- **v1.9.1**: Dynamic Mix Engine & Fake Sidechain Compression.
  - **Involved Modules**: `PlaybackEngine.ts`.
  - **C++ Porting Impact**:
    - Discarded static configuration layout in favor of real-time `CC 10` (Pan), `CC 91` (Reverb), and `CC 7` (Volume) curve mappings bound to `context.sections` energy levels.
    - Implemented `Fake Sidechain Compression` triggering deterministic exponential volume recovery curves via `CC 11` (Expression) dynamically bound to `arranged.drums` 36 Kick onsets.
    - Added standard `type: 2` (Controller Change) event schema to `MidiEvent` for flat C++ struct mappings.
    - Dropped `PlaybackEngine` lookahead frame down to `0.1` and `timerWorker` to `25ms` for sufficiently real-time expression rendering tight enough for sidechain ducking.

- **v1.9.0**: Master Pianist Paradigm: Phantom Vocal Masking and Motif Locking.
  - **Involved Modules**: `PianoIdiom.ts`.
  - **C++ Porting Impact**:
    - Introduced a 4-bar deterministic structural mask (`Phantom Vocal Mask`) inside the physics rendering loop to conditionally mute random probabilities and give space for a theoretical lead vocal.
    - Added dynamic hand roles (`currentRHRole` mutation), dropping complexity to `RHRole.Block` during vocal-centric measures and injecting `RHRole.Linear` arpeggiated run-ups in the final structural measure pass (Turnaround fills).
    - Rewrote the constraint solver scoring (`The Masked Solver`) to violently penalize non-groove notes when the Mask is active.
    - Engineered `Smart Sustain` logic extending block chords manually across multiple beats by holding physics simulated foot-pedal length, drastically thinning MIDI data density while preserving harmonic support.

- **v1.8.1**: Mix Engine & Touch Dynamics Tuning.
  - **Involved Modules**: `PlaybackEngine.ts`, `PianoIdiom.ts`.
  - **C++ Porting Impact**:
    - Addressed severe frequency masking/boomy low-end by explicitly decoupling LH and RH MIDI CC 7 (Volume) limits context-wide.
    - LH base velocity equation decreased by 30% multiplier to suppress General MIDI soundfont thick organ-like resonance.
    - RH ghost notes inner-voice velocity ratio raised (from 0.55 back up to 0.75) and overall base multiplier slightly boosted to cut through the mix.

- **v1.8.0**: Piano Idiom "Master Pianist LH" Optimization (Physics/Velocity Engine tuning).
  - **Involved Modules**: `PianoIdiom.ts`.
  - **C++ Porting Impact**:
    - Replaced hard-coded power chords with Shell Voicing intervals (`thirdExt`, `fifthExt`, `seventhExt`).
    - Added `isAnticipation` logic to the Constraint Solver to push beats and increase humanization.
    - Simplified LH duration and velocity propagation physics (Micro-Strumming). No state tracking (`lastLhIdx`) needed anymore.
    - Updated RH multi-voice velocity scaling for ghost notes, drastically reducing the "Wall of Sound".

- **v1.7.0**: Architectural Decoupling of Harmony Generation (Anti-Style-Leakage Rule enforced).
  - **Involved Modules**: `HarmonyCore.ts`, `MelodyEngine.ts`, `types.ts`, `StyleRegistry.ts` (new).
  - **C++ Porting Impact**:
    - Extracted hardcoded major and minor progression pools out of `HarmonyCore.ts` and `App.tsx`.
    - Centralized all stylistic data (drum patterns, harmony progress, probs) into `StyleRegistry.ts` (Manifest).
    - `StyleConfig` strictly requires a `harmony` object (`StyleHarmonyConfig`), conforming to absolute data-driven architecture.
    - Added `SectionType` Enum to provide explicitly matched hooks into the `HarmonyProgressionPool`, enabling `StyleManifest`-driven song structures.

- **v1.6.1**: Panning & Mix Enhancement for Piano Hands.
  - **Involved Modules**: `PlaybackEngine.ts`.
  - **C++ Porting Impact**:
    - Right Hand (`pianoRH`) and Left Hand (`pianoLH`) are now mapped to separate MIDI Channels (1 and 2, respectively) instead of both on Channel 1.
    - Added precise `CC 10` panning values to split them aurally (LH panned left `43`, RH panned right `85`) mimicking physical piano keys, while sharing the same `CC 7` volume configuration (85) to ensure equivalent loudness.

- **v1.6.0**: Complete Harmony Integrity Audit: True Voicing Generation, Context-Aware Scale Snapping, and Unison Avoidance.
  - **Involved Modules**: `PianoIdiom.ts`, `Orchestrator.ts`.
  - **C++ Porting Impact**:
    - Replaced modulo-12 pitch class clustering with authentic Interval-Stack Voicing logic. Extensions (>11th) are safely stacked above Core triads, ensuring chord colors (e.g., 9ths don't become minor 2nds at the bottom).
    - `Orchestrator.ts` now explicitly passes `MusicContext` into `PianoIdiom.generateAccompaniment`.
    - `Linear` RH runs now utilize `MusicTheory.snapToScale` via the passed `context.tonality` to guarantee melodic phrasing stays strictly diatonic, completely resolving "out of tune chromatic wander".
    - Left Hand explicitly generates true 5ths for Diminished/HalfDiminished/Augmented chords instead of a hardcoded `+7` semi-tones interval, preventing dissonant minor 2nd clashes on the bass.
    - Added Unison Avoidance filter checking `pianoLH` against `selectedNotes` to drop duplicate pitches sharing the same onset.

- **v1.5.0**: Introduced Intelligent Voice Leading (Rootless Voicings), Micro-timing Humanization, and Smart Sustain for `PianoIdiom.ts`.
  - **Involved Modules**: `PianoIdiom.ts`.
  - **C++ Porting Impact**:
    - **Voice Leading**: RH array extraction now selectively filters out duplicated chord roots (`p % 12 !== rootPc`) when the chord has color notes (`isAdvanced`) and maintains the top melody note. This requires a small bounded array filtering in C++.
    - **Humanization**: Introduced fixed PRNG micro-timing offsets for strumming block chords `strumOffset` and beat imperfections `timingOffset`.
    - **Dynamics**: Added `phraseSwell` driven by a `sin` function over `currentBeat` to create macro-level dynamic breathing, integrated into velocity without breaking determinism.
    - **Intelligent Sustain**: Duration calculation conditionally reads `chord.endBeat - currentBeat` bounded by a maximum threshold for `LHRole.Anchor` and `RHRole.Sparse/Block`, mimicking a sustain pedal clear on chord boundaries.

- **v1.4.0**: Expanded `PianoMotifDNA` properties with semantic accompaniment roles `LHRole` and `RHRole` to fix rhythmic repetition and static texture patterns. 
  - **Involved Modules**: `types.ts`, `GrooveEngine.ts`, `PianoIdiom.ts`.
  - **C++ Porting Impact**:
    - The physics constraint solver now applies scoring masks logic depending on explicit hand roles (e.g. `LHRole.Stride`, `RHRole.Linear`) instead of assuming block bass vs arpeggio. These act as Enum-based bitmasks.
    - Implemented a probabilistic `interlock` DNA variable targeting left/right hand Hocketing algorithms, mathematically dropping collision notes to avoid polyphonic saturation.
    - All variations function within loop permutations avoiding GC pressure on array allocation. Step size locked to `0.25` 16th notes resolution.

- **v1.3.0**: Introduced Global Motif DNA and Physics Constraint Solver for dynamic piano idioms. Accompaniment logic decoupled from Orchestrator.
  - **Involved Modules**: `types.ts`, `GrooveEngine.ts`, `PianoIdiom.ts` (replaced `TextureMapper`), `Orchestrator.ts`.
  - **C++ Porting Impact**:
    - Replaced rigid template `TextureMapper` with parameterized `PianoIdiom`.
    - `PianoMotifDNA` struct introduced for song-level parameter anchoring.
    - C++ porting will implement `PianoIdiom` solver evaluating frame-by-frame scores `playScoreLH`, `playScoreRH` with fixed-size arrays. Memory footprint is minimized by generating step-by-step and pushing directly to the output array.
  - **Architecture Pipeline Flow**:
    1. `PRNGManager` initializes seed.
    2. `MelodyEngine` generates `MusicContext` and abstract `GeneratedTrack`.
    3. `Orchestrator` delegates to `GrooveEngine`, which generates 16-grid drum computations and generates both `GrooveDNA` and `PianoMotifDNA` (Global Motif DNA).
    4. `Orchestrator` passes `GeneratedTrack`, `GrooveDNA`, and `PianoMotifDNA` to `PianoIdiom`.
    5. `PianoIdiom` acts as a constraint solver mutating `PianoMotifDNA` continuously based on section `energyLevel`, substituting hard-coded templates.
    6. `PlaybackEngine` schedules `ArrangedTrack` and drum events.

- **v1.2.2**: Implemented probabilistic rhythmic comping for TextureMapper.
  - **Involved Modules**: `TextureMapper`.
  - **C++ Porting Impact**: Replaced strict 1:1 anchor follow with probabilistic fire logic dependent on `GrooveDNA` syncopation and `Section.energyLevel`. Avoids dynamic array allocation by preserving indices (`lastLhIdx`, `lastRhStartIdx`, `lastRhCount`) and mutating note durations in place to synthesize legato or staccato articulations smoothly. Tension mutation on syncopated upbeats strictly modifies `pitch` during array push to prevent temporary object `.map()` overhead.
- **v1.2.1**: Fixed cross-section passing chord boundary resolution.
  - **Involved Modules**: `HarmonyCore`.
  - **C++ Porting Impact**: `HarmonyCore` generation changed to a 2-pass algorithm. The first pass evaluates all fundamental chords flatly, and the second pass injects passing chords/anticipation.
- **v1.2.0**: Implemented standalone 16-Grid Probabilistic Groove Engine.
  - **Involved Modules**: `GrooveEngine`, `TextureMapper`, `Orchestrator`, `PlaybackEngine`.
  - **C++ Porting Impact**:
    - `GrooveEngine` introduces fixed-length grid processing via single iterative loop, returning primitive structures (`GrooveDNA` anchors array) allowing for highly predictable memory allocation.
    - `TextureMapper` modified to abandon fixed loop bounds in favor of dynamic mapping relative to nearest preceding `GrooveDNA` anchors.
  - **Architecture Pipeline Flow**:
    1. `PRNGManager` initializes seed.
    2. `MelodyEngine` generates `MusicContext` (now containing `StyleConfig.drumProbabilities`) and abstract `GeneratedTrack` (Chords, Melody).
    3. `Orchestrator` delegates to `GrooveEngine` for 16-grid drum computations and generates `GrooveDNA`.
    4. `Orchestrator` passes `GeneratedTrack` and `GrooveDNA` to `TextureMapper`.
    5. `TextureMapper` creates dynamically rhythmic comping based on input anchors.
    6. `PlaybackEngine` schedules `ArrangedTrack` and drum events on Channel 9 using Web Audio API / SpessaSynth.

- **v1.1.0**: Migrated playback architecture to standalone spessasynth library mapping.
  - **Involved Modules**: `PlaybackEngine`, `App`, `spessasynth_lib` wrapper.
  - **C++ Porting Impact**:
    - Replacing raw Oscillator DSP with standard SoundFont (GM128 SF2) MIDI synthesizers.
    - C++ equivalent will likely use something like TinySoundFont or FluidSynth.
  - **Architecture Pipeline Flow**:
    1. ...
    4. `PlaybackEngine` schedules `ArrangedTrack` MIDI Events by routing to `spessasynth` WorkletSynthesizer.

- **v1.0.0**: Initial implementation of ACG Light Music generation engine.
  - **Involved Modules**: `PRNGManager`, `MelodyEngine`, `Orchestrator`, `PlaybackEngine`.
  - **C++ Porting Impact**:
    - All structures (`MusicContext`, `NoteData`, `ChordData`) are designed flat. No dynamic memory allocations in main generation loops.
    - Custom PRNG implemented to guarantee absolute determinism across platforms.
    - Web Audio synthesis mappings designed for eventual C++ DSP translation, utilizing basic Oscillators, Gain Nodes, and Biquad Filters.
  - **Architecture Pipeline Flow**:
    1. `PRNGManager` initializes seed.
    2. `MelodyEngine` generates `MusicContext` (Key, BPM, Time Signature, Structure) and abstract `GeneratedTrack` (Chords, Melody).
    3. `Orchestrator` takes `GeneratedTrack` and applies `Idioms` (Piano1, Piano2, Bass, Drums) to create `ArrangedTrack` (Flat note sequences).
    4. `PlaybackEngine` schedules `ArrangedTrack` using pure Web Audio API.
\n\n---\n\n## Source Files\n\n### File: `${file}`
**Description**: Environment variable definitions.
\n```${lang}\n# GEMINI_API_KEY: Required for Gemini AI API calls.
# AI Studio automatically injects this at runtime from user secrets.
# Users configure this via the Secrets panel in the AI Studio UI.
GEMINI_API_KEY="MY_GEMINI_API_KEY"

# APP_URL: The URL where this applet is hosted.
# AI Studio automatically injects this at runtime with the Cloud Run service URL.
# Used for self-referential links, OAuth callbacks, and API endpoints.
APP_URL="MY_APP_URL"
\n```\n\n### File: `${file}`
**Description**: Git ignore rules.
\n```${lang}\nnode_modules/
build/
dist/
coverage/
.DS_Store
*.log
.env*
!.env.example
\n```\n\n### File: `${file}`
**Description**: System architecture and history.
\n```${lang}\n# AuraArchitecture

### Version Info -> Update Log
- **v2.6.4**: Piano Velocity Dampening & High-Frequency Smoothing (Elegant Dynamics Update).
  - **Involved Modules**: `BaseAccompIdiom.ts`.
  - **C++ Porting Impact**:
    - **Velocity Curve Translation**: Hardcoded multipliers spanning 0.8-1.15 in both generative rules and deterministic dictionaries generated jarring MIDI velocities (often translating to peak sample layers in the downstream SoundFont synthesizer). The `rhythmVel` baselines were substantially lowered and clamped (0.6 -> 0.45), representing an overall downward shift in the dynamic curve.
    - **High-Frequency Pitch Smoothing (Anti-Harshness)**: Implemented a linear velocity roll-off starting at C5 (`pitch > 72`). High notes are now computationally clamped against an attenuation formula: `vel *= Math.max(0.6, 1.0 - (pitch - 72) * 0.015)`. This translates well to a simple floating point math function in a C++ rendering layer, solving the "startling" harsh attacks that plague algorithmic piano generation algorithms without using expensive filtering DSP.

- **v2.6.3**: Advanced Jazz Harmony & Solo Routing Fixes (The "Not-Just-Random-Notes" update).
  - **Involved Modules**: `Orchestrator.ts`, `BaseAccompIdiom.ts`.
  - **C++ Porting Impact**:
    - **Demolished the Chord Meat Grinder**: Previously, the `Orchestrator` violently clamped any `pianoLH` note exceeding `67` back into `[48, 67]`. This crushed beautifully voiced upper extensions (9ths/11ths/13ths) derived by the micro-renderer into tight, dissonant tone clusters. The engine now exclusively isolates authentic structural bass notes (`absPitch < 44`) to `[28, 47]`, allowing intelligently-arranged shell timings to ring out naturally without being crushed.
    - **Intelligent Parameter Snapping for Linear Licks**: Linear runs previously possessed zero contextual awareness. `LickDictionary` static offsets blindly collided with minor intervals (e.g. major 3rd injected onto a minor chord). Both the 20% Lick injects and 80% programmatic scale runs (Linear RH role) now natively implement `MusicTheory.snapToPool` utilizing `corePitches` and `extPitches`. This maps seamlessly to an efficient bitmask or array lookup inside the tight C++ generation loop, ensuring zero dissonance dynamically instead of via hardcoded rules.
    - **Active Tenor Bounce Fallback**: When the right hand enters the `RHRole.Linear` / `RHRole.Arp` state (monophonic runs), it surrenders its thick block chord responsibilities. The left hand dynamically steps in to catch the dropped extensions, generating rootless shell voicings down an octave and extracting the top three color notes `shellNotes.slice(-3)`. In C++, this implies a small dynamic swap of the Voice Leading struct pointer between hands based on the active state.

- **v2.6.2**: Orchestration Bugfix (Absolute Register Isolation).
  - **Involved Modules**: `Orchestrator.ts`.
  - **C++ Porting Impact**:
    - **Frequency Separation Fixed**: Previously, `Orchestrator` violently forced ALL `pianoLH` notes to sit within `[28, 43]` (E1-G2) using unconditional bitwise-like wrapping. This mistakenly dragged mid-range (Tenor) left-hand chord voicings down into the sub-bass mud.
    - **Split Folding Logic**: Implemented conditional folding. The engine now looks at the locally authored pitch layout: if a note is authored natively under `< 44`, it wraps it inside the pure bass frequency gap `[28, 47]`. If authored above, it rigidly clamps it to `[48, 67]` (C3-G4), strictly achieving the "Anti-mud C3+ LH rule" described in the constraints without muting the actual bass anchor. This maps cleanly to two `if/else while` loops in C++.

- **v2.6.1**: Jazz Piano Engine Consolidation & Lick Dictionary Injection.
  - **Involved Modules**: `IdiomDispatcher.ts`, `BaseAccompIdiom.ts`, `LickDictionary.ts` (New), `JazzPianoIdiom.ts` (Deleted).
  - **C++ Porting Impact**:
    - **Delegation Consolidation**: Eliminated the redundant `JazzPianoIdiom.ts`. `IdiomDispatcher` now routes Jazz directly through `GenericPianoIdiom` (`BaseAccompIdiom.ts`) to leverage its highly advanced micro-rendering constraint solver (which already integrates Personas flawlessly).
    - **Lick Dictionary (Vocabulary)**: Implemented an abstract 80/20 mechanism. For 80% of playback, the solver dictates note physical constraints. For the remaining 20% (tied to `accompPersona.signatureLickProb`), the engine suspends its algorithmic loop, looks up an array of physical offsets (`LickDictionary.getRandomLick()`), and applies them as a rigid transposed batch. This provides "true" jazz flavor vocabulary linearly.
    - **Data Layout for Licks**: `LickDictionary` is written as pure declarative Plain Data arrays (relative pitch offsets & onset floats). This translates to a `const` memory block or `PROGMEM` lookup table in C++. Wait-states and loop-stepping strictly obey the predetermined duration `lick.durationBeats`.

- **v2.6.0**: Advanced Jazz Piano Idiom (Interactive Comping & "Leo" Persona Upgrades).
  - **Involved Modules**: `types.ts`, `Orchestrator.ts`, `JazzPianoIdiom.ts`.
  - **C++ Porting Impact**:
    - **Melody Context Injection**: Modified `MusicContext` to include a reference to `melody?: NoteData[]`. `Orchestrator.ts` now explicitly passes `track.melody` via context before delegating to `IdiomDispatcher`. This allows accompaniment idioms to implement true "Density Feedback" without breaking the forward-only data flow or adding new interface parameters to all idiom plugins. In C++, this is just passing a pointer to the `NoteData` array.
    - **Interactive Comping & Texture State Machine**: Rewrote `JazzPianoIdiom.ts` to implement 3 discrete dynamic textures (`TEXTURE_ROOTLESS`, `TEXTURE_STRIDE`, `TEXTURE_BLOCK_CHORDS`) switching algorithmically based on section energy and bassist presence (acting as a finite state machine without dynamic allocation).
    - **Left/Right Hand Call-and-Response**: Implemented density parsing loop (`check if melody is busy around this beat`) inside the idiom. When busy, comping mutes; when resting, it inserts off-beat jabs.
    - **Micro-timing & Articulation Mutation**: Provided an isolated internal routine `humanizeMelody(melody)` inside `JazzPianoIdiom.ts` that mutates `onset`, `duration`, and `velocity` of the Topline notes IN-PLACE to construct typical jazz horn-like articulations (staccato last-notes, micro-delay laid-back feel, and contour-peak accents). This is totally compatible with C++ via looping over `NoteData` flat arrays and updating primitives directly.

- **v2.5.0**: Master Style Resolution & 80/20 Persona Architecture.
  - **Involved Modules**: `types.ts`, `MelodyEngine.ts`, `Orchestrator.ts`, `IdiomDispatcher.ts`, `MusicianRegistry.ts`.
  - **C++ Porting Impact**:
    - **Global Style Hierarchy**: Modified `MelodyEngine` to traverse the `BandSetup`. The `MainInst` or `Vocal` musician's intrinsic `styleId` becomes the song's ultimate `globalStyleId`, forcing all harmony, BPM, and groove logic to lock to their genre constraints.
    - **Idiom Decoupling from Persona**: Removed `idiomId` from `MusicianProfile`. The base Idiom layer (e.g., `JazzPianoIdiom`) is now dynamically calculated inside `IdiomDispatcher` using exactly `(GlobalStyle, Instrument)`, proving that musicians adapt to the band's chosen genre.
    - **80/20 Persona Setup**: Introduced `signatureLickProb` and `lickPool` to `MusicianPersona`. This structural scaffolding enables the "80% Base Idiom, 20% Signature Lick" constraint solver requirement without breaking C++ determinism. Memory overhead remains bounded.

- **v2.4.1**: Voice Leading Pitch Creep & Collision Fix.
  - **Involved Modules**: `IdiomUtils.ts`.
  - **C++ Porting Impact**:
    - Fixed a critical "pitch creep" bug where upper chord extensions were unconditionally stacked above the highest core note (`while (target <= outVoicing[outVoicing.length - 1]) target += 12;`), causing the voicing center of density to drift exponentially upward into unplayable registers.
    - Bounded extension stacking to naturally fit within a strictly calculated 10th/11th span (`target < bass + 3`, `target > bass + 16`).
    - Added a discrete `penalty` to the A* distance formula for core inversions that place Minor/Major 2nd clusters at the bottom of the voicing list, automatically favoring cleaner lower intervals.
    - Disabled `Drop 2` for voicings with more than 4 notes. Forcing a Drop 2 on a 5+ note chord often crushed the inner voices into the bottom note, creating harsh bass-register dissonances.
    - All data structures remain flat arrays of pitches (`std::vector<int>` or fixed arrays in C++).

- **v2.4.0**: Complete Decoupling of Piano Idioms (Anti-Style-Leakage).
  - **Involved Modules**: `MusicianRegistry.ts`, `IdiomDispatcher.ts`, `PopPianoIdiom.ts`, `JazzPianoIdiom.ts`, `LofiPianoIdiom.ts`, `BluesPianoIdiom.ts`, `Orchestrator.ts`.
  - **C++ Porting Impact**:
    - Extracted the massive monolithic solver from `BaseAccompIdiom.ts` into specialized idiom classes that are dynamically dispatched based on the `IdiomType` enum mapped in the Musician's profile.
    - `Orchestrator` now explicitly relies on `IdiomDispatcher.generateAccompaniment(accompMusician.idiomId, ...)` instead of hardcoding `RhythmSectionIdiom`. This ensures maximum 1:1 mapping flexibility where C++ can utilize a fast array of function pointers.
    - Each idiom plugin acts completely decoupled without `if (style == 'Pop')` statements anywhere in the core orchestrator, fully enforcing the rule that Orchestrator just tosses blueprints to plugins.
    - Extracted common physics logic to `IdiomUtils.ts` (`calculateVoicing`) to respect DRY and memory optimization constraints while keeping phrasing distinct.

- **v2.3.2**: Unified Piano Instrument Mapping.
  - **Involved Modules**: `MusicianRegistry.ts`.
  - **C++ Porting Impact**:
    - Replaced all uses of `instrumentId: 4` (Electric Piano) with `instrumentId: 0` (Acoustic Grand Piano) across `AccompInst` personas to ensure a consistent, clear acoustic tone instead of potentially muddy EPiano samples.

- **v2.3.1**: Anti-Style-Leakage Fix (Velocity Physics Normalization).
  - **Involved Modules**: `BaseAccompIdiom.ts`.
  - **C++ Porting Impact**:
    - Removed hardcoded velocity inflation (`* 1.1`) and excessive top-note peaking (`1.15x`) which forced chord top notes to hit max velocity (127) and trigger overly bright SF2 layers (simulating a false pop melody).
    - Flattened the velocity multipliers for block chords (`0.95`, `0.90`, `0.85`) to ensure cohesive, warm jazz comping where all voices blend naturally. This enforces the rule that Rh should act as true accompaniment without artificially sticking out.

- **v2.3.0**: Lazy Jazz Style Integration (Syncopated Comping & Advanced Extensions).
  - **Involved Modules**: `MusicianRegistry.ts`, `StyleRegistry.ts`, `PlaybackEngine.ts`.
  - **C++ Porting Impact**:
    - Introduced `Jazz` style preset into `StyleRegistry` with highly extended harmonic progressions (ii9-V13-Imaj9) and robust 0.7 `swingRatio`.
    - Added `Duke (Lazy Jazz)` AccompInst persona leveraging extreme extensionUsage (1.0) and syncopation.
    - Added `Jones (Lazy Jazz)` Drums persona with laid-back feel.
    - Added `Ron (Upright Jazz)` Bass persona for deep walking upright bass.
    - Added hard toggle in `PlaybackEngine` to cleanly mute `arranged.melody` processing if no `MainInst` or `Vocal` is present in the `MusicContext.band`, reducing unnecessary MIDI event mapping for pure accompaniment mode.

- **v2.2.0**: Blues Style Enhancement (Global Swing & Walking Boogie Bass).
  - **Involved Modules**: `types.ts`, `StyleRegistry.ts`, `PlaybackEngine.ts`, `BaseAccompIdiom.ts`, `MusicianRegistry.ts`.
  - **C++ Porting Impact**:
    - Global abstract `swingRatio` added to `StyleConfig` and `MusicContext`.
    - Swing implemented centrally in `PlaybackEngine` `processTrack` mutating raw MIDI `time` calculations in place mathematically without looping or allocating structures.
    - Added `LHRole.Walking` semantic representation mapping high `busyLevel` and `syncopation` onto a fixed 4-beat Boogie-Woogie/Walking bass pattern with deterministic ghost notes.
    - Added explicitly dedicated Blues bassist persona `Willie (Walking Blues)` in `MusicianRegistry` demonstrating seamless scale and feature addition leveraging the new role infrastructure.

- **v2.1.0**: Leader-Driven Style Resolution & Predefined Musician Profiles.
  - **Involved Modules**: `App.tsx`, `MusicianRegistry.ts`, `types.ts`.
  - **C++ Porting Impact**:
    - Global abstract "style" selection is removed from the root orchestrator input. Instead, the `MainInst` (or fallback `AccompInst`) dictates the core genre, tempo, and harmoniy layout.
    - Encapsulated persona parameters into rigid `MusicianProfile` definitions (emulating static config manifests / JSON in C++) rather than arbitrary sliders.
    - Added `MusicianRegistry` as the single source of truth for available roles and their intrinsic properties.

- **v2.0.0**: 5-Role Band Architecture & Musician Personas (Anti-Style-Leakage).
  - **Involved Modules**: `types.ts`, `Orchestrator.ts`, `Idioms` (Decoupled & New), `UI/App.tsx`.
  - **C++ Porting Impact**:
    - Replaced monolithic `PianoIdiom` generation with a dedicated iterative loop over `BandMusician` array (Vocal, MainInst, AccompInst, Bass, Drums).
    - Introduced `MusicianPersona` struct (`busyLevel`, `syncopation`, `extensionUsage`, `dynamics`) to shift hard-coded style checks into math-driven modifier scalars.
    - Decoupled `PianoIdiom` into base physical constraints (e.g., `BaseAccompIdiom`, `BaseBassIdiom`) where the Persona drives the scoring matrix without needing arbitrary style string matching.
    - `MusicContext` now receives the isolated `BandMusician` configs securely, adhering strictly to the Anti-Style-Leakage rule.

- **v1.9.5**: Algorithmic Outro Strategies & Structural Cadences.
  - **Involved Modules**: `types.ts`, `MelodyEngine.ts`, `HarmonyCore.ts`, `Orchestrator.ts`.
  - **C++ Porting Impact**:
    - Added `OutroStrategy` enum (`FadeOut`, `Ritardando`, `SuddenStop`, `MotifDecay`, `Unresolved`) to govern the outro behavior.
    - Updated `MusicContext` to accept `outroStrategy` and pass it down the pipeline.
    - `HarmonyCore.ts` specifically overrides the final cadence for the `Unresolved` strategy (forces IV or vi) and manipulates `endBeat` duration for `Ritardando`.
    - `Orchestrator.ts` manipulates sub-track arrays during the Outro section to simulate fading, sudden stops (truncation of durations/onsets), and subtractive motifs (dropping drums/LH elements).
    - Ensures pure memory footprint without adding new heavy objects, relying on simple array filtration and mathematical property adjustment.

- **v1.9.4**: Left Hand Curing - Deep Root Lock & Ghost Notes.
  - **Involved Modules**: `PianoIdiom.ts`.
  - **C++ Porting Impact**:
    - Introduced state tracker `lhPlayedDeepRootThisChord` to prevent repetitive sub-bass hits.
    - Rewrote Constraint Solver for LH/RH hocketing (interlock), ensuring LH leaves room for RH fill and syncopation.
    - Revamped LH micro-rendering to separate primary bass hits from rhythmic bouncing ("Tenor Bounce") and ghost notes.
    - Memory overhead zero; uses standard primitives tracked functionally across loop iterations.

- **v1.9.3**: Timbre Separation & Phantom Singer Representation.
  - **Involved Modules**: `PlaybackEngine.ts`.
  - **C++ Porting Impact**:
    - Changed the default Melody (Channel 0) instrument from `0` (Acoustic Grand) to `73` (Flute). This eliminates the "two pianos" conflicting harmonic masking issue and distinctly separates the top-line melody ("Phantom Singer") from the piano accompaniment (`PianoRH` and `PianoLH` remaining on `0`).

- **v1.9.2**: Smooth Mix Reversion & Native Dynamics Reliance.
  - **Involved Modules**: `PlaybackEngine.ts`.
  - **C++ Porting Impact**:
    - Removed abrupt/stepped Dynamic `CC 10/91/7` injection per section loop.
    - Scrapped `Fake Sidechain Compression` (CC 11 pump) as it sounded disjointed over the engine's strict quantized time.
    - Solidified the `applyMixConfig` single-pass CC dump layout for static channel spacing, relying fully on the orchestration engine generating mathematically perfect Velocity mappings on note-events for expression. 
    - Reverted Playback loop lookahead/intervals to safe `0.5s` & `50ms` parameters saving ESP32 CPU overhead now that tight CC streams are omitted.

- **v1.9.1**: Dynamic Mix Engine & Fake Sidechain Compression.
  - **Involved Modules**: `PlaybackEngine.ts`.
  - **C++ Porting Impact**:
    - Discarded static configuration layout in favor of real-time `CC 10` (Pan), `CC 91` (Reverb), and `CC 7` (Volume) curve mappings bound to `context.sections` energy levels.
    - Implemented `Fake Sidechain Compression` triggering deterministic exponential volume recovery curves via `CC 11` (Expression) dynamically bound to `arranged.drums` 36 Kick onsets.
    - Added standard `type: 2` (Controller Change) event schema to `MidiEvent` for flat C++ struct mappings.
    - Dropped `PlaybackEngine` lookahead frame down to `0.1` and `timerWorker` to `25ms` for sufficiently real-time expression rendering tight enough for sidechain ducking.

- **v1.9.0**: Master Pianist Paradigm: Phantom Vocal Masking and Motif Locking.
  - **Involved Modules**: `PianoIdiom.ts`.
  - **C++ Porting Impact**:
    - Introduced a 4-bar deterministic structural mask (`Phantom Vocal Mask`) inside the physics rendering loop to conditionally mute random probabilities and give space for a theoretical lead vocal.
    - Added dynamic hand roles (`currentRHRole` mutation), dropping complexity to `RHRole.Block` during vocal-centric measures and injecting `RHRole.Linear` arpeggiated run-ups in the final structural measure pass (Turnaround fills).
    - Rewrote the constraint solver scoring (`The Masked Solver`) to violently penalize non-groove notes when the Mask is active.
    - Engineered `Smart Sustain` logic extending block chords manually across multiple beats by holding physics simulated foot-pedal length, drastically thinning MIDI data density while preserving harmonic support.

- **v1.8.1**: Mix Engine & Touch Dynamics Tuning.
  - **Involved Modules**: `PlaybackEngine.ts`, `PianoIdiom.ts`.
  - **C++ Porting Impact**:
    - Addressed severe frequency masking/boomy low-end by explicitly decoupling LH and RH MIDI CC 7 (Volume) limits context-wide.
    - LH base velocity equation decreased by 30% multiplier to suppress General MIDI soundfont thick organ-like resonance.
    - RH ghost notes inner-voice velocity ratio raised (from 0.55 back up to 0.75) and overall base multiplier slightly boosted to cut through the mix.

- **v1.8.0**: Piano Idiom "Master Pianist LH" Optimization (Physics/Velocity Engine tuning).
  - **Involved Modules**: `PianoIdiom.ts`.
  - **C++ Porting Impact**:
    - Replaced hard-coded power chords with Shell Voicing intervals (`thirdExt`, `fifthExt`, `seventhExt`).
    - Added `isAnticipation` logic to the Constraint Solver to push beats and increase humanization.
    - Simplified LH duration and velocity propagation physics (Micro-Strumming). No state tracking (`lastLhIdx`) needed anymore.
    - Updated RH multi-voice velocity scaling for ghost notes, drastically reducing the "Wall of Sound".

- **v1.7.0**: Architectural Decoupling of Harmony Generation (Anti-Style-Leakage Rule enforced).
  - **Involved Modules**: `HarmonyCore.ts`, `MelodyEngine.ts`, `types.ts`, `StyleRegistry.ts` (new).
  - **C++ Porting Impact**:
    - Extracted hardcoded major and minor progression pools out of `HarmonyCore.ts` and `App.tsx`.
    - Centralized all stylistic data (drum patterns, harmony progress, probs) into `StyleRegistry.ts` (Manifest).
    - `StyleConfig` strictly requires a `harmony` object (`StyleHarmonyConfig`), conforming to absolute data-driven architecture.
    - Added `SectionType` Enum to provide explicitly matched hooks into the `HarmonyProgressionPool`, enabling `StyleManifest`-driven song structures.

- **v1.6.1**: Panning & Mix Enhancement for Piano Hands.
  - **Involved Modules**: `PlaybackEngine.ts`.
  - **C++ Porting Impact**:
    - Right Hand (`pianoRH`) and Left Hand (`pianoLH`) are now mapped to separate MIDI Channels (1 and 2, respectively) instead of both on Channel 1.
    - Added precise `CC 10` panning values to split them aurally (LH panned left `43`, RH panned right `85`) mimicking physical piano keys, while sharing the same `CC 7` volume configuration (85) to ensure equivalent loudness.

- **v1.6.0**: Complete Harmony Integrity Audit: True Voicing Generation, Context-Aware Scale Snapping, and Unison Avoidance.
  - **Involved Modules**: `PianoIdiom.ts`, `Orchestrator.ts`.
  - **C++ Porting Impact**:
    - Replaced modulo-12 pitch class clustering with authentic Interval-Stack Voicing logic. Extensions (>11th) are safely stacked above Core triads, ensuring chord colors (e.g., 9ths don't become minor 2nds at the bottom).
    - `Orchestrator.ts` now explicitly passes `MusicContext` into `PianoIdiom.generateAccompaniment`.
    - `Linear` RH runs now utilize `MusicTheory.snapToScale` via the passed `context.tonality` to guarantee melodic phrasing stays strictly diatonic, completely resolving "out of tune chromatic wander".
    - Left Hand explicitly generates true 5ths for Diminished/HalfDiminished/Augmented chords instead of a hardcoded `+7` semi-tones interval, preventing dissonant minor 2nd clashes on the bass.
    - Added Unison Avoidance filter checking `pianoLH` against `selectedNotes` to drop duplicate pitches sharing the same onset.

- **v1.5.0**: Introduced Intelligent Voice Leading (Rootless Voicings), Micro-timing Humanization, and Smart Sustain for `PianoIdiom.ts`.
  - **Involved Modules**: `PianoIdiom.ts`.
  - **C++ Porting Impact**:
    - **Voice Leading**: RH array extraction now selectively filters out duplicated chord roots (`p % 12 !== rootPc`) when the chord has color notes (`isAdvanced`) and maintains the top melody note. This requires a small bounded array filtering in C++.
    - **Humanization**: Introduced fixed PRNG micro-timing offsets for strumming block chords `strumOffset` and beat imperfections `timingOffset`.
    - **Dynamics**: Added `phraseSwell` driven by a `sin` function over `currentBeat` to create macro-level dynamic breathing, integrated into velocity without breaking determinism.
    - **Intelligent Sustain**: Duration calculation conditionally reads `chord.endBeat - currentBeat` bounded by a maximum threshold for `LHRole.Anchor` and `RHRole.Sparse/Block`, mimicking a sustain pedal clear on chord boundaries.

- **v1.4.0**: Expanded `PianoMotifDNA` properties with semantic accompaniment roles `LHRole` and `RHRole` to fix rhythmic repetition and static texture patterns. 
  - **Involved Modules**: `types.ts`, `GrooveEngine.ts`, `PianoIdiom.ts`.
  - **C++ Porting Impact**:
    - The physics constraint solver now applies scoring masks logic depending on explicit hand roles (e.g. `LHRole.Stride`, `RHRole.Linear`) instead of assuming block bass vs arpeggio. These act as Enum-based bitmasks.
    - Implemented a probabilistic `interlock` DNA variable targeting left/right hand Hocketing algorithms, mathematically dropping collision notes to avoid polyphonic saturation.
    - All variations function within loop permutations avoiding GC pressure on array allocation. Step size locked to `0.25` 16th notes resolution.

- **v1.3.0**: Introduced Global Motif DNA and Physics Constraint Solver for dynamic piano idioms. Accompaniment logic decoupled from Orchestrator.
  - **Involved Modules**: `types.ts`, `GrooveEngine.ts`, `PianoIdiom.ts` (replaced `TextureMapper`), `Orchestrator.ts`.
  - **C++ Porting Impact**:
    - Replaced rigid template `TextureMapper` with parameterized `PianoIdiom`.
    - `PianoMotifDNA` struct introduced for song-level parameter anchoring.
    - C++ porting will implement `PianoIdiom` solver evaluating frame-by-frame scores `playScoreLH`, `playScoreRH` with fixed-size arrays. Memory footprint is minimized by generating step-by-step and pushing directly to the output array.
  - **Architecture Pipeline Flow**:
    1. `PRNGManager` initializes seed.
    2. `MelodyEngine` generates `MusicContext` and abstract `GeneratedTrack`.
    3. `Orchestrator` delegates to `GrooveEngine`, which generates 16-grid drum computations and generates both `GrooveDNA` and `PianoMotifDNA` (Global Motif DNA).
    4. `Orchestrator` passes `GeneratedTrack`, `GrooveDNA`, and `PianoMotifDNA` to `PianoIdiom`.
    5. `PianoIdiom` acts as a constraint solver mutating `PianoMotifDNA` continuously based on section `energyLevel`, substituting hard-coded templates.
    6. `PlaybackEngine` schedules `ArrangedTrack` and drum events.

- **v1.2.2**: Implemented probabilistic rhythmic comping for TextureMapper.
  - **Involved Modules**: `TextureMapper`.
  - **C++ Porting Impact**: Replaced strict 1:1 anchor follow with probabilistic fire logic dependent on `GrooveDNA` syncopation and `Section.energyLevel`. Avoids dynamic array allocation by preserving indices (`lastLhIdx`, `lastRhStartIdx`, `lastRhCount`) and mutating note durations in place to synthesize legato or staccato articulations smoothly. Tension mutation on syncopated upbeats strictly modifies `pitch` during array push to prevent temporary object `.map()` overhead.
- **v1.2.1**: Fixed cross-section passing chord boundary resolution.
  - **Involved Modules**: `HarmonyCore`.
  - **C++ Porting Impact**: `HarmonyCore` generation changed to a 2-pass algorithm. The first pass evaluates all fundamental chords flatly, and the second pass injects passing chords/anticipation.
- **v1.2.0**: Implemented standalone 16-Grid Probabilistic Groove Engine.
  - **Involved Modules**: `GrooveEngine`, `TextureMapper`, `Orchestrator`, `PlaybackEngine`.
  - **C++ Porting Impact**:
    - `GrooveEngine` introduces fixed-length grid processing via single iterative loop, returning primitive structures (`GrooveDNA` anchors array) allowing for highly predictable memory allocation.
    - `TextureMapper` modified to abandon fixed loop bounds in favor of dynamic mapping relative to nearest preceding `GrooveDNA` anchors.
  - **Architecture Pipeline Flow**:
    1. `PRNGManager` initializes seed.
    2. `MelodyEngine` generates `MusicContext` (now containing `StyleConfig.drumProbabilities`) and abstract `GeneratedTrack` (Chords, Melody).
    3. `Orchestrator` delegates to `GrooveEngine` for 16-grid drum computations and generates `GrooveDNA`.
    4. `Orchestrator` passes `GeneratedTrack` and `GrooveDNA` to `TextureMapper`.
    5. `TextureMapper` creates dynamically rhythmic comping based on input anchors.
    6. `PlaybackEngine` schedules `ArrangedTrack` and drum events on Channel 9 using Web Audio API / SpessaSynth.

- **v1.1.0**: Migrated playback architecture to standalone spessasynth library mapping.
  - **Involved Modules**: `PlaybackEngine`, `App`, `spessasynth_lib` wrapper.
  - **C++ Porting Impact**:
    - Replacing raw Oscillator DSP with standard SoundFont (GM128 SF2) MIDI synthesizers.
    - C++ equivalent will likely use something like TinySoundFont or FluidSynth.
  - **Architecture Pipeline Flow**:
    1. ...
    4. `PlaybackEngine` schedules `ArrangedTrack` MIDI Events by routing to `spessasynth` WorkletSynthesizer.

- **v1.0.0**: Initial implementation of ACG Light Music generation engine.
  - **Involved Modules**: `PRNGManager`, `MelodyEngine`, `Orchestrator`, `PlaybackEngine`.
  - **C++ Porting Impact**:
    - All structures (`MusicContext`, `NoteData`, `ChordData`) are designed flat. No dynamic memory allocations in main generation loops.
    - Custom PRNG implemented to guarantee absolute determinism across platforms.
    - Web Audio synthesis mappings designed for eventual C++ DSP translation, utilizing basic Oscillators, Gain Nodes, and Biquad Filters.
  - **Architecture Pipeline Flow**:
    1. `PRNGManager` initializes seed.
    2. `MelodyEngine` generates `MusicContext` (Key, BPM, Time Signature, Structure) and abstract `GeneratedTrack` (Chords, Melody).
    3. `Orchestrator` takes `GeneratedTrack` and applies `Idioms` (Piano1, Piano2, Bass, Drums) to create `ArrangedTrack` (Flat note sequences).
    4. `PlaybackEngine` schedules `ArrangedTrack` using pure Web Audio API.
\n```\n\n### File: `${file}`
**Description**: Main HTML entry point.
\n```${lang}\n<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Google AI Studio App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>

\n```\n\n### File: `${file}`
**Description**: Project metadata.
\n```${lang}\n{
  "name": "AuraFlow Tap模拟器V1",
  "description": "",
  "requestFramePermissions": [],
  "majorCapabilities": []
}\n```\n\n### File: `${file}`
**Description**: NPM dependencies and scripts.
\n```${lang}\n{
  "name": "react-example",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite --port=3000 --host=0.0.0.0",
    "build": "vite build",
    "preview": "vite preview",
    "clean": "rm -rf dist",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@google/genai": "^1.29.0",
    "@tailwindcss/vite": "^4.1.14",
    "@vitejs/plugin-react": "^5.0.4",
    "dotenv": "^17.2.3",
    "express": "^4.21.2",
    "lucide-react": "^0.546.0",
    "motion": "^12.23.24",
    "react": "^19.0.1",
    "react-dom": "^19.0.1",
    "spessasynth_lib": "^4.2.15",
    "vite": "^6.2.3"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.14.0",
    "autoprefixer": "^10.4.21",
    "tailwindcss": "^4.1.14",
    "tsx": "^4.21.0",
    "typescript": "~5.8.2",
    "vite": "^6.2.3"
  }
}
\n```\n\n### File: `${file}`
**Description**: Main React application component.
\n```${lang}\n/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import { PRNGManager } from './core/utils/PRNG';
import { MelodyEngine } from './core/generation/MelodyEngine';
import { Orchestrator } from './core/generation/Orchestrator';
import { PlaybackEngine } from './core/generation/PlaybackEngine';
import { MusicContext, ArrangedTrack, RoleType, BandMusician } from './core/generation/types';
import { getMusiciansByRole, getMusicianById } from './core/generation/manifests/MusicianRegistry';
import { StyleRegistry } from './core/generation/manifests/StyleRegistry';
import { TonalityName } from './core/generation/theory/MusicTheory';

export default function App() {
  const [contextVal, setContextVal] = useState<MusicContext | null>(null);
  const [arrangedTrackVal, setArrangedTrackVal] = useState<ArrangedTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSf2Loaded, setIsSf2Loaded] = useState(false);
  const [loadingSf2, setLoadingSf2] = useState(true);
  const engineRef = useRef<PlaybackEngine | null>(null);

  const [bandSelection, setBandSelection] = useState<Record<RoleType, string | null>>({
      [RoleType.Vocal]: null,
      [RoleType.MainInst]: null,
      [RoleType.AccompInst]: 'accomp_alex_pop',
      [RoleType.Bass]: null,
      [RoleType.Drums]: 'drums_dave_pop'
  });

  const [duration, setDuration] = useState<number>(60);
  const [passingProb, setPassingProb] = useState<number>(0.2);
  const [anticipationProb, setAnticipationProb] = useState<number>(0.3);
  const [currentSeed, setCurrentSeed] = useState<number | null>(null);
  const [customSeedInput, setCustomSeedInput] = useState<string>('');

  useEffect(() => {
    const initSf2 = async () => {
        try {
            console.log("Fetching GM128_3BM.sf2...");
            const resp = await fetch("/GM128_3BM.sf2");
            if (!resp.ok) throw new Error("SF2 fetch failed. Status: " + resp.status);
            const buffer = await resp.arrayBuffer();
            if (!engineRef.current) {
                engineRef.current = new PlaybackEngine();
            }
            await engineRef.current.loadSoundfont(buffer);
            setIsSf2Loaded(true);
            console.log("SF2 loaded successfully.");
        } catch (err) {
            console.error("Failed to auto-load SF2:", err);
            // Fallback: let user know or handle error state
        } finally {
            setLoadingSf2(false);
        }
    };
    initSf2();
  }, []);

  const generate = () => {
    if (!isSf2Loaded || !engineRef.current) return;

    // Determine random seed based on clock just for initial seeding, 
    // generation strictly uses PRNGManager.
    const seed = customSeedInput.trim() !== '' ? parseInt(customSeedInput, 10) : Date.now();
    if (isNaN(seed)) {
        alert("Invalid seed number. Please enter a valid integer.");
        return;
    }
    PRNGManager.setSeed(seed);
    setCurrentSeed(seed);

    // Resolve Band
    const activeBand = Object.entries(bandSelection)
        .map(([role, id]) => {
            if (!id) return null;
            const profile = getMusicianById(id as string);
            if (!profile) return null;
            return {
                id: id as string,
                role: role as RoleType,
                styleId: profile.styleId,
                instrumentId: profile.instrumentId,
                persona: profile.persona
            };
        })
        .filter(m => m !== null) as BandMusician[];

    // Leader-Driven Style Resolution
    const leader = activeBand.find(m => m.role === RoleType.MainInst) 
                || activeBand.find(m => m.role === RoleType.AccompInst);
    
    const dominantStyleId = leader ? leader.styleId : 'Pop';
    const styleConfig = StyleRegistry[dominantStyleId] || StyleRegistry['Pop'];

    // 1. Generation Engine
    // Generates Structure & Harmony & Melody
    const { track, context } = MelodyEngine.generateFullSong({ 
        targetDurationSec: duration,
        passingChordProb: passingProb,
        anticipationProb: anticipationProb,
        style: styleConfig,
        band: activeBand,
        seed: seed
    });
    
    // Inject Band into Context
    context.band = activeBand;
    context.swingRatio = styleConfig.swingRatio;
    
    // 2. Orchestration Engine
    // Expands track over 4 specific instruments via Idioms
    const arrangedTrack = Orchestrator.arrange(track, context);

    setContextVal(context);
    setArrangedTrackVal(arrangedTrack);
  };

  const play = async () => {
    if (!isSf2Loaded || !engineRef.current || !arrangedTrackVal || !contextVal) return;
    
    // Test beep to see if the engine produces sound immediately
    if (engineRef.current && (engineRef.current as any).synth) {
      console.log("[App] Triggering test beep on channel 1, MIDI 60");
      const s = (engineRef.current as any).synth;
      if (engineRef.current['ac'] && engineRef.current['ac'].state === 'suspended') {
        await engineRef.current['ac'].resume();
      }
      s.noteOn(1, 60, 127);
      setTimeout(() => s.noteOff(1, 60), 500);
    }

    // 3. Playback Engine
    await engineRef.current.play(arrangedTrackVal, contextVal);
    setIsPlaying(true);
  };

  const stop = () => {
    if (engineRef.current) {
      engineRef.current.stop();
      setIsPlaying(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#4A453E] font-sans p-8 flex flex-col">
      <div className="max-w-2xl mx-auto w-full space-y-6">
        <header className="flex flex-col gap-1 pb-4">
          <h1 className="font-serif text-4xl font-medium tracking-tight text-[#5A5A40]">AuraRadio Engine <span className="text-sm italic opacity-60 ml-2 font-serif">ACG Light Music</span></h1>
          <p className="text-[10px] uppercase tracking-[0.2em] font-semibold text-[#8C867A]">Pure Algorithmic Generation • SpessaSynth Audio</p>
        </header>

        <section className="bg-white rounded-[24px] p-6 shadow-sm border border-[#E5E1DA] flex flex-col gap-4">
          {loadingSf2 && (
            <div className="flex flex-col gap-2 p-4 bg-[#FAF8F5] rounded-xl border border-dashed border-[#E5E1DA]">
                <p className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]">
                    Initializing SF2 Engine...
                </p>
                <p className="text-[10px] text-[#8C867A]">Fetching and decoding GM128_3BM.sf2...</p>
            </div>
          )}
          {!loadingSf2 && !isSf2Loaded && (
            <div className="flex flex-col gap-2 p-4 bg-[#FAF8F5] rounded-xl border border-dashed border-[#E5E1DA]">
                <p className="text-xs font-bold uppercase text-red-500">
                    Failed to load SF2
                </p>
                <p className="text-[10px] text-[#8C867A]">Please ensure /public/GM128_3BM.sf2 exists.</p>
            </div>
          )}

            <div className="flex flex-col gap-6 mb-4">
              <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#8C867A] mb-2 block">
                    Target Duration (sec): {duration}
                  </label>
                  <input 
                    type="range" 
                    min="30" max="240" step="10" 
                    value={duration} 
                    onChange={(e) => setDuration(parseInt(e.target.value))}
                    className="w-full h-1 bg-[#E5E1DA] rounded-full appearance-none outline-none cursor-pointer"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#8C867A] mb-2 block">
                    Seed (Optional)
                  </label>
                  <input
                    type="text"
                    value={customSeedInput}
                    onChange={(e) => setCustomSeedInput(e.target.value)}
                    placeholder="Leave empty for random"
                    className="w-full px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5E1DA] rounded-lg outline-none focus:border-[#C4BFAF] transition-colors font-mono"
                  />
                </div>
              </div>

            <div className="flex flex-col gap-3">
               <h3 className="text-xs font-bold uppercase tracking-widest text-[#5A5A40] border-b border-[#E5E1DA] pb-2">Band Musicians Roster</h3>
               <div className="flex flex-col gap-3">
                 {[RoleType.Vocal, RoleType.MainInst, RoleType.AccompInst, RoleType.Bass, RoleType.Drums].map((role) => {
                    const availableModels = getMusiciansByRole(role);
                    const selectedId = bandSelection[role];
                    const selectedProfile = selectedId ? getMusicianById(selectedId) : null;
                    return (
                    <div key={role} className="flex flex-col sm:flex-row gap-4 p-3 bg-[#FAF8F5] border border-[#E5E1DA] rounded-xl items-start sm:items-center">
                       <div className="w-24 shrink-0">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[#8C867A]">{role}</span>
                       </div>
                       <div className="flex-1 w-full flex flex-col gap-2">
                           <select 
                                value={selectedId || ''} 
                                onChange={(e) => {
                                    setBandSelection(prev => ({ ...prev, [role]: e.target.value === '' ? null : e.target.value }));
                                }}
                                className="w-full sm:w-64 bg-white border border-[#E5E1DA] rounded-lg px-3 py-2 text-xs font-semibold text-[#5A5A40] outline-none"
                            >
                                <option value="">-- Empty (None) --</option>
                                {availableModels.map(m => (
                                    <option key={m.id} value={m.id}>{m.name} ({m.styleId})</option>
                                ))}
                            </select>
                            {selectedProfile && (
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-2">
                                    <div className="text-[9px] uppercase tracking-wider text-[#8C867A]">Sparse: {Math.round(selectedProfile.persona.sparsityTendency * 100)}%</div>
                                    <div className="text-[9px] uppercase tracking-wider text-[#8C867A]">Sync: {Math.round(selectedProfile.persona.syncopationAssault * 100)}%</div>
                                    <div className="text-[9px] uppercase tracking-wider text-[#8C867A]">Ext: {Math.round(selectedProfile.persona.colorBias * 100)}%</div>
                                    <div className="text-[9px] uppercase tracking-wider text-[#8C867A]">Dyn: {selectedProfile.persona.dynamicRange[0]}-{selectedProfile.persona.dynamicRange[1]}</div>
                                </div>
                            )}
                       </div>
                    </div>
                 )})}
               </div>
            </div>
          </div>

          <div className="flex gap-4">
            <button 
              onClick={generate}
              disabled={!isSf2Loaded}
              className="bg-[#5A5A40] text-[#FAF8F5] rounded-full text-xs font-semibold tracking-widest uppercase px-6 py-3 cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Generate
            </button>
            <button 
              onClick={play}
              disabled={!isSf2Loaded || !arrangedTrackVal}
              className="bg-[#3A3A28] text-[#FAF8F5] rounded-full text-xs font-semibold tracking-widest uppercase px-6 py-3 cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Play
            </button>
            <button 
              onClick={stop}
              disabled={!isPlaying}
              className="bg-transparent border border-[#E5E1DA] text-[#5A5A40] rounded-full text-xs font-semibold tracking-widest uppercase px-6 py-3 cursor-pointer hover:bg-gray-50 disabled:opacity-50 transition-all"
            >
              Stop
            </button>
            <div className={`ml-auto w-10 h-10 rounded-full border border-[#E5E1DA] flex items-center justify-center ${isPlaying ? 'bg-[#FAF8F5]' : ''}`}>
              <div className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`}></div>
            </div>
          </div>
        </section>

        {contextVal && (
          <section className="bg-white rounded-[24px] p-8 shadow-sm border border-[#E5E1DA] flex flex-col gap-6">
            <h2 className="text-xs font-bold uppercase tracking-widest text-[#8C867A]">Generated Context</h2>
            
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="p-4 bg-[#FAF8F5] rounded-xl flex flex-col gap-1">
                <span className="text-[10px] text-[#8C867A] uppercase font-bold tracking-wider mb-1">Seed</span>
                <span className="font-mono text-lg font-semibold truncate" title={currentSeed?.toString()}>{currentSeed || 'None'}</span>
              </div>
              <div className="p-4 bg-[#FAF8F5] rounded-xl flex flex-col gap-1">
                <span className="text-[10px] text-[#8C867A] uppercase font-bold tracking-wider mb-1">Tempo</span>
                <span className="font-mono text-lg font-semibold">{contextVal.bpm} BPM</span>
              </div>
              <div className="p-4 bg-[#FAF8F5] rounded-xl flex flex-col gap-1">
                <span className="text-[10px] text-[#8C867A] uppercase font-bold tracking-wider mb-1">Time Signature</span>
                <span className="font-mono text-lg font-semibold">{contextVal.timeSignature[0]} / {contextVal.timeSignature[1]}</span>
              </div>
              <div className="p-4 bg-[#FAF8F5] rounded-xl flex flex-col gap-1">
                <span className="text-[10px] text-[#8C867A] uppercase font-bold tracking-wider mb-1">Key</span>
                <span className="font-mono text-lg font-semibold">{arrangedTrackVal?.key || 'C'}</span>
              </div>
              <div className="p-4 bg-[#FAF8F5] rounded-xl flex flex-col gap-1">
                <span className="text-[10px] text-[#8C867A] uppercase font-bold tracking-wider mb-1">Scale</span>
                <span className="font-mono text-lg font-semibold">{TonalityName[contextVal.tonality]?.replace('_', ' ') || 'Unknown'}</span>
              </div>
            </div>

            <div>
               <span className="text-[10px] text-[#8C867A] uppercase font-bold tracking-widest mb-3 block">Structure Breakdown</span>
               <div className="w-full bg-[#FAF8F5] p-2 rounded-2xl border border-[#E5E1DA] flex flex-col gap-2">
                  {contextVal.sections.map((sec, idx) => {
                    const secChords = arrangedTrackVal?.chords?.filter(c => c.startBeat >= sec.startBeat && c.startBeat < sec.endBeat) || [];
                    return (
                    <div key={idx} className="bg-white border border-[#E5E1DA] p-3 rounded-xl flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-[#5A5A40]">Section {sec.name}</span>
                        <span className="font-mono text-xs opacity-60">Beat {sec.startBeat} - {sec.endBeat}</span>
                        <div className="flex items-center gap-2">
                           <span className="text-[10px] font-bold text-[#8C867A]">NRG</span>
                           <div className="w-16 h-1.5 bg-[#FAF8F5] rounded-full overflow-hidden border border-[#E5E1DA]">
                              <div className="h-full bg-[#E9967A]" style={{ width: `${(sec.energyLevel / 10) * 100}%` }}></div>
                           </div>
                        </div>
                      </div>
                      {secChords.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-2 border-t border-[#E5E1DA]/50">
                          {secChords.map((c, i) => (
                            <div key={i} className="px-2 py-1 bg-[#FAF8F5] text-[#5A5A40] text-xs font-mono font-medium rounded-md border border-[#E5E1DA]/60">
                              {c.numeral}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )})}
               </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
\n```\n\n### File: `${file}`
**Description**: Core generative dictionary algorithms.
\n```${lang}\nexport const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
export const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
export const PENTATONIC_MINOR = [0, 3, 5, 7, 10];
export const DORIAN = [0, 2, 3, 5, 7, 9, 10];

export const ROOT_KEYS = [0, 2, 4, 5, 7, 9, 10]; // C, D, E, F, G, A, Bb

export const CHORD_ROUTINGS_ACG = [
    // IV - V - iii - vi (relative to major scale degrees: 4, 5, 3, 6)
    [3, 4, 2, 5],
    // IV - V - I - vi
    [3, 4, 0, 5],
    // vi - IV - I - V
    [5, 3, 0, 4]
];

export enum ChordQuality {
    MAJOR = 0,
    MINOR = 1,
    DOM7 = 2,
    MAJ7 = 3,
    MIN7 = 4,
    DIM = 5
}

// Fixed mathematical truth mapping standard chords to half-step intervals
export const ChordDictionaries: Record<ChordQuality, number[]> = {
    [ChordQuality.MAJOR]: [0, 4, 7],
    [ChordQuality.MINOR]: [0, 3, 7],
    [ChordQuality.DOM7]:  [0, 4, 7, 10],
    [ChordQuality.MAJ7]:  [0, 4, 7, 11],
    [ChordQuality.MIN7]:  [0, 3, 7, 10],
    [ChordQuality.DIM]:   [0, 3, 6]
};

export const TIME_SIGNATURES = [
    { num: 4, den: 4 },
    { num: 3, den: 4 },
    { num: 6, den: 8 }
];
\n```\n\n### File: `${file}`
**Description**: Generates the high-level melody data and sections.
\n```${lang}\nimport { PRNGManager } from '../utils/PRNG';
import { Tonality, MusicContext, GeneratedTrack, SectionMetadata, GeneratedChord, NoteData, SectionType, OutroStrategy, RoleType, BandMusician } from './types';
import { HarmonyCore } from './harmony/HarmonyCore';
import { GlobalVoicer } from './harmony/GlobalVoicer';
import { ToplineEngine } from './melody/ToplineEngine';

import { DefaultHarmony, StyleRegistry } from './manifests/StyleRegistry';

const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export interface GenerationOptions {
    targetDurationSec?: number;
    style?: any;
    passingChordProb?: number;
    anticipationProb?: number;
    band?: import('./types').BandMusician[]; // Pass down the band
    seed?: number; // Optional seed for deterministic generation
}

export class MelodyEngine {
    public static generateFullSong(options?: GenerationOptions): { track: GeneratedTrack; context: MusicContext } {
        // Use provided seed or generate a random one
        const seed = options?.seed !== undefined ? options.seed : ((Date.now() ^ Math.floor(Math.random() * 1000000)) >>> 0);
        PRNGManager.setSeed(seed);
        
        let bpm = PRNGManager.nextInt(80, 140);
        const tonalities = [Tonality.Major, Tonality.Minor];
        let tonality: Tonality = tonalities[PRNGManager.nextInt(0, 1)];
        let keyOffset = PRNGManager.nextInt(0, 11);
        let key = KEY_NAMES[keyOffset];

        // 3 forms
        const sections: SectionMetadata[] = [
            { name: 'Intro', startBeat: 0, endBeat: 16, energyLevel: 3, type: SectionType.Intro },
            { name: 'Verse', startBeat: 16, endBeat: 48, energyLevel: 5, type: SectionType.Verse },
            { name: 'Chorus', startBeat: 48, endBeat: 80, energyLevel: 8, type: SectionType.Chorus },
            { name: 'Outro', startBeat: 80, endBeat: 96, energyLevel: 4, type: SectionType.Outro }
        ];

        // Determine Global Style from Band
        let globalStyleId = 'Pop'; // Default
        if (options?.band) {
            const leadGroup = options.band.find(m => m.role === RoleType.MainInst || m.role === RoleType.Vocal);
            const accompGroup = options.band.find(m => m.role === RoleType.AccompInst);
            if (leadGroup) {
                globalStyleId = leadGroup.styleId;
            } else if (accompGroup) {
                globalStyleId = accompGroup.styleId;
            }
        }

        const registryStyle = (StyleRegistry as any)[globalStyleId];

        // Default 16-grid probabilities
        const defaultDrumProbabilities = [
            [1.0, 0.0, 0.8, 80, 110], // 1 (1.1)
            [0.1, 0.0, 0.5, 40, 60],  // 1 e
            [0.2, 0.0, 0.9, 50, 70],  // 1 &
            [0.0, 0.2, 0.5, 40, 60],  // 1 a
            
            [0.0, 1.0, 0.8, 90, 120], // 2 (1.2)
            [0.1, 0.0, 0.4, 40, 60],  // 2 e
            [0.4, 0.1, 0.9, 50, 70],  // 2 &
            [0.0, 0.1, 0.4, 40, 60],  // 2 a
            
            [0.8, 0.0, 0.8, 80, 100], // 3 (1.3)
            [0.1, 0.0, 0.5, 40, 60],  // 3 e
            [0.3, 0.0, 0.9, 50, 70],  // 3 &
            [0.2, 0.1, 0.5, 40, 60],  // 3 a
            
            [0.0, 1.0, 0.8, 90, 120], // 4 (1.4)
            [0.0, 0.1, 0.5, 40, 60],  // 4 e
            [0.2, 0.2, 0.9, 50, 70],  // 4 &
            [0.1, 0.3, 0.5, 40, 60],  // 4 a
        ];

        const defaultHarmony = DefaultHarmony;

        let style = registryStyle ? { ...registryStyle } : { drumProbabilities: defaultDrumProbabilities, harmony: defaultHarmony };
        if (options?.style) {
             style = { ...style, ...options.style };
        }
        if (!style.harmony) style.harmony = defaultHarmony;
        if (options?.passingChordProb !== undefined) style.passingChordProb = options.passingChordProb;
        if (options?.anticipationProb !== undefined) style.anticipationProb = options.anticipationProb;

        const outroStrategy = PRNGManager.nextInt(0, 4) as OutroStrategy;

        const basicChords: GeneratedChord[] = HarmonyCore.generateHarmonyTimeline(sections, tonality, keyOffset, style, outroStrategy);
        const harmonicFrames = GlobalVoicer.createHarmonicFrames(basicChords, style.tensionLimits ?? 13, tonality);
        
        // Pass harmonicFrames to ToplineEngine
        const melody: NoteData[] = ToplineEngine.generateMelody(basicChords, tonality, harmonicFrames);

        const track: GeneratedTrack = {
            chords: basicChords,
            harmonicFrames,
            melody,
            bpm,
            key,
            keyOffset,
            tonality,
            timeSignature: [4, 4],
            sections,
            absoluteStartBeat: 0,
            hasIntro: true,
        };

        const context: MusicContext = {
            keyOffset,
            tonality,
            bpm,
            timeSignature: [4, 4],
            sections,
            globalStyleId,
            style,
            outroStrategy,
            band: options?.band,
            harmonicFrames,
            seed
        };

        return { track, context };
    }
}
\n```\n\n### File: `${file}`
**Description**: Coordinates between plugins, styles, and music engines.
\n```${lang}\nimport { ArrangedTrack, GeneratedTrack, MusicContext, NoteData, SectionType, OutroStrategy, RoleType, IdiomType, InstrumentConfig, MusicalRole } from './types';
import { GrooveEngine } from './groove/GrooveEngine';
import { IdiomDispatcher } from './idioms/IdiomDispatcher';
import { getInstrumentConfig } from './manifests/InstrumentRegistry';

export class Orchestrator {
    private static applyPhysicalConstraints(notes: NoteData[], config: InstrumentConfig): NoteData[] {
        let result = [...notes];
        
        // 1. Min/Max Pitch Clamping
        result = result.map(n => {
            let p = n.pitch;
            while (p < config.minPitch) p += 12;
            while (p > config.maxPitch) p -= 12;
            return { ...n, pitch: p };
        });

        // 2. Anti-Mud Mechanism
        // Group notes by onset (with a tiny tolerance)
        result.sort((a, b) => a.onset - b.onset || a.pitch - b.pitch);
        
        const onsets: Record<string, NoteData[]> = {};
        result.forEach(n => {
            const key = (Math.round(n.onset * 100) / 100).toString();
            if (!onsets[key]) onsets[key] = [];
            onsets[key].push(n);
        });

        const finalNotes: NoteData[] = [];
        Object.values(onsets).forEach(chordNotes => {
            // Check anti-mud
            if (config.antiMudThreshold > 0) {
                // sort bottom to top
                chordNotes.sort((a, b) => a.pitch - b.pitch);
                for (let i = 0; i < chordNotes.length - 1; i++) {
                    const lower = chordNotes[i];
                    const upper = chordNotes[i+1];
                    // If both are below the mud threshold and strictly closer than a minor 3rd (3 semitones)
                    if (lower.pitch < config.antiMudThreshold && upper.pitch < config.antiMudThreshold) {
                        const interval = upper.pitch - lower.pitch;
                        if (interval > 0 && interval < 3) { // muddy!
                            upper.pitch += 12; 
                        }
                    }
                }
            }
            finalNotes.push(...chordNotes);
        });

        return finalNotes.sort((a, b) => a.onset - b.onset);
    }

    public static arrange(track: GeneratedTrack, context: MusicContext): ArrangedTrack {
        const totalBeats = track.sections.length > 0 ? track.sections[track.sections.length - 1].endBeat : 0;
        
        let drumTrack: NoteData[] = [];
        let grooveDNA: import('./types').GrooveDNA = { anchors: [0], density: 0.5, intensity: 0.5 };

        if (context.style) {
            const groove = GrooveEngine.generateGroove(context.style, totalBeats, context);
            drumTrack = groove.drumTrack;
            grooveDNA = groove.dna;
        }

        // --- Capability Negotiation ---
        const band = context.band || [];
        
        // Define all roles that need to be met for a complete song
        const neededRoles = [MusicalRole.Lead, MusicalRole.Accomp, MusicalRole.Bass];
        
        // Map from Musician ID to the roles they are assigned
        const musicianRoleAssignments = new Map<string, MusicalRole[]>();
        band.forEach(m => musicianRoleAssignments.set(m.id, []));
        
        // Attempt to assign each needed role to capable musicians
        for (const role of neededRoles) {
            // Find musicians in band capable of this role, favoring their primary designated role if possible
            const capableMusicians = band.filter(m => {
                const config = getInstrumentConfig(m.instrumentId);
                return config.capabilities?.includes(role);
            });
            
            if (capableMusicians.length > 0) {
                // Priority assignment (e.g. Lead role goes to MainInst if possible)
                let chosen = capableMusicians[0];
                if (role === MusicalRole.Lead) {
                    chosen = capableMusicians.find(m => m.role === RoleType.MainInst) || chosen;
                } else if (role === MusicalRole.Bass) {
                    chosen = capableMusicians.find(m => m.role === RoleType.Bass) || chosen;
                } else if (role === MusicalRole.Accomp) {
                    chosen = capableMusicians.find(m => m.role === RoleType.AccompInst) || chosen;
                }
                musicianRoleAssignments.get(chosen.id)?.push(role);
            }
        }
        
        // --- Dispatch Accompaniment ---
        context.melody = track.melody;
        
        // We accumulate generated notes from all musicians
        let finalMelody: NoteData[] = [];
        let finalPianoRH: NoteData[] = [];
        let finalPianoLH: NoteData[] = [];
        
        band.forEach(musician => {
            const roles = musicianRoleAssignments.get(musician.id) || [];
            if (roles.length === 0 && musician.role !== RoleType.Drums) return; // Unused or drums
            
            // Generate for this musician with their specific roles
            // Here we dispatch to IdiomDispatcher but we pass the roles so the idiom knows what to do
            const idiomOutput = IdiomDispatcher.generateForMusician(
                musician,
                roles,
                track,
                grooveDNA,
                context
            );
            
            const config = getInstrumentConfig(musician.instrumentId);
            
            // Merge results with physical constraints applied
            if (idiomOutput.melody) {
                finalMelody.push(...this.applyPhysicalConstraints(idiomOutput.melody, config));
            }
            if (idiomOutput.pianoRH) {
                finalPianoRH.push(...this.applyPhysicalConstraints(idiomOutput.pianoRH, config));
            }
            if (idiomOutput.pianoLH) {
                finalPianoLH.push(...this.applyPhysicalConstraints(idiomOutput.pianoLH, config));
            }
        });

        // If no band was provided, fallback to default generic behavior
        if (band.length === 0) {
            const { pianoLH, pianoRH } = IdiomDispatcher.generateAccompaniment(track.chords, track.sections, grooveDNA, context);
            finalMelody = track.melody.map(n => ({ ...n, pitch: n.pitch + track.keyOffset + 72 }));
            finalPianoRH = pianoRH.map(n => ({ ...n, pitch: n.pitch + track.keyOffset + 60 }));
            finalPianoLH = pianoLH.map(n => ({ ...n, pitch: n.pitch + track.keyOffset + 60 }));
            
            finalMelody = this.applyPhysicalConstraints(finalMelody, getInstrumentConfig(0));
            finalPianoRH = this.applyPhysicalConstraints(finalPianoRH, getInstrumentConfig(0));
            finalPianoLH = this.applyPhysicalConstraints(finalPianoLH, getInstrumentConfig(2));
        }

        // --- Apply OutroStrategy ---
        const outroSection = track.sections.find(s => s.name === 'Outro' || s.type === SectionType.Outro);
        if (outroSection && context.outroStrategy !== undefined) {
            const outroStart = outroSection.startBeat;
            const outroEnd = outroSection.endBeat;
            const outroLength = outroEnd - outroStart;
            const Strategy = OutroStrategy;

            // 1. SuddenStop: Everything stops abruptly half a measure (2 beats) before actual end
            if (context.outroStrategy === Strategy.SuddenStop) {
                const stopBeat = outroEnd - 2;
                finalMelody = finalMelody.filter(n => n.onset < stopBeat);
                finalPianoLH = finalPianoLH.filter(n => n.onset < stopBeat);
                finalPianoRH = finalPianoRH.filter(n => n.onset < stopBeat);
                drumTrack = drumTrack.filter(n => n.onset < stopBeat);
                
                // Truncate durations of the final notes
                [finalMelody, finalPianoLH, finalPianoRH].forEach(arr => {
                    arr.forEach(n => {
                        if (n.onset + n.duration > stopBeat) {
                            n.duration = stopBeat - n.onset;
                        }
                    });
                });
            }

            // 2. MotifDecay: Subtractive arrangement. Drums stop halfway, chords become sparse.
            if (context.outroStrategy === Strategy.MotifDecay) {
                const halfway = outroStart + (outroLength / 2);
                drumTrack = drumTrack.filter(n => n.onset < halfway);
                finalPianoLH = finalPianoLH.filter(n => n.onset < halfway || (n.onset >= halfway && n.onset % 4 === 0)); // Only play on downbeats
            }

            // 3. FadeOut / Ritardando : Gradual velocity decay in the last 4 to 8 beats
            if (context.outroStrategy === Strategy.FadeOut || context.outroStrategy === Strategy.Ritardando) {
                const fadeStart = outroEnd - 8; // Fade over last 8 beats
                const applyFade = (trackNotes: NoteData[]) => {
                    trackNotes.forEach(n => {
                        if (n.onset >= fadeStart && n.onset <= outroEnd) {
                            const ratio = 1 - ((n.onset - fadeStart) / 8);
                            n.velocity = Math.floor(n.velocity * Math.max(0.1, ratio));
                        }
                    });
                };
                applyFade(finalMelody);
                applyFade(finalPianoLH);
                applyFade(finalPianoRH);
                applyFade(drumTrack);
            }
        }

        return {
            bpm: track.bpm,
            key: track.key,
            absoluteStartBeat: track.absoluteStartBeat,
            timeSignature: track.timeSignature,
            melody: finalMelody,
            pianoLH: finalPianoLH,
            pianoRH: finalPianoRH,
            chords: track.chords,
            sections: track.sections,
            drums: drumTrack
        };
    }
}
\n```\n\n### File: `${file}`
**Description**: Deterministic pseudo-random number generator for reproducibility.
\n```${lang}\nexport class PRNGManager {
    private static state: number = 0;

    /**
     * Initializes the PRNG seed
     */
    public static setSeed(seed: number): void {
        this.state = seed >>> 0;
    }

    /**
     * Returns a float between [0, 1)
     */
    public static next(): number {
        // LCG utilizing POSIX standard parameters
        this.state = (Math.imul(this.state, 1103515245) + 12345) & 0x7fffffff;
        return this.state / 0x80000000;
    }

    /**
     * Returns an integer between [min, max)
     */
    public static nextInt(min: number, max: number): number {
        return min + Math.floor(this.next() * (max - min));
    }

    /**
     * Takes a snapshot of the current state
     */
    public static getState(): number {
        return this.state;
    }

    /**
     * Restores the state
     */
    public static setState(state: number): void {
        this.state = state;
    }
}
\n```\n\n### File: `${file}`
**Description**: Responsible for scheduling notes via SpessaSynth or Web Audio API.
\n```${lang}\nimport { ArrangedTrack, MusicContext, NoteData } from './types';
import { WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';

export interface MidiEvent {
    time: number;
    type: number; // 0 for NoteOn, 1 for NoteOff, 2 for CC
    pitch: number;    // note number, OR CC controller number
    velocity: number; // attack velocity, OR CC value
    instrument: number; // channel
}

// Web Audio API lightweight synthesizer mapping
export class PlaybackEngine {
    private ac: AudioContext | null = null;
    private synth: WorkletSynthesizer | null = null;
    private initPromise: Promise<void> | null = null;
    
    private nextEventIdx = 0;
    private events: MidiEvent[] = [];
    private startTime = 0;
    private isPlaying = false;
    private timerWorker: Worker | null = null;

    public async init(): Promise<void> {
        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = (async () => {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            this.ac = new AudioContextClass();
            
            await this.ac.audioWorklet.addModule(processorUrl);
            
            this.synth = new WorkletSynthesizer(this.ac);
            await this.synth.isReady;
            
            // Connect synthesizer to output destination
            this.synth.connect(this.ac.destination);

            // Initialize inline worker for background timing
            const workerCode = `
                let interval;
                self.onmessage = function(e) {
                    if (e.data === 'start') {
                        interval = setInterval(() => self.postMessage('tick'), 50);
                    } else if (e.data === 'stop') {
                        clearInterval(interval);
                    }
                };
            `;
            const blob = new Blob([workerCode], { type: 'application/javascript' });
            this.timerWorker = new Worker(URL.createObjectURL(blob));
            this.timerWorker.onmessage = () => {
                this.schedule();
            };
        })();

        return this.initPromise;
    }

    public isInitialized(): boolean {
        return this.synth !== null;
    }

    public async loadSoundfont(buffer: ArrayBuffer): Promise<void> {
        if (!this.synth) await this.init();
        await this.synth!.soundBankManager.addSoundBank(buffer, "custom-sf2");
        this.applyMixConfig();
    }

    private applyMixConfig(): void {
        if (!this.synth) return;
        
        // --- Piano Arrangement & Mix Configuration ---
        // 1. Instrument Selection (Program Change)
        // Melody (Ch 0): Flute (73) or Synth Voice (54) to represent the "Vocalist"
        this.synth.programChange(0, 73);
        // Accompaniment RH (Ch 1): Acoustic Grand (0)
        this.synth.programChange(1, 0);
        // Accompaniment LH (Ch 2): Acoustic Grand (0)
        this.synth.programChange(2, 0);

        // 2. Mix (Volume & Pan)
        this.synth.controllerChange(0, 7, 100);  // Melody volume
        this.synth.controllerChange(1, 7, 95);  // Accompaniment RH volume
        this.synth.controllerChange(2, 7, 75);  // Accompaniment LH volume (matched down to counter low freq resonance)
        this.synth.controllerChange(9, 7, 95);  // Drums volume

        // Pan: push melody center, accompaniment LH left, accompaniment RH right to simulate piano keyboard spacing
        this.synth.controllerChange(0, 10, 64); // Center
        this.synth.controllerChange(1, 10, 85); // Right
        this.synth.controllerChange(2, 10, 43); // Left
        
        // 3. Reverb for a nice grand piano sound
        this.synth.controllerChange(0, 91, 75); 
        this.synth.controllerChange(1, 91, 85); 
        this.synth.controllerChange(2, 91, 85); 
        this.synth.controllerChange(9, 91, 50); // Less reverb on drums
    }

    public async play(arranged: ArrangedTrack, context: MusicContext): Promise<void> {
        this.stop(); // Stop existing

        if (!this.synth) {
            console.warn("Synthesizer not initialized or sf2 not loaded");
            return; // Needs an explicit init and SF2 load first.
        }
        
        this.applyMixConfig(); // Re-apply base mix

        // 1. Dynamic Instrument Selection (Program Change) based on Band Configuration
        const melodicMusicians = context.band?.filter(m => m.role !== 'drums') || [];
        const isSoloMelodic = melodicMusicians.length === 1;

        let leadChannel = 0;
        let accompChannel = 1;
        let bassChannel = 2;

        if (isSoloMelodic) {
            // A single musician is playing all melodic/harmonic parts (e.g. Solo Piano)
            const soleInstId = melodicMusicians[0].instrumentId;
            
            // Route all to Channel 1
            leadChannel = 1;
            accompChannel = 1;
            bassChannel = 1;
            
            // Set program and unified mix for the single instrument
            this.synth.programChange(1, soleInstId);
            this.synth.controllerChange(1, 7, 100);  // Unified Volume
            this.synth.controllerChange(1, 10, 64); // Centered Pan for the whole instrument
            this.synth.controllerChange(1, 91, 85); // Unified Reverb
            
            console.log(`[PlaybackEngine] Solo Melodic Mode Detected. Routing all to Channel 1 (Instrument ID: ${soleInstId})`);
        } else {
            const mainMusician = context.band?.find(m => m.role === 'mainInst' || m.role === 'vocal');
            const accompMusician = context.band?.find(m => m.role === 'accompInst');
            const bassMusician = context.band?.find(m => m.role === 'bass');

            // Melody (Ch 0)
            this.synth.programChange(0, mainMusician ? mainMusician.instrumentId : 73);
            
            // Accompaniment RH (Ch 1)
            this.synth.programChange(1, accompMusician ? accompMusician.instrumentId : 0);
            
            // Accompaniment LH / Bass (Ch 2)
            this.synth.programChange(2, bassMusician ? bassMusician.instrumentId : (accompMusician ? accompMusician.instrumentId : 0));
        }
        
        if (this.ac!.state === 'suspended') {
            await this.ac!.resume();
        }

        const absoluteEvents: MidiEvent[] = [];
        const secondsPerBeat = 60 / context.bpm;

        const applySwing = (beat: number): number => {
            if (!context.swingRatio || context.swingRatio <= 0.5) return beat;
            const whole = Math.floor(beat);
            const frac = beat - whole;
            
            if (frac === 0) return whole;
            
            // Map the 0.0 - 0.5 range to 0.0 - swingRatio
            // Map the 0.5 - 1.0 range to swingRatio - 1.0
            if (frac < 0.5) {
                return whole + (frac / 0.5) * context.swingRatio;
            } else {
                return whole + context.swingRatio + ((frac - 0.5) / 0.5) * (1 - context.swingRatio);
            }
        };

        const processTrack = (notes: NoteData[] | undefined, channel: number) => {
            if (!notes) return;
            for (const note of notes) {
                const swungOnset = applySwing(note.onset);
                const swungEnd = applySwing(note.onset + note.duration);
                const actualDuration = Math.max(0.01, swungEnd - swungOnset);

                const startTimeSec = swungOnset * secondsPerBeat;
                const durationSec = actualDuration * secondsPerBeat;
                
                absoluteEvents.push({
                    time: startTimeSec,
                    type: 0,
                    pitch: Math.round(note.pitch),
                    velocity: Math.max(1, Math.min(127, Math.round(note.velocity * 127))),
                    instrument: channel
                });

                absoluteEvents.push({
                    time: startTimeSec + durationSec,
                    type: 1,
                    pitch: Math.round(note.pitch),
                    velocity: 0,
                    instrument: channel
                });
            }
        };

        const hasMelodyPlayer = arranged.melody && arranged.melody.length > 0;
        
        if (hasMelodyPlayer) {
            processTrack(arranged.melody, leadChannel);
        }
        
        processTrack(arranged.pianoRH, accompChannel);
        processTrack(arranged.pianoLH, bassChannel);
        processTrack(arranged.drums, 9); // Drum Channel
        
        // The base mix is already applied via applyMixConfig().
        // Dynamics are handed natively and smoothly via note velocities calculated in the Idioms.

        absoluteEvents.sort((a, b) => a.time - b.time);
        
        console.log(`[PlaybackEngine] Prepared ${absoluteEvents.length} MIDI events from the track.`);
        
        this.events = absoluteEvents;
        this.nextEventIdx = 0;
        this.startTime = this.ac!.currentTime + 0.1;
        this.isPlaying = true;

        if (this.timerWorker) {
            this.timerWorker.postMessage('start');
        } else {
            this.schedule(); // fallback
        }
    }

    public stop(): void {
        this.isPlaying = false;
        if (this.timerWorker) {
            this.timerWorker.postMessage('stop');
        }
        if (this.synth) {
            this.synth.stopAll(true);
        }
    }

    private schedule = (): void => {
        if (!this.isPlaying || !this.synth || !this.ac) return;

        const currentTime = this.ac.currentTime;
        // Increase lookahead to prevent starvation
        const lookahead = 0.5;

        while (this.nextEventIdx < this.events.length) {
            const ev = this.events[this.nextEventIdx];
            const targetTime = this.startTime + ev.time;

            if (targetTime < currentTime + lookahead) {
                const channel = ev.instrument as number;

                if (ev.type === 0) { 
                    this.synth.noteOn(channel, ev.pitch, ev.velocity, { time: targetTime });
                } else if (ev.type === 1) {
                    this.synth.noteOff(channel, ev.pitch, { time: targetTime });
                } else if (ev.type === 2) {
                    try {
                        // Attempt to pass targetTime if supported by underlying implementation
                        (this.synth as any).controllerChange(channel, ev.pitch, ev.velocity, { time: targetTime });
                    } catch (e) {
                         this.synth.controllerChange(channel, ev.pitch as any, ev.velocity);
                    }
                }
                
                if (this.nextEventIdx === 0) {
                    console.log(`[PlaybackEngine] Dispatching first event: type=${ev.type} pitch=${ev.pitch} targetTime=${targetTime}`);
                }
                
                this.nextEventIdx++;
            } else {
                break;
            }
        }

        if (this.nextEventIdx >= this.events.length) {
            this.stop();
        } else if (!this.timerWorker) {
            // fallback if worker failed to initialize for some reason
            setTimeout(this.schedule, 50);
        }
    }
}

\n```\n\n### File: `${file}`
**Description**: Generates drum and rhythm grooves.
\n```${lang}\nimport { NoteData, StyleConfig, GrooveDNA, MusicContext, RoleType } from '../types';
import { PRNGManager } from '../../utils/PRNG';
import { GroovePlugin } from './plugins/GroovePlugin';
import { HumanizePlugin } from './plugins/HumanizePlugin';

export class GrooveEngine {
    private static plugins: GroovePlugin[] = [
        new HumanizePlugin()
    ];

    public static registerPlugin(plugin: GroovePlugin) {
        this.plugins.push(plugin);
    }

    public static generateGroove(style: StyleConfig, totalBeats: number, context?: MusicContext): { drumTrack: NoteData[], dna: GrooveDNA } {
        let drumTrack: NoteData[] = [];
        const anchors: number[] = [0]; // baseline anchor
        
        let densityAccumulator = 0;
        let intensityAccumulator = 0;
        let hits = 0;

        const drumMusician = context?.band?.find(m => m.role === RoleType.Drums);
        const drumPersona = drumMusician?.persona;
        const dynMin = drumPersona ? drumPersona.dynamicRange[0] : 60;
        const dynMax = drumPersona ? drumPersona.dynamicRange[1] : 110;

        for (let beat = 0; beat < totalBeats - 0.001; beat += 0.25) {
            const grid = Math.round((beat % 4) / 0.25);
            if (grid >= 16) continue;

            // Base Brain: Unopinionated mathematical evaluation of the grid
            const probs = style.drumProbabilities ? style.drumProbabilities[grid] : null;
            if (!probs) continue;
            
            const [kickProb, snareProb, hihatProb, minVelOrig, maxVelOrig] = probs;
            
            // map [60, 110] default to [dynMin, dynMax]
            const mapVel = (v: number) => {
                const norm = Math.max(0, Math.min(1, Math.max(0, v - 60) / 50));
                return dynMin + norm * (dynMax - dynMin);
            };

            const minVel = mapVel(minVelOrig);
            const maxVel = mapVel(maxVelOrig);

            const rollKick = PRNGManager.nextFloat(0, 1);
            const rollSnare = PRNGManager.nextFloat(0, 1);
            const rollHihat = PRNGManager.nextFloat(0, 1);

            let hasStrongHit = false;

            if (rollKick < kickProb) {
                const vel = PRNGManager.nextFloat(minVel, maxVel);
                drumTrack.push({ pitch: 36, onset: beat, duration: 0.1, velocity: vel / 127 });
                if (vel >= 70) hasStrongHit = true;
                intensityAccumulator += vel;
                hits++;
            }

            if (rollSnare < snareProb) {
                const vel = PRNGManager.nextFloat(minVel, maxVel);
                drumTrack.push({ pitch: 38, onset: beat, duration: 0.1, velocity: vel / 127 });
                if (vel >= 70) hasStrongHit = true;
                intensityAccumulator += vel;
                hits++;
            }

            if (rollHihat < hihatProb) {
                const vel = PRNGManager.nextFloat(Math.max(20, minVel - 20), Math.max(30, maxVel - 20));
                drumTrack.push({ pitch: 42, onset: beat, duration: 0.1, velocity: vel / 127 });
            }

            if (hasStrongHit) {
                const mappedAnchor = beat % 4; // Map relative to a single bar
                if (!anchors.includes(mappedAnchor)) {
                    anchors.push(mappedAnchor);
                }
            }
        }

        // Apply Plugins
        for (const plugin of this.plugins) {
            drumTrack = plugin.process(drumTrack, style, totalBeats, context);
        }

        densityAccumulator = hits / (totalBeats * 4); // normalize
        
        anchors.sort((a, b) => a - b);
        
        // Guarantee at least 0 is an anchor
        if (anchors.length === 0 || anchors[0] !== 0) {
            if (!anchors.includes(0)) {
                anchors.unshift(0);
                anchors.sort((a, b) => a - b);
            }
        }

        const lhRoles = [0, 1, 2, 3]; // Anchor, Stride, Comp, Arp
        const rhRoles = [0, 1, 2, 3]; // Block, Arp, Linear, Sparse
        const contourTypes = [0, 1, 2, 3]; // Upward, Downward, Alternating, Random
        const pianoMotifDNA = {
            voicingPreference: PRNGManager.nextFloat(0, 1), // Continuous 0 to 1
            rhythmicAnchor: PRNGManager.nextFloat(0, 1), // 0 = fully on-beat, 1 = extremly syncopated
            contour: contourTypes[Math.floor(PRNGManager.nextFloat(0, 1) * contourTypes.length)],
            densityBaseline: PRNGManager.nextFloat(0.3, 0.8),
            lhRole: lhRoles[Math.floor(PRNGManager.nextFloat(0, 1) * lhRoles.length)],
            rhRole: rhRoles[Math.floor(PRNGManager.nextFloat(0, 1) * rhRoles.length)],
            interlock: PRNGManager.nextFloat(0, 1)
        };

        return {
            drumTrack,
            dna: {
                anchors,
                density: Math.min(1.0, densityAccumulator * 2),
                intensity: Math.min(1.0, intensityAccumulator / (hits * 127 || 1)),
                pianoMotifDNA
            }
        };
    }
}
\n```\n\n### File: `${file}`
**Description**: Plugin basis for drum patterns.
\n```${lang}\nimport { NoteData, StyleConfig, MusicContext } from '../../types';

export interface GroovePlugin {
    process(drumTrack: NoteData[], style: StyleConfig, totalBeats: number, context?: MusicContext): NoteData[];
}
\n```\n\n### File: `${file}`
**Description**: Adds micro-timing inaccuracies to make MIDI feel more human.
\n```${lang}\nimport { NoteData, StyleConfig, MusicContext } from '../../types';
import { GroovePlugin } from './GroovePlugin';
import { PRNGManager } from '../../../utils/PRNG';

export class HumanizePlugin implements GroovePlugin {
    process(drumTrack: NoteData[], style: StyleConfig, totalBeats: number, context?: MusicContext): NoteData[] {
        return drumTrack.map(note => {
            // Slight timing variations
            const onsetDeviation = PRNGManager.nextFloat(-0.02, 0.02);
            // Slight velocity variations
            const velocityDeviation = PRNGManager.nextFloat(-0.05, 0.05);

            return {
                ...note,
                onset: Math.max(0, note.onset + onsetDeviation),
                velocity: Math.max(0.1, Math.min(1.0, note.velocity + velocityDeviation))
            };
        });
    }
}
\n```\n\n### File: `${file}`
**Description**: Calculates chord voicings for polyphonic instruments.
\n```${lang}\nimport { GeneratedChord, GlobalHarmonicFrame, ToneAllocation, MusicalRole, ChordQuality, InstrumentConfig } from '../types';
import { PRNGManager } from '../../utils/PRNG';
import { MusicTheory } from '../theory/MusicTheory';

export class GlobalVoicer {
    /**
     * Builds a list of GlobalHarmonicFrames from raw GeneratedChords.
     * This determines EXACLY what pitches (essential and tensions) exist in the ether
     * for a given duration, and assigns ROLES to them (who is responsible for playing them).
     */
    public static createHarmonicFrames(chords: GeneratedChord[], styleTensionLimit: number = 13, tonality: Tonality): GlobalHarmonicFrame[] {
        const frames: GlobalHarmonicFrame[] = [];

        for (const chord of chords) {
            // 1. Identify Pitch Scale & Extracted Tensions based on chord quality
            const { essentials, availableTensions, scale } = this.analyzeChord(chord, styleTensionLimit, tonality);

            // 2. Distribute Roles
            const allocations: ToneAllocation[] = [];

            // A. Bass must play the Root (or bass override)
            const bassPitchClass = chord.bassOverride !== undefined ? chord.bassOverride : chord.root;
            allocations.push({
                pitchClass: bassPitchClass,
                role: MusicalRole.Bass,
                isEssential: true,
                isTension: false
            });

            // B. Accompaniment takes the Guide Tones (3rd and 7th), AND we should also inject the root 
            // so the accompaniment doesn't just sound like an ambiguous upper-structure major dyad 
            // (e.g. minor chord 3rd and 5th form a major 3rd).
            const guideTones = essentials.filter(p => p !== chord.root);
            
            // Give Accomp the root as well so it's a complete chord
            allocations.push({
                pitchClass: chord.root,
                role: MusicalRole.Accomp,
                isEssential: true,
                isTension: false
            });
            // Give Lead the root
            allocations.push({
                pitchClass: chord.root,
                role: MusicalRole.Lead,
                isEssential: true,
                isTension: false
            });

            for (const gt of guideTones) {
                // Accompaniment definitely gets the guide tones
                allocations.push({
                    pitchClass: gt,
                    role: MusicalRole.Accomp,
                    isEssential: true,
                    isTension: false
                });
                // Lead also definitely gets the guide tones
                allocations.push({
                    pitchClass: gt,
                    role: MusicalRole.Lead,
                    isEssential: true,
                    isTension: false
                });
            }

            // C. Dynamic Tension Routing (This breaks the "similiarity" / 雷同性)
            // Decide if the melody gets the defining tension, or the accompaniment, or both.
            for (const tension of availableTensions) {
                const roll = PRNGManager.nextFloat(0, 1);
                if (roll < 0.4) {
                    // Tension goes to Melody explicitly (Accomp avoids or plays very sparsely)
                    allocations.push({ pitchClass: tension, role: MusicalRole.Lead, isEssential: false, isTension: true });
                } else if (roll < 0.8) {
                    // Tension goes to Accompaniment (Thick chord)
                    allocations.push({ pitchClass: tension, role: MusicalRole.Accomp, isEssential: false, isTension: true });
                } else {
                    // Shared Tension (Both can use it)
                    allocations.push({ pitchClass: tension, role: MusicalRole.Lead, isEssential: false, isTension: true });
                    allocations.push({ pitchClass: tension, role: MusicalRole.Accomp, isEssential: false, isTension: true });
                }
            }

            frames.push({
                startBeat: chord.startBeat,
                endBeat: chord.endBeat,
                chord: chord,
                toneAllocations: allocations,
                pitchScale: scale
            });
        }

        return frames;
    }

    private static analyzeChord(chord: GeneratedChord, tensionLimit: number, tonality: Tonality): { essentials: number[], availableTensions: number[], scale: number[] } {
        const root = chord.root;
        const q = chord.quality;
        
        let essentials: number[] = [];
        let tensions: number[] = [];
        let scaleDegrees: number[] = [0, 2, 4, 5, 7, 9, 11]; // Default major scale relative offsets

        // Use exact intervals from MusicTheory
        const intervals = MusicTheory.getChordTones(q);
        if (intervals && intervals.length > 0) {
            // Usually roots, 3rds, 5ths, 7ths are essential
            essentials = intervals.slice(0, Math.min(4, intervals.length)).map(i => (root + i) % 12);
            // Higher extensions are tensions
            if (intervals.length > 4) {
                tensions = intervals.slice(4).map(i => (root + i) % 12);
            }
        } else {
            // Fallback
             essentials.push(root, (root + 4) % 12, (root + 7) % 12);
        }

        const absoluteScale = MusicTheory.getLocalScalePitches(root, q, tonality);

        return { essentials, availableTensions: tensions, scale: absoluteScale };
    }
}
\n```\n\n### File: `${file}`
**Description**: Handles chord progressions and functional harmony logic.
\n```${lang}\nimport { GeneratedChord, SectionMetadata, Tonality, OutroStrategy, SectionType } from '../types';
import { PRNGManager } from '../../utils/PRNG';
import { MusicTheory } from '../theory/MusicTheory';
import { HarmonyPlugin } from './plugins/HarmonyPlugin';
import { AnticipationPlugin } from './plugins/AnticipationPlugin';
import { PassingChordPlugin } from './plugins/PassingChordPlugin';
import { ModalInterchangePlugin } from './plugins/ModalInterchangePlugin';
import { SecondaryDominantPlugin } from './plugins/SecondaryDominantPlugin';

export class HarmonyCore {
    private static plugins: HarmonyPlugin[] = [
        new ModalInterchangePlugin(),
        new AnticipationPlugin(),
        new SecondaryDominantPlugin(),
        new PassingChordPlugin()
    ];

    public static registerPlugin(plugin: HarmonyPlugin) {
        this.plugins.push(plugin);
    }

    public static generateHarmonyTimeline(sections: SectionMetadata[], tonality: Tonality, keyOffset: number, style?: import('../types').StyleConfig, outroStrategy?: OutroStrategy): GeneratedChord[] {
        let chords: GeneratedChord[] = [];
        const isMinor = tonality === Tonality.Minor;

        if (!style?.harmony) {
             throw new Error("StyleConfig must provide a harmony configuration.");
        }

        const progDict = isMinor ? style.harmony.minor : style.harmony.major;

        // --- Pass 1: Generate Base Chords Flatly ---
        for (let s = 0; s < sections.length; s++) {
            const sec = sections[s];
            let typeKey = sec.type ? sec.type.toString() : 'verse';
            
            // Fallback routing if the specific section type isn't defined in the style
            if (!progDict[typeKey]) {
                if (typeKey === 'preChorus' && progDict['verse']) typeKey = 'verse';
                else if (typeKey === 'outro' && progDict['chorus']) typeKey = 'chorus';
                else if (typeKey === 'bridge' && progDict['chorus']) typeKey = 'chorus';
                else typeKey = Object.keys(progDict)[0]; // Just grab the first available
            }

            const pool = progDict[typeKey];
            const progStr = pool[PRNGManager.nextInt(0, pool.length - 1)];
            
            let b = sec.startBeat;
            let progIdx = 0;
            let isFirstChord = true;

            while (b < sec.endBeat - 0.001) {
                let numeralOrig = progStr[progIdx % progStr.length];
                let numeral = numeralOrig;
                
                const parsed = MusicTheory.parseNumeral(numeral, tonality);
                
                let duration = 4;
                if (progStr.length >= 8) duration = 2; // Usually 2 chords per bar for longer progressions
                let endBeat = b + duration;

                if (endBeat > sec.endBeat) endBeat = sec.endBeat;

                chords.push({
                    numeral,
                    root: parsed.root,
                    quality: parsed.quality,
                    startBeat: b,
                    endBeat,
                    keyOffset,
                    bassOverride: parsed.bassOverride
                });
                
                b = endBeat;
                isFirstChord = false;
                progIdx++;
            }
        }

        // --- Strategy Application (Post Processing baseChords) ---
        if (chords.length > 0 && outroStrategy === OutroStrategy.Unresolved) {
            const lastBc = chords[chords.length - 1];
            // Replace the last chord with IV or vi instead of whatever it is (typically I)
            const options = isMinor ? ['iv', 'VI'] : ['IV', 'vi'];
            const unresolvedNumeral = options[PRNGManager.nextInt(0, options.length - 1)];
            lastBc.numeral = unresolvedNumeral;
            const parsed = MusicTheory.parseNumeral(unresolvedNumeral, tonality);
            lastBc.root = parsed.root;
            lastBc.quality = parsed.quality;
            lastBc.bassOverride = parsed.bassOverride;
            
            // Make the final unresolved chord linger longer
            lastBc.endBeat += 4;
        } else if (chords.length > 0 && outroStrategy === OutroStrategy.Ritardando) {
             const lastBc = chords[chords.length - 1];
             // Hold the last chord (usually I) a bit longer
             lastBc.endBeat += 4;
        }

        // Apply Plugins
        for (const plugin of this.plugins) {
            chords = plugin.process(chords, {
                sections,
                tonality,
                keyOffset,
                style
            });
        }

        return chords;
    }
}
\n```\n\n### File: `${file}`
**Description**: Plugin to pull chords early (syncopation).
\n```${lang}\nimport { GeneratedChord, SectionMetadata, Tonality, StyleConfig } from '../../types';
import { HarmonyPlugin } from './HarmonyPlugin';
import { PRNGManager } from '../../../utils/PRNG';

const ANTICIPATION_BEAT = 0.5;

export class AnticipationPlugin implements HarmonyPlugin {
    process(chords: GeneratedChord[], context: { sections: SectionMetadata[], tonality: Tonality, keyOffset: number, style?: StyleConfig }): GeneratedChord[] {
        const anticipationProb = context.style?.anticipationProb ?? 0.3;
        if (anticipationProb <= 0) return chords;

        const result: GeneratedChord[] = [];

        for (let i = 0; i < chords.length; i++) {
            const bc = chords[i];
            
            // Check if it's the start of a section
            const sec = context.sections.find(s => bc.startBeat >= s.startBeat && bc.startBeat < s.endBeat);
            const isSectionStart = sec && Math.abs(bc.startBeat - sec.startBeat) < 0.01;

            let startBeat = bc.startBeat;

            if (sec && sec.energyLevel >= 6 && !isSectionStart && i > 0 && PRNGManager.nextFloat(0, 1) < anticipationProb) {
                const candidateStart = bc.startBeat - ANTICIPATION_BEAT;
                if (result.length > 0 && candidateStart - result[result.length - 1].startBeat >= 0.5) {
                    result[result.length - 1].endBeat = candidateStart;
                    startBeat = candidateStart;
                }
            }

            result.push({
                ...bc,
                startBeat
            });
        }

        return result;
    }
}
\n```\n\n### File: `${file}`
**Description**: Base class for harmony modifications.
\n```${lang}\nimport { GeneratedChord, SectionMetadata, Tonality, StyleConfig } from '../../types';

export interface HarmonyPlugin {
    process(chords: GeneratedChord[], context: {
        sections: SectionMetadata[],
        tonality: Tonality,
        keyOffset: number,
        style?: StyleConfig
    }): GeneratedChord[];
}
\n```\n\n### File: `${file}`
**Description**: Injects secondary dominants and passing chords.
\n```${lang}\nimport { GeneratedChord, SectionMetadata, Tonality, StyleConfig } from '../../types';
import { HarmonyPlugin } from './HarmonyPlugin';
import { PRNGManager } from '../../../utils/PRNG';
import { MusicTheory, ChordQualityEnum } from '../../theory/MusicTheory';

export class PassingChordPlugin implements HarmonyPlugin {
    process(chords: GeneratedChord[], context: { sections: SectionMetadata[], tonality: Tonality, keyOffset: number, style?: StyleConfig }): GeneratedChord[] {
        const passingProb = context.style?.passingChordProb ?? 0.2;
        if (passingProb <= 0) return chords;

        const result: GeneratedChord[] = [];
        const scalePcs = MusicTheory.getScalePitches(context.tonality);

        // Track how many times a progression might be repeating to only add passing chords on turnaround
        let loopCounter = 0;

        for (let i = 0; i < chords.length; i++) {
            const bc = chords[i];
            const nextBc = i + 1 < chords.length ? chords[i + 1] : null;

            const duration = bc.endBeat - bc.startBeat;
            
            // Only trigger if moving to a different chord and there's enough room
            if (nextBc && bc.root !== nextBc.root && duration >= 2) {
                
                // Usually 1 measure = 4 beats, 2 measures = 8 beats.
                // We want passing chords mostly on the 4th, 8th, 16th measure of a section.
                const isEndOf4BarPhrase = (bc.endBeat % 16 === 0);
                const isEndOf2BarPhrase = (bc.endBeat % 8 === 0) && !isEndOf4BarPhrase;
                
                // Base probability is extremely low to keep it special
                let prob = passingProb * 0.05;
                if (isEndOf4BarPhrase) prob = passingProb * 0.9;
                else if (isEndOf2BarPhrase) prob = passingProb * 0.4;

                if (PRNGManager.nextFloat(0, 1) < prob) {
                    // Decide passing chord duration:
                    // 1 beat, 2 beats, or a short syncopated "push" (0.5 beats before the next chord)
                    let passingDur = 1.0;
                    const durType = PRNGManager.nextFloat(0, 1);
                    if (duration >= 4 && durType > 0.8) {
                        passingDur = 2.0; // Half measure
                    } else if (durType < 0.3) {
                        passingDur = 0.5; // Short syncopated eighth-note pickup
                    }

                    const splitPoint = bc.endBeat - passingDur;

                    result.push({ 
                        ...bc,
                        endBeat: splitPoint
                    });
                    
                    // Determine passing chord type:
                    // 1. Diatonic Step (e.g., vi -> v -> IV)
                    // 2. Chromatic Approach (half step above/below target root)
                    // 3. Diminished 7th Approach (viio7 / target)
                    
                    const pType = PRNGManager.nextFloat(0, 1);
                    let passingRoot = bc.root;
                    let passingQuality = bc.quality;
                    let numeral = 'pass';
                    let bassOverride = undefined;

                    if (pType < 0.4) {
                        // Diatonic Step
                        let diff = nextBc.root - bc.root;
                        if (diff < -6) diff += 12;
                        if (diff > 6) diff -= 12;

                        const dir = Math.sign(diff); 
                        let currentScaleIdx = scalePcs.indexOf((bc.root) % 12);
                        
                        if (currentScaleIdx !== -1) {
                            let passIdx = (currentScaleIdx + dir + scalePcs.length) % scalePcs.length;
                            passingRoot = scalePcs[passIdx];
                            
                            // Map passing root to diatonic quality
                            if (context.tonality === Tonality.Major) {
                                if (passIdx === 0 || passIdx === 3 || passIdx === 4) passingQuality = ChordQualityEnum.Major;
                                else if (passIdx === 1 || passIdx === 2 || passIdx === 5) passingQuality = ChordQualityEnum.Minor;
                                else passingQuality = ChordQualityEnum.Diminished;
                            } else {
                                // Minor loosely
                                if (passIdx === 0 || passIdx === 3 || passIdx === 4) passingQuality = ChordQualityEnum.Minor;
                                else if (passIdx === 2 || passIdx === 5 || passIdx === 6) passingQuality = ChordQualityEnum.Major;
                                else passingQuality = ChordQualityEnum.Diminished;
                            }
                        } else {
                            passingRoot = (bc.root + dir * 2 + 12) % 12;
                            passingQuality = bc.quality;
                        }
                        numeral = 'pass(diatonic)';
                        
                    } else if (pType < 0.7) {
                        // Chromatic Approach (sliding into the next chord)
                        const approachDir = PRNGManager.nextFloat(0, 1) > 0.5 ? 1 : -1;
                        passingRoot = (nextBc.root - approachDir + 12) % 12;
                        
                        if (approachDir === -1) {
                            // Approach from a half-step ABOVE -> Tritone substitution (SubV7)
                            passingQuality = ChordQualityEnum.Dominant7;
                            numeral = 'subV7/next';
                        } else {
                            // Approach from a half-step BELOW -> commonly viio7 or secondary dominant
                            passingQuality = ChordQualityEnum.Diminished7;
                            numeral = 'viio7/next';
                        }
                    } else {
                        // Diminished Passing Chord
                        // A diminished 7th chord a half step below the target root is very common in Jazz/R&B/Gospel
                        passingRoot = (nextBc.root - 1 + 12) % 12;
                        passingQuality = ChordQualityEnum.Diminished7;
                        numeral = 'viio7/next';
                        
                        // Sometimes bass plays the root of the diminished
                        bassOverride = passingRoot;
                    }

                    result.push({ 
                        numeral, 
                        root: passingRoot, 
                        quality: passingQuality, 
                        startBeat: splitPoint, 
                        endBeat: bc.endBeat, 
                        keyOffset: context.keyOffset,
                        bassOverride
                    });
                    
                    continue; // Skip pushing the original chord
                }
            }
            
            result.push(bc);
        }

        return result;
    }
}
\n```\n\n### File: `${file}`
**Description**: Base class for accompaniment styles.
\n```${lang}\nimport { NoteData, GeneratedChord, SectionMetadata, GrooveDNA, ContourType, PianoMotifDNA, LHRole, RHRole, MusicContext, Tonality, ChordQuality, RoleType } from '../types';
import { MusicTheory, ChordQualityEnum } from '../theory/MusicTheory';
import { PRNGManager } from '../../utils/PRNG';
import { LickDictionary } from './LickDictionary';

export class RhythmSectionIdiom {
    public static generateAccompaniment(chords: GeneratedChord[], sections: SectionMetadata[], grooveDNA: GrooveDNA, context: MusicContext): { pianoLH: NoteData[]; pianoRH: NoteData[] } {
        const pianoLH: NoteData[] = [];
        const pianoRH: NoteData[] = [];
        
        let currentVoicing: number[] = [];
        let prevTopNote = -1;
        let consecutivePlays = 0; // Anti-typewriter mechanism

        // Attempt to extract personas from band configuration
        const accompMusician = context.band?.find(m => m.role === RoleType.AccompInst);
        const bassMusician = context.band?.find(m => m.role === RoleType.Bass);
        
        const accompPersona = accompMusician?.persona || { colorBias: 0.5, sparsityTendency: 0.5, contourPreference: ContourType.Alternating, syncopationAssault: 0.5, dynamicRange: [40, 100] };
        const bassPersona = bassMusician?.persona || { colorBias: 0.1, sparsityTendency: 0.5, contourPreference: ContourType.Alternating, syncopationAssault: 0.5, dynamicRange: [40, 100] };

        // Map Accomp Persona to RH DNA
        let rhRole = RHRole.Sparse;
        const busyLevel = 1.0 - accompPersona.sparsityTendency;
        if (busyLevel > 0.7) rhRole = RHRole.Linear;
        else if (accompPersona.syncopationAssault > 0.8) rhRole = RHRole.Comp;
        else if (busyLevel < 0.3) rhRole = RHRole.Block;
        else if (accompPersona.syncopationAssault > 0.6) rhRole = RHRole.Arp;

        // Map Bass Persona to LH DNA
        let lhRole = LHRole.Anchor;
        const bassBusyLevel = 1.0 - bassPersona.sparsityTendency;
        if (bassBusyLevel > 0.7 && bassPersona.syncopationAssault > 0.4) lhRole = LHRole.Walking;
        else if (bassPersona.syncopationAssault > 0.7 && bassBusyLevel > 0.5) lhRole = LHRole.Stride;
        else if (bassBusyLevel > 0.6) lhRole = LHRole.Comp;
        else if (bassBusyLevel > 0.8) lhRole = LHRole.Arp;

        const dna: PianoMotifDNA = {
            voicingPreference: accompPersona.colorBias, // 0 = close triads, 1 = wide extensions
            rhythmicAnchor: accompPersona.syncopationAssault, // 0 = on-beat, 1 = syncopated
            contour: accompPersona.contourPreference,
            densityBaseline: busyLevel,
            lhRole: lhRole,
            rhRole: rhRole,
            interlock: accompPersona.syncopationAssault > 0.5 ? 0.8 : 0.2 // High syncopation pushes hocketing
        };

        for (let ci = 0; ci < chords.length; ci++) {
            const chord = chords[ci];
            
            let currentSection = sections[0];
            let energy = 5;
            for (let i = 0; i < sections.length; i++) {
                if (chord.startBeat >= sections[i].startBeat - 0.001 && chord.startBeat < sections[i].endBeat - 0.001) { 
                    currentSection = sections[i];
                    energy = sections[i].energyLevel; 
                    break; 
                }
            }

            // Level 2: Section-level Evolution (Transformation Matrix)
            // As energy rises, we don't change the theme, we just multiply/scale the DNA parameters
            const normalizedEnergy = Math.max(0.1, energy / 10);
            
            // Mutated DNA for this section
            const sectionDensity = Math.min(1.0, dna.densityBaseline * (0.5 + normalizedEnergy));
            const sectionVoicingSpan = dna.voicingPreference + (normalizedEnergy - 0.5) * 0.5; // High energy expands voicing
            const sectionSyncopationTendency = Math.min(1.0, dna.rhythmicAnchor * (1.0 + normalizedEnergy * 0.5));

            const intervals = MusicTheory.getChordTones(chord.quality);
            const isAdvanced = intervals.length >= 4;
            
            let corePitches: number[] = [];
            let extPitches: number[] = [];
            for (let j = 0; j < intervals.length; j++) {
                // Rootless for RH if advanced
                if (isAdvanced && intervals[j] === 0) continue; 

                // Limit extensions based on tensionLimits
                let degree = (j * 2) + 1;
                if (context.style?.tensionLimits !== undefined && degree > context.style.tensionLimits) {
                    continue; 
                }
                
                let pitch = chord.root + intervals[j];
                if (intervals[j] < 12 && corePitches.length < 4) {
                    corePitches.push(pitch);
                } else {
                    extPitches.push(pitch);
                }
            }
            if (corePitches.length === 0) corePitches.push(chord.root);

            // Calculate Target Voicing (Voice Leading)
            let prevCenter = 0;
            if (currentVoicing.length > 0) {
                prevCenter = currentVoicing.reduce((a, b) => a + b, 0) / currentVoicing.length;
            }

            let bestVoicing: number[] = [];
            let bestDist = Infinity;
            let bestOct = 0;

            for (let inv = 0; inv < corePitches.length; inv++) {
                let invCore = [...corePitches];
                for (let i = 0; i < inv; i++) {
                    invCore[i] += 12;
                }
                invCore.sort((a,b) => a - b);
                
                for (let oct = -1; oct <= 1; oct++) {
                    let candidate = invCore.map(p => p + (oct * 12));
                    let center = candidate.reduce((a,b) => a + b, 0) / candidate.length;
                    let dist = Math.abs(center - prevCenter) + Math.abs(center) * 0.1;
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestVoicing = candidate;
                        bestOct = oct;
                    }
                }
            }

            let outVoicing = [...bestVoicing];
            for (let ext of extPitches) {
                let target = ext + (bestOct * 12);
                while (target <= outVoicing[outVoicing.length - 1]) target += 12;
                outVoicing.push(target);
            }

            const rawVoicing = outVoicing.sort((a, b) => a - b);
            currentVoicing = sectionVoicingSpan > 0.6 ? MusicTheory.getDrop2Voicing(rawVoicing) : rawVoicing;
            let rhVoicing = [...currentVoicing];

            const actualBassPc = chord.bassOverride !== undefined ? chord.bassOverride : chord.root;
            const bassPitch = actualBassPc - 24;

            // --- 新增：为大师级左手准备高级音程库 (Shell Voicing Intervals) ---
            const thirdExt = intervals.find(i => i === 3 || i === 4) || 4; // 大/小三度
            const fifthExt = intervals.find(i => i === 6 || i === 7 || i === 8) || 7;
            const seventhExt = intervals.find(i => i === 10 || i === 11) || 0; // 大/小七度

            let currentBeat = chord.startBeat;
            let lastLhIdx = -1;
            let lastRhStartIdx = -1;
            let lastRhCount = 0;

            let beatWithinChord = 0;
            
            // 🌟 【新增】：深沉低音记忆锁，防止左手像打桩机一样在一个和弦里重复砸根音
            let lhPlayedDeepRootThisChord = false; 

            // 🌟 【新增】：80/20 法则 (Persona Injection) 
            // 如果在此触发了乐手的特殊习惯 (Signature Licks)，则替换常规物理引擎推演
            const isSignaturePhrase = (accompPersona.signatureLickProb && PRNGManager.nextFloat(0, 1) < accompPersona.signatureLickProb);
            
            if (isSignaturePhrase) {
                // =========================================================
                // 【20% 乐手独有演绎】：查字典调用 Lick，并智能吸附到当前和弦
                // =========================================================
                const lick = LickDictionary.getRandomLick();
                const chordScale = [...corePitches, ...extPitches]; // 当前和弦合法的色彩音池
                
                lick.lh.forEach(note => {
                    const onset = currentBeat + note.offset;
                    if (onset < chord.endBeat) {
                        let rawPitch = bassPitch + 24 + note.pitchOffset;
                        // 🌟 修复：左手强制吸附到和弦内音，防止大小三度打架
                        let smartPitch = MusicTheory.snapToPool(rawPitch, corePitches);
                        let vel = note.velocity * 0.65; // 将字典里的“死”力度整体拉弱，保持优雅
                        pianoLH.push({ pitch: smartPitch, onset: onset, duration: note.duration, velocity: vel });
                    }
                });

                lick.rh.forEach(note => {
                    const onset = currentBeat + note.offset;
                    if (onset < chord.endBeat) {
                        let rawPitch = bassPitch + 24 + note.pitchOffset;
                        // 🌟 修复：右手吸附到包含延伸音的爵士音阶
                        let smartPitch = MusicTheory.snapToPool(rawPitch, chordScale);
                        let vel = note.velocity * 0.65;
                        if (smartPitch > 72) vel *= Math.max(0.6, 1.0 - (smartPitch - 72) * 0.015);
                        pianoRH.push({ pitch: smartPitch, onset: onset, duration: note.duration, velocity: vel });
                        prevTopNote = smartPitch; // 记录音高，为后面的 Solo 做平滑过渡
                    }
                });
                
                currentBeat += lick.durationBeats;
                if (currentBeat > chord.endBeat) currentBeat = chord.endBeat;

            } else {
                // =========================================================
                // 【80% 共性 / 基础框架演绎】：使用下面的微观物理约束求解器
                // =========================================================
                // Level 3: Microscopic Rendering - Physics Constraint Solver
                while (currentBeat < chord.endBeat - 0.001) {
                const relativeBeat = currentBeat % 4;
                
                // =========================================================
                // 🌟 1. 宏观建筑学：幽灵主唱遮罩 (Phantom Vocal Mask)
                // =========================================================
                const absoluteMeasure = Math.floor(currentBeat / 4);
                const barWithinPhrase = absoluteMeasure % 4; // 0, 1, 2, 3

                let phantomVocalActive = false;
                let isFillZone = false; 

                // 铺设 4 小节的伴奏剧本
                if (barWithinPhrase === 0 || barWithinPhrase === 1) {
                    phantomVocalActive = true; // 第 1、2 小节：主唱主场，钢琴必须让路
                } else if (barWithinPhrase === 2) {
                    phantomVocalActive = false; // 第 3 小节：主唱喘息，适合切分呼应
                } else if (barWithinPhrase === 3) {
                    if (relativeBeat >= 2.0) isFillZone = true; // 第 4 小节后半段：大过门加花区！
                }

                // 🌟 2. 动机锁定 (Motif Locking) 替代 纯随机
                // 真正的律动不是靠 nextFloat 掷骰子，而是严格咬死底鼓的律动锚点
                const isMotifAnchor = grooveDNA.anchors.some(a => Math.abs(a - relativeBeat) < 0.05);

                // 动态修正当前的密度和右手角色
                let currentRHRole = dna.rhRole; 
                let dynamicDensity = sectionDensity;

                if (phantomVocalActive) {
                    dynamicDensity *= 0.3; // 歌手发声时，极其严厉地削减伴奏密度
                    if (currentRHRole === RHRole.Linear || currentRHRole === RHRole.Arp) {
                        currentRHRole = RHRole.Block; // 强制降级为长音柱式铺底
                    }
                }
                if (isFillZone && normalizedEnergy > 0.4) {
                    currentRHRole = RHRole.Linear; // 句尾强制切为华丽跑动
                    dynamicDensity = 1.0;
                }

                // Advanced step sizing: default to 16th notes for maximum resolution
                let stepDur = 0.25; 
                
                if (currentBeat + stepDur > chord.endBeat) {
                    stepDur = chord.endBeat - currentBeat;
                }
                if (stepDur < 0.05) stepDur = 0.25; // failsafe

                const isChordStart = Math.abs(currentBeat - chord.startBeat) < 0.01;
                const isWeakBeat = Math.abs(relativeBeat % 1) > 0.05;
                const isOffBeat16th = Math.abs(relativeBeat % 0.5) > 0.05;
                const isGrooveAnchor = isMotifAnchor; // 统一锚点逻辑

                // 探测抢拍 (Push / Anticipation) 与过渡
                const timeToNextChord = chord.endBeat - currentBeat;
                // 如果距离下一个和弦 <= 0.5 拍，且当前是弱拍，视为“抢拍点”
                const isAnticipation = timeToNextChord > 0 && timeToNextChord <= 0.5 && isOffBeat16th;

                // --- 3. 约束求解器打分 (The Masked Solver) ---
                let playScoreLH = 0;
                let playScoreRH = 0;
                let isRestRH = false;
                let isRestLH = false;

                if (isGrooveAnchor) { 
                    playScoreRH += 30; // 🌟 律动主导权完全交给右手！
                    if (!phantomVocalActive && (dna.lhRole === LHRole.Comp || dna.lhRole === LHRole.Stride)) {
                        playScoreLH += 10; // 左手只做极其轻微的响应，废除30分无脑重砸
                    }
                }

                if (isFillZone) {
                    // 【情境 A：主唱换气，右手疯狂加花】
                    playScoreRH += 50; 
                    if (isOffBeat16th) playScoreRH += 20; 
                    playScoreLH -= 80; // 🌟 绝对避让：右手秀操作时，左手彻底闭嘴，严防低频浑浊！
                } 
                else if (phantomVocalActive) {
                    // 【情境 B：主唱正在开口，铺底期】
                    if (isChordStart) {
                        playScoreRH += 45; 
                        playScoreLH += 80; // 强拍稳稳砸下定海神针
                    } else if (!isMotifAnchor) {
                        playScoreRH -= 100; 
                        playScoreLH -= 100; 
                    } else {
                        if (PRNGManager.nextFloat(0,1) > dynamicDensity) playScoreRH -= 50;
                        playScoreLH -= 80; // 人声演唱期间，严禁左手在弱拍乱弹碎音
                    }
                } 
                else {
                    // 【情境 C：正常律动呼应】
                    if (isMotifAnchor) playScoreRH += 30;
                    if (isOffBeat16th && PRNGManager.nextFloat(0, 1) < dynamicDensity) playScoreRH += 15;
                }

                // 🌟 确保每个和弦有左手骨架支撑
                if (isChordStart || (relativeBeat === 0 && !lhPlayedDeepRootThisChord)) {
                    playScoreLH += 60; 
                } else if (relativeBeat === 2 && !phantomVocalActive) {
                    playScoreLH += 15; 
                    if (dna.lhRole === LHRole.Anchor) playScoreLH += 20;
                }

                // LH penalty on offbeats unless comping or arpeggiating
                if (isOffBeat16th && (dna.lhRole === LHRole.Anchor || dna.lhRole === LHRole.Stride)) {
                    playScoreLH -= 40;
                }
                
                // Walking bass wants to play on every quarter note (and sometimes skip/syncopate eighths)
                if (dna.lhRole === LHRole.Walking) {
                    if (isWeakBeat) playScoreLH += 40; // Play on 2 and 4!
                    if (relativeBeat % 1 === 0) playScoreLH += 50; // Play on 1 and 3!
                    if (isOffBeat16th) {
                        if (PRNGManager.nextFloat(0, 1) > 0.7) playScoreLH += 20; // occassional ghost eighths
                        else playScoreLH -= 50;
                    }
                }

                // 大师级节奏灵魂：奖励提前抢拍 (Push Beat)
                if (isAnticipation && sectionSyncopationTendency > 0.4 && !phantomVocalActive) {
                    playScoreLH += 50 * sectionSyncopationTendency; // 左手主动引导滑向下一个和弦
                    playScoreRH += 30 * sectionSyncopationTendency;
                }

                // 🌟 左右手智能互锁 (Hocketing)：避免齐奏硬砸，形成一问一答的 Call & Response
                if (dna.interlock > 0.4 && !isChordStart && !isAnticipation) {
                    if (playScoreRH > playScoreLH) {
                        playScoreLH -= 30 * dna.interlock; // 右手想表现，左手就安静退让
                    } else if (playScoreLH > playScoreRH) {
                        playScoreRH -= 30 * dna.interlock; 
                    }
                }

                if (currentRHRole === RHRole.Sparse) playScoreRH -= 15;

                // 5. Anti-Typewriter Fatigue & State Memory
                if (consecutivePlays >= 3 && currentRHRole !== RHRole.Linear) {
                    playScoreRH -= Math.pow(consecutivePlays, 2) * 10;
                } else if (consecutivePlays === 0 && !isChordStart && !phantomVocalActive) {
                    playScoreRH += dynamicDensity * 15;
                }

                // Decision Threshold
                const thresholdRH = 25 - (normalizedEnergy * 10); 
                const thresholdLH = 30 - (normalizedEnergy * 10); 
                
                let fireLH = playScoreLH > thresholdLH;
                let fireRH = playScoreRH > thresholdRH;

                if (fireRH) consecutivePlays++;
                else {
                    isRestRH = true;
                    consecutivePlays = 0;
                }
                
                if (!fireLH) isRestLH = true;

                // --- Rendering (Humanization & Dynamics) --- //
                // Phrase Breathing: long sine wave across measures for push/pull dynamics
                const phraseSwell = Math.sin((currentBeat / 8) * Math.PI) * 0.15 + 0.85; 
                let rhythmVel = isWeakBeat ? 0.45 : 0.65;
                if (isGrooveAnchor) rhythmVel += 0.10;
                rhythmVel = Math.min(0.9, rhythmVel * (0.7 + normalizedEnergy * 0.25)) * phraseSwell;

                // Micro-timing offset to simulate human imperfection
                const timingOffset = PRNGManager.nextFloat(-0.015, 0.015);

                // Left Hand
                if (fireLH) {
                    let lhPitches: number[] = [];
                    let lhDurations: number[] = [];
                    
                    // 🌟 核心判断：这次发声，是奠定和弦基调的“重低音首击”吗？
                    const isPrimaryBassHit = (isChordStart || isAnticipation || !lhPlayedDeepRootThisChord);

                    // 1. 半音经过音 (Chromatic Approach) - 极具爵士/R&B色彩的滑音
                    if (isAnticipation && timeToNextChord <= stepDur * 1.5 && timeToNextChord > 0 && ci < chords.length - 1 && normalizedEnergy > 0.4 && lhPlayedDeepRootThisChord) {
                        let nextBassPc = chords[ci+1].bassOverride !== undefined ? chords[ci+1].bassOverride : chords[ci+1].root;
                        let nextBassPitch = nextBassPc - 24;
                        lhPitches.push(nextBassPitch > bassPitch ? nextBassPitch - 1 : nextBassPitch + 1);
                        lhDurations.push(stepDur * 0.8);
                    } 
                    // 2. 钢琴大师语态 (Root & Tenor Bounce Split)
                    else {
                        if (dna.lhRole === LHRole.Arp && !isPrimaryBassHit) {
                            // 流动琶音：绝不再碰底音根音，走 5-10-5 波浪
                            let elapsedBeats = currentBeat - chord.startBeat;
                            let step = Math.floor(elapsedBeats / 0.5) % 4;
                            if (step === 1 || step === 3) lhPitches.push(bassPitch + fifthExt);
                            else if (step === 2) lhPitches.push(bassPitch + 12 + thirdExt); // 十度登顶极其优美
                            else lhPitches.push(bassPitch + 12); // 回落到高八度
                            lhDurations.push(stepDur * 1.8);
                        } 
                        else if (dna.lhRole === LHRole.Walking && !isPrimaryBassHit) {
                            // 3. Boogie/Walking Bass: Drive the rhythm with moving bass lines
                            let timeInBeat = (currentBeat - chord.startBeat);
                            let quarterStep = Math.floor(timeInBeat) % 4; // 0, 1, 2, 3
                            
                            let pattern = [bassPitch, bassPitch + thirdExt, bassPitch + fifthExt, bassPitch + 12];
                            // Mix it up slightly with 6ths or dom 7ths
                            if (seventhExt) pattern[3] = bassPitch + seventhExt;
                            
                            // To make it more natural, sometimes walk down
                            if (PRNGManager.nextFloat(0,1) > 0.8) {
                                pattern = [bassPitch, bassPitch + fifthExt, bassPitch + thirdExt, bassPitch];
                            }
                            
                            let noteP = pattern[quarterStep % pattern.length];
                            
                            // Ghost notes on offbeats or anticipations
                            if (isOffBeat16th || isAnticipation) {
                                noteP = pattern[(quarterStep + 1) % pattern.length];
                            }

                            lhPitches.push(noteP);
                            lhDurations.push(stepDur * 0.9);
                        }
                        else if (isPrimaryBassHit) {
                            // ==========================================
                            // 【贝斯手】：换和弦的第一击，砸下深沉的低音基石！
                            // ==========================================
                            lhPitches.push(bassPitch); // 极低频根音
                            if (normalizedEnergy > 0.7) lhPitches.push(bassPitch - 12); // 高潮加八度
                            
                            // 铺开宽广的声部 (1-5 或 1-10)
                            if (dna.lhRole === LHRole.Anchor || normalizedEnergy > 0.5) {
                                if (seventhExt && PRNGManager.nextFloat(0,1) > 0.5) lhPitches.push(bassPitch + 12 + seventhExt);
                                else lhPitches.push(bassPitch + 12 + thirdExt); 
                            }
                            
                            lhDurations.push(Math.max(2.0, timeToNextChord > 0 ? timeToNextChord : 4.0)); // 死死踩住延音踏板
                            lhPlayedDeepRootThisChord = true; // 🔒 锁定记忆：本和弦内，不准再砸重低音！
                        } 
                        else {
                            // ==========================================
                            // 【吉他手/律动大师】：弱拍的律动呼应 (Rootless Tenor Bounce)
                            // ==========================================
                            // 绝对不碰笨重的 bassPitch！手抬高到次中音区弹极其轻巧的壳和弦
                            let tenorBase = bassPitch + 12; 
                            
                            if (dna.lhRole === LHRole.Stride || dna.lhRole === LHRole.Comp) {
                                // 🌟 核心修复：如果右手去跑单音 Solo 了，左手必须接管复杂的爵士色彩和弦！
                                if (currentRHRole === RHRole.Linear || currentRHRole === RHRole.Arp) {
                                    // 提取算好的华丽声部（包含了 9/11/13 音），降八度作为左手无根音伴奏 (Rootless Voicing)
                                    let shellNotes = rhVoicing.map(p => p - 12);
                                    // 过滤掉太低的音防止浑浊，保留上方 3 个色彩音
                                    shellNotes = shellNotes.filter(p => p > bassPitch + 5).slice(-3);
                                    
                                    if (shellNotes.length > 0) {
                                        lhPitches.push(...shellNotes);
                                    } else {
                                        if (thirdExt) lhPitches.push(tenorBase + thirdExt);
                                        if (seventhExt) lhPitches.push(tenorBase + seventhExt);
                                    }
                                    lhDurations.push(stepDur * 1.5);
                                } else {
                                    // 右手在弹和弦，左手正常弹壳和弦
                                    if (thirdExt) lhPitches.push(tenorBase + thirdExt);
                                    if (seventhExt && PRNGManager.nextFloat(0,1) > 0.3) lhPitches.push(tenorBase + seventhExt);
                                    if (lhPitches.length === 0) lhPitches.push(tenorBase + fifthExt);
                                    lhDurations.push(stepDur * 1.2); 
                                }
                            }
                        }
                    }

                    // 3. 真实物理与微观触键渲染 (Ghost Notes 动态魔法)
                    for (let i = 0; i < lhPitches.length; i++) {
                        let strumOffset = (lhPitches.length > 1) ? i * PRNGManager.nextFloat(0.015, 0.03) : 0;
                        
                        let baseLhVel = rhythmVel * 0.65; // 左手基础力度要明显弱于右手
                        let noteVel = baseLhVel * PRNGManager.nextFloat(0.9, 1.05);
                        
                        if (i > 0) noteVel *= 0.55; // 减弱内声部，防止盖过右手旋律
                        
                        if (isPrimaryBassHit) {
                            noteVel *= 1.05; // 第一下强拍地基，扎实沉稳不过度
                        } else if (isAnticipation) {
                            noteVel *= 0.85; // 经过音
                        } else {
                            // 幽灵音 (Ghost Notes)
                            noteVel *= 0.55; 
                        }

                        if (lhPitches[i] !== undefined) {
                            pianoLH.push({
                                pitch: lhPitches[i],
                                onset: currentBeat + timingOffset + strumOffset,
                                duration: lhDurations[i] || stepDur,
                                velocity: Math.max(0, Math.min(1, noteVel))
                            });
                        }
                    }
                } else if (isRestLH) {
                    // 延音已交由 isPrimaryBassHit 的长 duration 接管，直接静默即可
                }

                // Right Hand & True Contour Resolution
                if (fireRH) {
                    lastRhStartIdx = pianoRH.length;
                    lastRhCount = 0;
                    
                    let availableNotes = [...rhVoicing];
                    let selectedNotes: number[] = [];
                    
                    if (currentRHRole === RHRole.Block || currentRHRole === RHRole.Comp) {
                        selectedNotes = availableNotes;
                        
                        // Thin out the block chord if low energy, BUT NOT for Comp (which preserves jazz extensions)
                        if (currentRHRole === RHRole.Block && normalizedEnergy < 0.4 && selectedNotes.length > 2) {
                            selectedNotes = [selectedNotes[0], selectedNotes[selectedNotes.length - 1]];
                        }
                    } else if (currentRHRole === RHRole.Linear) {
                        // 🌟 修复：真正的爵士单音线条 (Bebop Runs)
                        if (prevTopNote !== -1 && PRNGManager.nextFloat(0, 1) < 0.75) {
                            let dir = PRNGManager.nextFloat(0, 1) > 0.5 ? 1 : -1;
                            let target = prevTopNote;
                            // 倾向于级进 (Stepwise motion)
                            target += dir * (PRNGManager.nextFloat(0,1) > 0.6 ? 2 : 1);
                            
                            // 🌟 核心修复：吸附到当前和弦的延伸音池，绝不使用全局大调！
                            let chordScalePcs = [...corePitches, ...extPitches];
                            target = MusicTheory.snapToPool(target, chordScalePcs);
                            
                            selectedNotes = [target];
                        } else {
                            // 偶尔大跳到和弦核心音
                            const idx = Math.floor(PRNGManager.nextFloat(0, 1) * availableNotes.length);
                            selectedNotes = [availableNotes[idx]];
                        }
                    } else { // Arp or Sparse
                        // True arpeggiator state resolution
                        if (dna.contour === ContourType.Downward) {
                            const idx = Math.max(0, availableNotes.length - 1 - (beatWithinChord % availableNotes.length));
                            selectedNotes = [availableNotes[idx]];
                        } else if (dna.contour === ContourType.Upward) {
                            const idx = beatWithinChord % availableNotes.length;
                            selectedNotes = [availableNotes[idx]];
                        } else if (dna.contour === ContourType.Alternating) {
                            const pattern = [0, 2, 1, 3];
                            const idx = pattern[beatWithinChord % pattern.length] % availableNotes.length;
                            selectedNotes = [availableNotes[idx]];
                        } else {
                            const idx = Math.floor(PRNGManager.nextFloat(0, 1) * availableNotes.length);
                            selectedNotes = [availableNotes[idx]];
                        }
                        
                        // Sparse removes notes if density is low and it's not a block chord role
                        if (currentRHRole === RHRole.Sparse && selectedNotes.length > 1) {
                            selectedNotes = [selectedNotes[selectedNotes.length - 1]];
                        }
                    }

                    if (selectedNotes.length === 0) selectedNotes = [availableNotes[0]];
                    
                    // High energy adds block thickness even for arpeggios
                    if (currentRHRole !== RHRole.Block && selectedNotes.length === 1 && normalizedEnergy > 0.6 && isGrooveAnchor) {
                        selectedNotes.push(availableNotes[0]); 
                    }

                    // Humanized Strumming and Dynamics for RH
                    for (let i = 0; i < selectedNotes.length; i++) {
                        const pitch = selectedNotes[i];
                        
                        // Unison avoidance: check if LH just hit this exact pitch
                        let isUnison = false;
                        for (let l = Math.max(0, pianoLH.length - 3); l < pianoLH.length; l++) {
                             if (Math.abs(pianoLH[l].onset - (currentBeat + timingOffset)) < 0.05 && pianoLH[l].pitch === pitch) {
                                  isUnison = true; break;
                             }
                        }
                        if (isUnison) continue; // Drop the RH note to avoid double triggering
                        
                        // Slightly stagger notes in block chords (like a real hand rolling the chord)
                        let strumOffset = (selectedNotes.length > 1) ? i * PRNGManager.nextFloat(0.005, 0.012) : 0;
                        
                        // 伴奏钢琴不需要极其突出的“主旋律音”，而是追求整体的和弦色彩融合
                        // 特别是在爵士乐中，过亮的最高音会破坏和弦的暗色调张力
                        let topNoteMultiplier = (i === selectedNotes.length - 1 && selectedNotes.length > 1) ? 0.85 : 
                                                (i === 0 && selectedNotes.length > 2) ? 0.85 : 0.80; 

                        // 移除无脑的 * 1.1 全局提亮，使用更平缓的 Base Velocity
                        let rhVel = rhythmVel * topNoteMultiplier * PRNGManager.nextFloat(0.9, 1.05);

                        // 高音柔化：如果音高在C5(72)以上，线性降低力度避免刺耳
                        if (pitch > 72) {
                            rhVel *= Math.max(0.6, 1.0 - (pitch - 72) * 0.015);
                        }
                        
                        // --- 4. 智能延音踏板 (Smart Sustain) ---
                        let rhDur = stepDur * (energy > 5 ? 1.2 : 0.9);
                        if (!isFillZone && (isChordStart || relativeBeat === 0)) {
                            // 【大师级留白】：只要不是加花区，落下强拍和弦后，立刻踩死延音踏板，撑满整个呼吸间隙！
                            if (currentRHRole === RHRole.Sparse || currentRHRole === RHRole.Block) {
                                rhDur = Math.max(2.0, Math.min(4.0, chord.endBeat - currentBeat)); 
                            }
                            // Comping should be somewhat detached (staccato)
                            if (currentRHRole === RHRole.Comp) {
                                rhDur = stepDur * 0.8;
                            }
                        } else if (isFillZone || currentRHRole === RHRole.Linear) {
                            // 副旋律跑动时，踏板收起，保证音符粒粒分明
                            rhDur = stepDur * 0.8; 
                        }

                        pianoRH.push({ 
                            pitch, 
                            onset: currentBeat + timingOffset + strumOffset, 
                            duration: rhDur, 
                            velocity: Math.max(0, Math.min(1, rhVel)) 
                        });
                        lastRhCount++;
                    }
                    if (selectedNotes.length > 0) prevTopNote = selectedNotes[selectedNotes.length - 1];

                } else if (lastRhStartIdx !== -1) {
                    // Holding logic (sustain pedal effect)
                    let sustainProb = normalizedEnergy < 0.5 ? 0.8 : 0.4;
                    if (currentRHRole === RHRole.Sparse) sustainProb = 0.9;
                    if (currentRHRole === RHRole.Linear) sustainProb = 0.2; // Runs are staccato/detached
                    if (currentRHRole === RHRole.Comp) sustainProb = 0.3; // Comping is detached/staccato
                    
                    if (PRNGManager.nextFloat(0, 1) < sustainProb) {
                        for (let i = 0; i < lastRhCount; i++) {
                            pianoRH[lastRhStartIdx + i].duration += stepDur;
                        }
                    }
                }
                
                currentBeat += stepDur;
                if (fireRH) beatWithinChord++;
            }
            } // Close the else block for isSignaturePhrase
        }
        return { pianoLH, pianoRH };
    }
}
\n```\n\n### File: `${file}`
**Description**: Determines which instrument/playing style to execute.
\n```${lang}\nimport { GeneratedChord, SectionMetadata, GrooveDNA, MusicContext, NoteData, IdiomType, RoleType, BandMusician, MusicalRole, GeneratedTrack } from '../types';
import { RhythmSectionIdiom as GenericPianoIdiom } from './BaseAccompIdiom';
import { PopPianoIdiom } from './PopPianoIdiom';
import { PianoBaseIdiom } from './PianoBaseIdiom';
import { getInstrumentConfig } from '../manifests/InstrumentRegistry';
import { Orchestrator } from '../Orchestrator';

export class IdiomDispatcher {
    public static getIdiomType(styleId: string, instrumentId: number): IdiomType {
        return IdiomType.GenericPiano;
    }

    public static generateAccompaniment(
        chords: GeneratedChord[], 
        sections: SectionMetadata[], 
        grooveDNA: GrooveDNA, 
        context: MusicContext
    ): { pianoLH: NoteData[]; pianoRH: NoteData[] } {
        return PianoBaseIdiom.generate(chords, sections, grooveDNA, context);
    }

    public static generateForMusician(
        musician: BandMusician,
        roles: MusicalRole[],
        track: GeneratedTrack,
        grooveDNA: GrooveDNA,
        context: MusicContext
    ): { melody?: NoteData[]; pianoRH?: NoteData[]; pianoLH?: NoteData[] } {
        
        // Always use PianoBaseIdiom for all for now, we can specialize later
        return PianoBaseIdiom.generateForRoles(roles, track, grooveDNA, context, musician);
    }
}

\n```\n\n### File: `${file}`
**Description**: Utilities for calculating accompaniment intervals and drops.
\n```${lang}\nimport { GeneratedChord, Tonality } from '../types';
import { MusicTheory } from '../theory/MusicTheory';

export class IdiomUtils {
    // Calculates core vs extended pitches and optimal voice leading
    public static calculateVoicing(
        chord: GeneratedChord,
        currentVoicing: number[],
        sectionVoicingSpan: number,
        tensionLimits?: number, // Limit like 7, 9, 11, 13
        allocatedTargetPcs?: number[]
    ): { rhVoicing: number[], actualBassPc: number, bassPitch: number, intervals: number[] } {
        const intervals = MusicTheory.getChordTones(chord.quality);
        const isAdvanced = intervals.length >= 4;
        
        let corePitches: number[] = [];
        let extPitches: number[] = [];
        
        if (allocatedTargetPcs && allocatedTargetPcs.length > 0) {
            // Use explicitly allocated pitches (e.g. from GlobalHarmonicFrame)
            for (const pc of allocatedTargetPcs) {
                corePitches.push(pc); // Treat all allocated pitches as core to voice-lead them
            }
        } else {
            // Fallback: Use standard chord tones and tension limits
            for (let j = 0; j < intervals.length; j++) {
                if (isAdvanced && intervals[j] === 0) continue; // Rootless 
                let pitch = chord.root + intervals[j];
                
                // Limit extensions based on tensionLimits
                // intervals.length indicates degree (e.g., 0=root,1=3rd,2=5th,3=7th,4=9th, etc.)
                let degree = (j * 2) + 1; // approx representation
                if (tensionLimits !== undefined && degree > tensionLimits) {
                    continue; // strip off high tensions if Style says no
                }

                if (intervals[j] < 12 && corePitches.length < 4) {
                    corePitches.push(pitch);
                } else {
                    extPitches.push(pitch);
                }
            }
            if (corePitches.length === 0) corePitches.push(chord.root);
        }

        // Make all pitches positive module 12
        corePitches = corePitches.map(p => {
            while(p < 0) p += 12;
            return p % 12;
        });
        
        // Remove duplicates
        corePitches = Array.from(new Set(corePitches));

        let prevCenter = 0;
        if (currentVoicing.length > 0) {
            prevCenter = currentVoicing.reduce((a, b) => a + b, 0) / currentVoicing.length;
        }

        let bestVoicing: number[] = [];
        let bestDist = Infinity;
        let bestOct = 0;

        for (let inv = 0; inv < corePitches.length; inv++) {
            let invCore = [...corePitches];
            for (let i = 0; i < inv; i++) {
                invCore[i] += 12;
            }
            invCore.sort((a,b) => a - b);
            
            let penalty = 0;
            if (invCore.length > 1 && (invCore[1] - invCore[0] <= 2)) penalty = 12; // High penalty for minor/major 2nd at the bottom
            
            for (let oct = -1; oct <= 1; oct++) {
                let candidate = invCore.map(p => p + (oct * 12));
                let center = candidate.reduce((a,b) => a + b, 0) / candidate.length;
                let dist = Math.abs(center - prevCenter) + Math.abs(center) * 0.1 + penalty;
                if (dist < bestDist) {
                    bestDist = dist;
                    bestVoicing = candidate;
                    bestOct = oct;
                }
            }
        }

        let outVoicing = [...bestVoicing];
        for (let ext of extPitches) {
            let target = ext + (bestOct * 12);
            while (target < outVoicing[0] + 3) target += 12; // Avoid muddying bass
            while (target > outVoicing[0] + 16) target -= 12; // Keep compact
            outVoicing.push(target);
            outVoicing.sort((a, b) => a - b);
        }

        const rawVoicing = outVoicing;
        let finalVoicing = sectionVoicingSpan > 0.6 && rawVoicing.length <= 4 ? MusicTheory.getDrop2Voicing(rawVoicing) : rawVoicing;

        const actualBassPc = chord.bassOverride !== undefined ? chord.bassOverride : chord.root;
        const bassPitch = actualBassPc - 24;

        return { rhVoicing: finalVoicing, actualBassPc, bassPitch, intervals };
    }
}
\n```\n\n### File: `${file}`
**Description**: Hardcoded stylistic licks mapped to rhythmic positions.
\n```${lang}\nimport { NoteData } from '../types';
import { PRNGManager } from '../../utils/PRNG';

export interface Lick {
    name: string;
    durationBeats: number;
    // offsets are relative to chord start, pitches are relative to chord root (0 = root)
    lh: { offset: number, duration: number, pitchOffset: number, velocity: number }[];
    rh: { offset: number, duration: number, pitchOffset: number, velocity: number }[];
}

export class LickDictionary {
    private static licks: Lick[] = [
        {
            name: "Bebop II-V-I Run",
            durationBeats: 4,
            lh: [
                { offset: 0, duration: 1.5, pitchOffset: -12, velocity: 0.8 }, // Root
                { offset: 0, duration: 1.5, pitchOffset: 4, velocity: 0.7 },   // Third
                { offset: 0, duration: 1.5, pitchOffset: 10, velocity: 0.7 },  // Seventh
                { offset: 2.5, duration: 1, pitchOffset: 4, velocity: 0.6 },
                { offset: 2.5, duration: 1, pitchOffset: 10, velocity: 0.6 }
            ],
            rh: [
                { offset: 0.5, duration: 0.25, pitchOffset: 14, velocity: 0.9 }, // 9th
                { offset: 0.75, duration: 0.25, pitchOffset: 12, velocity: 0.8 }, // Octave
                { offset: 1.0, duration: 0.25, pitchOffset: 10, velocity: 0.85 }, // 7th
                { offset: 1.25, duration: 0.25, pitchOffset: 9, velocity: 0.8 }, // 13th
                { offset: 1.5, duration: 0.25, pitchOffset: 7, velocity: 0.9 }, // 5th
                { offset: 1.75, duration: 0.25, pitchOffset: 5, velocity: 0.75 }, // 11th
                { offset: 2.0, duration: 0.25, pitchOffset: 4, velocity: 0.85 }, // 3rd
                { offset: 2.25, duration: 0.5, pitchOffset: -1, velocity: 0.7 }, // Chromatic approach
                { offset: 2.75, duration: 1.25, pitchOffset: 0, velocity: 0.95 } // Resolve to root
            ]
        },
        {
            name: "Syncopated Latin/Jazz Comp",
            durationBeats: 2,
            lh: [
                { offset: 0, duration: 0.5, pitchOffset: -12, velocity: 0.85 }, 
                { offset: 1.5, duration: 0.5, pitchOffset: -5, velocity: 0.8 } 
            ],
            rh: [
                { offset: 0.5, duration: 0.5, pitchOffset: 4, velocity: 0.85 },
                { offset: 0.5, duration: 0.5, pitchOffset: 7, velocity: 0.85 },
                { offset: 0.5, duration: 0.5, pitchOffset: 10, velocity: 0.85 },
                { offset: 1.5, duration: 0.5, pitchOffset: 4, velocity: 0.9 },
                { offset: 1.5, duration: 0.5, pitchOffset: 7, velocity: 0.9 },
                { offset: 1.5, duration: 0.5, pitchOffset: 10, velocity: 0.9 }
            ]
        },
        {
            name: "Bluesy Double Stop Lick",
            durationBeats: 2,
            lh: [
                { offset: 0, duration: 1.5, pitchOffset: -12, velocity: 0.9 },
                { offset: 0, duration: 1.5, pitchOffset: -5, velocity: 0.8 }
            ],
            rh: [
                { offset: 0, duration: 0.25, pitchOffset: 3, velocity: 0.8 }, // Minor 3rd slide
                { offset: 0.25, duration: 0.25, pitchOffset: 4, velocity: 0.9 }, // Major 3rd
                { offset: 0.25, duration: 0.25, pitchOffset: 7, velocity: 0.9 }, 
                { offset: 0.75, duration: 0.5, pitchOffset: 10, velocity: 0.85 }, // Minor 7th
                { offset: 0.75, duration: 0.5, pitchOffset: 15, velocity: 0.85 }, 
                { offset: 1.5, duration: 0.5, pitchOffset: 12, velocity: 1.0 } // Root octave
            ]
        },
        {
            name: "Charlie Parker Style Triplet",
            durationBeats: 2,
            lh: [
                { offset: 0, duration: 1.0, pitchOffset: -12, velocity: 0.8 },
                { offset: 0, duration: 1.0, pitchOffset: 4, velocity: 0.7 },
                { offset: 0, duration: 1.0, pitchOffset: 10, velocity: 0.7 }
            ],
            rh: [
                { offset: 0, duration: 0.33, pitchOffset: 14, velocity: 0.8 },
                { offset: 0.33, duration: 0.33, pitchOffset: 12, velocity: 0.85 },
                { offset: 0.66, duration: 0.33, pitchOffset: 10, velocity: 0.8 },
                { offset: 1.0, duration: 0.5, pitchOffset: 14, velocity: 0.9 },
                { offset: 1.5, duration: 0.5, pitchOffset: 16, velocity: 0.9 }
            ]
        }
    ];

    public static getRandomLick(): Lick {
        const idx = Math.floor(PRNGManager.nextFloat(0, 1) * this.licks.length);
        return this.licks[idx];
    }
}
\n```\n\n### File: `${file}`
**Description**: Base logic for piano generation, LH/RH split.
\n```${lang}\nimport { GeneratedChord, SectionMetadata, GrooveDNA, MusicContext, NoteData, ContourType, RoleType, MusicalRole, GeneratedTrack, BandMusician } from '../types';
import { PRNGManager } from '../../utils/PRNG';
import { IdiomUtils } from './IdiomUtils';
import { MusicTheory } from '../theory/MusicTheory';
import { getInstrumentConfig } from '../manifests/InstrumentRegistry';

export class PianoBaseIdiom {
    private static findSmoothestVoicing(chord: GeneratedChord, prevVoicing: number[], tensionLimits?: number, allocatedTargetPcs?: number[]): number[] {
        const { rhVoicing } = IdiomUtils.calculateVoicing(chord, prevVoicing, 0.5, tensionLimits, allocatedTargetPcs);
        return rhVoicing;
    }

    public static generateForRoles(
        roles: MusicalRole[], 
        track: GeneratedTrack, 
        grooveDNA: GrooveDNA, 
        context: MusicContext, 
        musician: BandMusician
    ): { melody?: NoteData[]; pianoRH?: NoteData[]; pianoLH?: NoteData[] } {
        
        const hasLead = roles.includes(MusicalRole.Lead);
        const hasAccomp = roles.includes(MusicalRole.Accomp);
        const hasBass = roles.includes(MusicalRole.Bass);

        const config = getInstrumentConfig(musician.instrumentId);

        let finalLH: NoteData[] = [];
        let finalRH: NoteData[] = [];
        let finalMelody: NoteData[] = [];

        // Modes:
        // Solo Piano: Lead + Accomp + Bass
        // Band Comping: Accomp (and maybe Bass)
        // Split: Lead (no accomp)

        if (hasAccomp) {
            // Generate the full accompaniment pattern. 
            // We pass hasLead as isSoloWithLead so the LH generates wider, more self-sufficient textures.
            const { pianoLH, pianoRH } = this.generate(track.chords, track.sections, grooveDNA, context, musician, hasBass, hasLead);
            const rawLH = pianoLH.map(n => ({ ...n, pitch: n.pitch + track.keyOffset + 60 }));
            const rawRH = pianoRH.map(n => ({ ...n, pitch: n.pitch + track.keyOffset + 60 }));

            if (hasLead) {
                let srcMelody = track.melody.map(n => ({
                    ...n,
                    pitch: n.pitch + track.keyOffset + 72
                }));

                // Adjust LH accompaniment dynamics and density to breathe with the melody
                finalLH = [];
                rawLH.forEach(lhNote => {
                    const beatStart = Math.floor(lhNote.onset);
                    const melodyNotesInBeat = srcMelody.filter(m => m.onset >= beatStart && m.onset < beatStart + 1.0);
                    
                    const isDownbeat = (lhNote.onset % 1) === 0;

                    // If melody is very busy (e.g., fast runs), simplify the LH by dropping some off-beat complex notes
                    if (melodyNotesInBeat.length > 2 && !isDownbeat) {
                        if (PRNGManager.nextFloat(0, 1) < 0.7) {
                            return; // drop this LH note entirely to get out of the way
                        }
                    }

                    const overlappingMelody = srcMelody.find(m => 
                        (lhNote.onset >= m.onset - 0.15 && lhNote.onset < m.onset + m.duration) ||
                        (m.onset >= lhNote.onset - 0.15 && m.onset < lhNote.onset + lhNote.duration)
                    );

                    let vel = lhNote.velocity;
                    let pitch = lhNote.pitch;
                    
                    if (overlappingMelody) {
                        // Duck the left hand slightly when melody is active at the exact same moment
                        vel *= 0.85; 
                        // Fold down if LH somehow encroaches the melody space
                        if (pitch > overlappingMelody.pitch - 4) {
                            pitch -= 12;
                            vel *= 0.8;
                        }
                    } else if (melodyNotesInBeat.length === 0) {
                        // Gap in melody: left hand can be a bit more confident
                        vel *= 1.15;
                    }
                    
                    finalLH.push({ ...lhNote, pitch, velocity: Math.min(1.0, vel) });
                });

                // Carve out the RH accompaniment to make physical space for the melody
                rawRH.forEach(rhNote => {
                    const beatStart = Math.floor(rhNote.onset);
                    const melodyNotesInBeat = srcMelody.filter(m => m.onset >= beatStart && m.onset < beatStart + 1.0);
                    
                    const overlappingMelody = srcMelody.find(m => 
                        (rhNote.onset >= m.onset - 0.15 && rhNote.onset < m.onset + m.duration) ||
                        (m.onset >= rhNote.onset - 0.15 && m.onset < rhNote.onset + rhNote.duration)
                    );

                    // PHYSICALITY CHECK: if there is active melody in this beat, the right hand is already busy. 
                    // To prevent an impossible "three handed" piano playing, we heavily drop matching accompaniment notes.
                    if (melodyNotesInBeat.length >= 2) {
                        // Very busy melody -> drop accompaniment entirely in this beat unless it's a downbeat holding a long chord
                        if ((rhNote.onset % 1) !== 0 || rhNote.duration < 1.0) {
                            return; // DROP completely
                        }
                    }

                    if (!overlappingMelody) {
                        // Gap in melody! Keep the RH accompaniment to act as a fill / call-and-response
                        finalRH.push(rhNote);
                    } else {
                        // Melody is playing at this exact moment.
                        // We ONLY keep an accompaniment note if it acts as a lower harmony tone (a 3rd/6th below)
                        // AND happens simultaneously enough with the melody note to be struck by the remaining fingers.
                        if (Math.abs(rhNote.onset - overlappingMelody.onset) < 0.1) {
                            if (rhNote.pitch <= overlappingMelody.pitch - 3) {
                                // Keep it as a supportive chord tone
                                finalRH.push({ ...rhNote, velocity: Math.min(1.0, rhNote.velocity * 0.7) });
                            }
                        }
                        // Other accompaniment notes are simply dropped. No folding down an octave, which causes clutter.
                    }
                });

                // Add the melody into RH with optional octave doubling on strong beats
                srcMelody.forEach(n => {
                    // Normalize the melody volume to blend smoothly without popping out too aggressively
                    finalRH.push({ ...n, velocity: Math.min(1.0, n.velocity * 0.95) });
                    
                    const isDownbeat = (n.onset % 1) === 0;
                    if (isDownbeat && PRNGManager.next() > 0.6) {
                        finalRH.push({ ...n, pitch: n.pitch - 12, velocity: Math.min(1.0, n.velocity * 0.65) });
                    }
                });
            } else {
                finalRH = rawRH;
                finalLH = rawLH;
            }
        } else if (hasBass && !hasAccomp) {
            // Just bass
            const { pianoLH } = this.generate(track.chords, track.sections, grooveDNA, context, musician, true, false);
            // In generate(), if it only needs to generate LH (bass), it will still generate RH but we just ignore it.
            // Oh wait! If we do this, generate() might use a pad strategy which is weird for standalone bass.
            // But let's use it for now and extract LH.
            finalLH = pianoLH.map(n => ({ ...n, pitch: n.pitch + track.keyOffset + 60 }));
        } else if (hasLead && !hasAccomp) {
            // If it's just Lead role with NO accomp, it plays the melody channel globally
            finalMelody = track.melody.map(n => ({
                ...n,
                pitch: n.pitch + track.keyOffset + 72,
                velocity: Math.min(1.0, n.velocity * 0.9) // slightly temper independent melody
            }));
        }

        return {
            melody: finalMelody,
            pianoRH: finalRH,
            pianoLH: finalLH
        };
    }

    public static generate(
        chords: GeneratedChord[], 
        sections: SectionMetadata[], 
        grooveDNA: GrooveDNA, 
        context: MusicContext, 
        musician?: BandMusician,
        includeBass: boolean = true,
        isSoloWithLead: boolean = false
    ): { pianoLH: NoteData[]; pianoRH: NoteData[] } {
        const pianoLH: NoteData[] = [];
        const pianoRH: NoteData[] = [];
        let currentVoicing: number[] = [];

        const persona = musician?.persona || { colorBias: 0.5, sparsityTendency: 0.5, contourPreference: ContourType.Alternating, syncopationAssault: 0.3, dynamicRange: [40, 100] as [number, number] };
        
        // A core pattern type for this track's medium energy sections
        const baseMediumRhythm = PRNGManager.next() > 0.5 ? 'syncopated_comp' : 'arpeggiated_flow';
        const baseLowRhythm = PRNGManager.next() > 0.6 ? 'sustained_pad' : 'arpeggiated_flow';
        const baseHighRhythm = PRNGManager.nextFloat(0,1) > 0.6 ? 'pop_driving_8ths' : (PRNGManager.next() > 0.5 ? 'driving_arpeggios' : 'syncopated_comp');

        // State to maintain strategy across a measure
        let currentStrategy = baseLowRhythm;
        let lastStrategyUpdateBeat = -1;

        for (let ci = 0; ci < chords.length; ci++) {
            const chord = chords[ci];
            let isSectionBoundary = false;
            let currentSectionEnergy = 5;
            for (let i = 0; i < sections.length; i++) {
                if (chord.startBeat >= sections[i].startBeat - 0.001 && chord.startBeat < sections[i].endBeat - 0.001) { 
                    currentSectionEnergy = sections[i].energyLevel;
                    if (Math.abs(chord.startBeat - sections[i].startBeat) < 0.01) {
                        isSectionBoundary = true;
                    }
                    break; 
                }
            }
            const normalizedEnergy = Math.max(0.1, currentSectionEnergy / 10);

            // Pull voicing back towards center (0) at section boundaries for a stronger downbeat
            let targetVoicing = currentVoicing;
            if (isSectionBoundary && currentVoicing.length > 0) {
                const currentCenter = currentVoicing.reduce((a,b)=>a+b, 0) / currentVoicing.length;
                if (Math.abs(currentCenter) > 5) {
                    // Force findSmoothestVoicing to gravitate lower/higher by altering the passed prevVoicing
                    targetVoicing = currentVoicing.map(p => p - Math.sign(currentCenter) * 12);
                }
            }

            // Find if there is a specific frame for this chord
            const frame = context.harmonicFrames?.find(f => Math.abs(f.startBeat - chord.startBeat) < 0.01);
            let allocatedPcs: number[] | undefined = undefined;
            if (frame) {
                // Determine roles for this musician to pick their specific targets
                // If it's a standalone Piano (both Accomp and Lead), it plays both.
                // Normally this instance of PianoBaseIdiom is used for Accomp role.
                const validRoles = isSoloWithLead ? [MusicalRole.Accomp, MusicalRole.Lead] : [MusicalRole.Accomp];
                allocatedPcs = frame.toneAllocations
                    .filter(ta => validRoles.includes(ta.role))
                    .map(ta => ta.pitchClass);
            }

            currentVoicing = this.findSmoothestVoicing(chord, targetVoicing, context.style?.tensionLimits, allocatedPcs);

            let currentBeat = chord.startBeat;
            const chordDuration = chord.endBeat - chord.startBeat;
            const rhVel = (persona.dynamicRange[0] + (persona.dynamicRange[1] - persona.dynamicRange[0]) * Math.min(1.0, normalizedEnergy + 0.2)) / 127.0;
            const lhVel = rhVel * 0.9;
            const bassPitch = chord.root - (includeBass ? 24 : 12); // Less deep if bassist is carrying the low end

            // Only update strategy on downbeats of measures (or phrase boundaries) to ensure cohesion within a measure
            const measureStartBeat = Math.floor(currentBeat / 4) * 4;
            if (currentBeat === 0 || measureStartBeat > lastStrategyUpdateBeat) {
                lastStrategyUpdateBeat = measureStartBeat;

                // Calculate the measure's position within a 4-bar phrase (0, 1, 2, 3) 
                const measureInPhrase = Math.floor(currentBeat / 4) % 4;
                const isTurnaround = measureInPhrase === 3; // 4th measure often needs a fill or dropout

                // Intelligent Strategy Selection Model
                let padProb = normalizedEnergy < 0.4 ? (baseLowRhythm === 'sustained_pad' ? 0.8 : 0.3) : 0;
                let arpeggioProb = Math.max(0, 1.0 - Math.abs(normalizedEnergy - 0.5) * 2.5); // Peaks at 0.5 (Verse)
                if (normalizedEnergy < 0.4 && baseLowRhythm === 'arpeggiated_flow') arpeggioProb += 0.6;
                if (normalizedEnergy > 0.6 && baseHighRhythm === 'driving_arpeggios') arpeggioProb += 0.8;
                if (Math.abs(normalizedEnergy - 0.5) < 0.2 && baseMediumRhythm === 'arpeggiated_flow') arpeggioProb += 0.6;
                
                let compProb = arpeggioProb * (0.2 + persona.syncopationAssault); 
                if (normalizedEnergy > 0.6 && baseHighRhythm === 'syncopated_comp') compProb += 0.8;
                if (Math.abs(normalizedEnergy - 0.5) < 0.2 && baseMediumRhythm === 'syncopated_comp') compProb += 0.6;
                
                let drivingProb = Math.max(0, (normalizedEnergy - 0.5) * 2.0); // Peaks at >0.7
                if (normalizedEnergy > 0.6 && baseHighRhythm === 'pop_driving_8ths') drivingProb += 0.5;

                let syncProb = drivingProb * persona.syncopationAssault;

                // Phrase position adjustments (Turnarounds create variety)
                if (isTurnaround) {
                    if (PRNGManager.next() > 0.6) {
                        padProb += 0.8; // Dropout/breath at the end of a phrase (less aggressive to avoid completely stopping momentum)
                    } else {
                        syncProb += 0.8; // Busy fill at the end
                        drivingProb += 0.5;
                    }
                }

                // Introduce micro-randomness for human-like unpredictability
                padProb += PRNGManager.next() * 0.3;
                arpeggioProb += PRNGManager.next() * 0.4;
                compProb += PRNGManager.next() * 0.4;
                drivingProb += PRNGManager.next() * 0.3;
                syncProb += PRNGManager.next() * 0.4;

                let maxProb = padProb;
                currentStrategy = 'sustained_pad';
                
                if (arpeggioProb > maxProb) { maxProb = arpeggioProb; currentStrategy = 'arpeggiated_flow'; }
                if (compProb > maxProb) { maxProb = compProb; currentStrategy = 'syncopated_comp'; }
                if (drivingProb > maxProb) { maxProb = drivingProb; currentStrategy = 'pop_driving_8ths'; }
                if (syncProb > maxProb) { maxProb = syncProb; currentStrategy = 'funk_syncopation'; }

                let isJazz = (context.globalStyleId?.toLowerCase() || '').includes('jazz') || (context.style?.name?.toLowerCase() || '').includes('jazz') || (context.swingRatio && context.swingRatio > 0);
                if (isJazz) {
                    let walkProb = (normalizedEnergy - 0.2) * 2; // > 0.2 starts walking
                    let compingProb = (normalizedEnergy) * 1.5;
                    if (walkProb > maxProb && walkProb > compingProb) { maxProb = walkProb; currentStrategy = 'jazz_walking_bass'; }
                    else if (compingProb > maxProb) { maxProb = compingProb; currentStrategy = 'jazz_comping'; }
                }

                // Soft constraints for extreme energy contexts
                if (normalizedEnergy < 0.25 && !isTurnaround) {
                    currentStrategy = 'sustained_pad';
                }
                if (currentStrategy === 'arpeggiated_flow' && normalizedEnergy > 0.65) {
                    currentStrategy = 'driving_arpeggios';
                }
            }

            const strategy = currentStrategy;

            // Implement the chosen strategy
            if (strategy === 'sustained_pad') {
                // Low energy: Long held chords
                pianoLH.push({ pitch: bassPitch, onset: currentBeat, duration: chordDuration, velocity: lhVel });
                
                if (isSoloWithLead && chordDuration >= 2) {
                    // Play a shell voicing (e.g. Root + 3rd/7th + 10th) so the harmony isn't lost
                    // Keep them in a playable span from the bass pitch
                    const safeTones = currentVoicing.map(v => {
                        let p = v;
                        while(p < bassPitch + 4) p += 12;
                        while(p > bassPitch + 16) p -= 12;
                        return p;
                    }).sort((a,b) => a-b);
                    
                    const uniqueTones = Array.from(new Set(safeTones)).slice(0, 2); // At most 2 extra shell notes
                    
                    // Stagger the shell notes like a slow, romantic arpeggiated roll
                    let rollDelay = 0.5; // half beat later
                    uniqueTones.forEach(t => {
                        pianoLH.push({ pitch: t, onset: currentBeat + rollDelay, duration: chordDuration - rollDelay, velocity: lhVel * 0.85 });
                        rollDelay += 0.5;
                    });
                } else if (PRNGManager.next() < 0.5 && chordDuration >= 2) {
                    pianoLH.push({ pitch: bassPitch + 7, onset: currentBeat + 0.05, duration: chordDuration - 0.05, velocity: lhVel * 0.8 });
                }
                
                // RH plays block, maybe rolls it
                let rollOffset = 0;
                const isRoll = PRNGManager.next() > 0.7;
                // keep slightly fewer notes for pads to make them transparent
                for (let p of currentVoicing.slice(-Math.max(2, currentVoicing.length - 1))) {
                    pianoRH.push({ pitch: p, onset: currentBeat + rollOffset, duration: chordDuration * 0.9, velocity: rhVel * 0.75 });
                    if (isRoll) rollOffset += 0.04;
                }

                // Add a gentle rhythmic pulse halfway if it's a long chord (e.g., 4 beats)
                if (chordDuration > 2.5 && PRNGManager.next() > 0.5) {
                    const midBeat = currentBeat + chordDuration / 2;
                    for (let p of currentVoicing.slice(-2)) { // top 2 notes
                        pianoRH.push({ pitch: p, onset: midBeat, duration: (chordDuration/2) * 0.8, velocity: rhVel * 0.6 });
                    }
                }

            } else if (strategy === 'jazz_walking_bass') {
                // LH plays quarter note walking bass lines
                let b = currentBeat;
                const nextChordRoot = chords[(ci + 1) % chords.length]?.root ?? chord.root;
                let step = 0;
                
                while (b < chord.endBeat - 0.01) {
                    let pitch = bassPitch;
                    if (step === 0) pitch = bassPitch;
                    else if (step === 1) pitch = bassPitch + (PRNGManager.next() > 0.5 ? 4 : 3); // Mediant (approx)
                    else if (step === 2) pitch = bassPitch + 7; // fifth (approx)
                    else pitch = (nextChordRoot - 24) - (PRNGManager.next() > 0.5 ? 1 : -1); // chromatic approach
                    
                    if (pitch < 24) pitch += 12; // keep above very low
                    pianoLH.push({ pitch: pitch, onset: b, duration: 0.8, velocity: lhVel });
                    
                    // RH plays syncopated rootless stab occasionally (comping)
                    if (PRNGManager.next() > 0.65) {
                        for (let p of currentVoicing.slice(-Math.max(1, currentVoicing.length - 2))) {
                            pianoRH.push({ pitch: p, onset: b + 0.5, duration: 0.5, velocity: rhVel * 0.6 });
                        }
                    }
                    
                    b += 1; // Quarter notes
                    step++;
                }

            } else if (strategy === 'jazz_comping') {
                // Rootless voicings syncopated
                pianoLH.push({ pitch: bassPitch, onset: currentBeat, duration: chordDuration*0.9, velocity: lhVel * 0.7 });
                let b = currentBeat;
                while (b < chord.endBeat - 0.01) {
                    if (PRNGManager.next() > 0.3) {
                        const onset = b + (PRNGManager.next() > 0.5 ? 0.5 : 0); // offbeat
                        for (let p of currentVoicing.slice(-2)) {
                            pianoRH.push({ pitch: p, onset: onset, duration: 0.8, velocity: rhVel * (onset === b ? 0.65 : 0.55) });
                        }
                    }
                    b += 1;
                }

            } else if (strategy === 'syncopated_comp') {
                // Medium energy, rhythmic chords (comping)
                // LH anchors on the root
                pianoLH.push({ pitch: bassPitch, onset: currentBeat, duration: Math.min(2, chordDuration), velocity: lhVel });
                
                if (isSoloWithLead) {
                    // Shell comping for LH: 3rd and 7th (or similar chord tones)
                    const shellTones = currentVoicing.map(v => {
                        let p = v;
                        while(p < bassPitch + 4) p += 12;
                        while(p > bassPitch + 15) p -= 12; // cap at minor 10th
                        return p;
                    }).sort((a,b) => a-b);
                    const uniqueShellTones = Array.from(new Set(shellTones)).slice(0, 2);
                    
                    let b = currentBeat;
                    while (b < chord.endBeat - 0.01) {
                        const relativeBeat = b % 4;
                        let prob = 0;
                        if (relativeBeat === 0) prob = 0.8; 
                        else if (relativeBeat === 2) prob = 0.6; 
                        else if (relativeBeat === 1.5 || relativeBeat === 2.5) prob = 0.7; 
                        else prob = 0.2; 
    
                        prob *= (1.0 - persona.sparsityTendency * 0.5);
    
                        if (PRNGManager.next() < prob || b === currentBeat) { 
                            const dur = PRNGManager.next() > 0.5 ? 0.25 : 0.5;
                            const v = (b === currentBeat) ? (lhVel * 0.9) : (lhVel * 0.75);
                            for (let p of uniqueShellTones) {
                                pianoLH.push({ pitch: p, onset: b, duration: dur, velocity: v });
                            }
                        }
                        b += 0.5; 
                    }
                }
                
                // RH plays rhythms: downbeats, offbeats (ands)
                let b = currentBeat;
                while (b < chord.endBeat - 0.01) {
                    const relativeBeat = b % 4;
                    // Probability of hitting at this beat based on standard comping syncopation
                    let prob = 0;
                    if (relativeBeat === 0) prob = 0.8; // beat 1
                    else if (relativeBeat === 2) prob = 0.6; // beat 3
                    else if (relativeBeat === 1.5 || relativeBeat === 2.5) prob = 0.7; // syncopation (the 'and' of 2 or 3)
                    else prob = 0.2; // sparse elsewhere

                    prob *= (1.0 - persona.sparsityTendency * 0.5);

                    if (PRNGManager.next() < prob || b === currentBeat) { // always hit on chord start or high prob
                        const dur = PRNGManager.next() > 0.5 ? 0.25 : 0.5;
                        const keepNotes = Math.max(1, Math.floor(currentVoicing.length * (0.8 - persona.sparsityTendency * 0.3)));
                        const topNotes = currentVoicing.slice(-keepNotes);
                        const v = (b === currentBeat) ? (rhVel * 0.75) : (rhVel * 0.6);
                        for (let p of topNotes) {
                            pianoRH.push({ pitch: p, onset: b, duration: dur, velocity: v });
                        }
                    }
                    b += 0.5; // Evaluate every 8th note
                }

            } else if (strategy === 'arpeggiated_flow' || strategy === 'driving_arpeggios') {
                // Fluid broken chords transitioning into linear counter-melodies ("和弦即音阶")
                let step = strategy === 'driving_arpeggios' ? 0.25 : 0.5;
                let b = currentBeat;
                
                // --- LH "Linear" Construction (唯美的分解) ---
                // Find a safe 10th (3rd octave up) from the current voicing to create a graceful open voicing
                let safe10th = bassPitch + 16; 
                for (let v of currentVoicing) {
                    const diff = (v - bassPitch) % 12;
                    if (diff === 3) { safe10th = bassPitch + 15; break; } // Minor 10th
                    if (diff === 4) { safe10th = bassPitch + 16; break; } // Major 10th
                }

                if (chordDuration >= 2 && strategy === 'arpeggiated_flow') {
                    if (isSoloWithLead) {
                        // Continuous flowing arpeggio for solo piano (fills out the sonic space completely)
                        let lhBeats = currentBeat;
                        let patIdx = 0;
                        const lhPattern = [bassPitch, bassPitch + 7, safe10th, bassPitch + 12];
                        while(lhBeats < chord.endBeat - 0.01) {
                            pianoLH.push({ pitch: lhPattern[patIdx % 4], onset: lhBeats, duration: 1.0, velocity: lhVel * (0.9 - (patIdx % 4) * 0.1) });
                            lhBeats += 0.5;
                            patIdx++;
                            // create up-down motion slightly
                            if (patIdx % 4 === 0) lhPattern[1] = bassPitch + 19; // 5th octave up
                        }
                    } else {
                        // Original succinct 1-5-10-8 flowing line
                        const lhPattern = [bassPitch, bassPitch + 7, safe10th, bassPitch + 12];
                        const lhRhythm = [0, 0.5, 1.0, 1.5];
                        for (let i = 0; i < lhRhythm.length; i++) {
                            if (lhRhythm[i] < chordDuration) {
                                pianoLH.push({ pitch: lhPattern[i], onset: currentBeat + lhRhythm[i], duration: 1.5, velocity: lhVel * (1 - i * 0.1) });
                            }
                        }
                    }
                } else {
                    pianoLH.push({ pitch: bassPitch, onset: currentBeat, duration: chordDuration, velocity: lhVel });
                    if (chordDuration >= 1) {
                        pianoLH.push({ pitch: bassPitch + 7, onset: currentBeat + 0.5, duration: chordDuration - 0.5, velocity: lhVel * 0.8 });
                    }
                }

                // --- RH "Linear" Construction ---
                // Expand RH voicing pool for fluidity 
                let extendedVoicing = [...currentVoicing];
                if (currentVoicing.length < 4) {
                    extendedVoicing.push(currentVoicing[0] + 12);
                    extendedVoicing.push(currentVoicing[1] + 12);
                    extendedVoicing.sort((a,b) => a - b);
                }

                let vIdx = Math.floor(PRNGManager.next() * extendedVoicing.length);
                let dir = PRNGManager.next() > 0.5 ? 1 : -1;

                while (b < chord.endBeat - 0.01) {
                    let pitch = extendedVoicing[vIdx % extendedVoicing.length];
                    
                    // 15% chance to play a passing tone from the scale to build a true "line" rather than just chord tones
                    if (PRNGManager.next() > 0.85) {
                        const globalScalePcs = MusicTheory.getScalePitches(context.tonality);
                        const chordPcs = currentVoicing.map(p => (((p % 12) + 12) % 12));
                        const safePool = Array.from(new Set([...globalScalePcs, ...chordPcs])).sort((a,b) => a-b);

                        let cand = pitch + dir;
                        let steps = 0;
                        while (!safePool.includes(((cand % 12) + 12) % 12) && steps < 4) {
                            cand += dir;
                            steps++;
                        }
                        pitch = cand;
                    }

                    pianoRH.push({ pitch: pitch, onset: b, duration: step * 0.9, velocity: rhVel * 0.75 });
                    
                    // Intelligent Walk based on Persona
                    if (persona.contourPreference === ContourType.Alternating) {
                        dir *= -1;
                        vIdx += dir * (Math.floor(PRNGManager.next() * 2) + 1);
                    } else if (persona.contourPreference === ContourType.Upward) {
                        vIdx += (PRNGManager.next() > 0.3 ? 1 : 2);
                    } else if (persona.contourPreference === ContourType.Downward) {
                        vIdx -= (PRNGManager.next() > 0.3 ? 1 : 2);
                    } else {
                        if (PRNGManager.next() > 0.7) dir *= -1;
                        vIdx += dir * (PRNGManager.next() > 0.8 ? 2 : 1);
                    }
                    
                    // Bounce back if out of bounds
                    if (vIdx < 0) { vIdx = 1; dir = 1; }
                    if (vIdx >= extendedVoicing.length) { vIdx = extendedVoicing.length - 2; dir = -1; }
                    
                    b += step;
                }

            } else if (strategy === 'pop_driving_8ths') {
                // High Energy rock/pop pumping 8th notes
                let b = currentBeat;
                const isHeavy = normalizedEnergy > 0.85;

                while (b < chord.endBeat - 0.01) {
                    // Accent downbeats slightly more
                    const isDownbeat = (b % 1) === 0;
                    const v = isDownbeat ? rhVel : rhVel * 0.8;

                    // LH pumps octaves if very heavy
                    pianoLH.push({ pitch: bassPitch, onset: b, duration: 0.4, velocity: isDownbeat ? lhVel : lhVel * 0.8 });
                    if (isHeavy && isDownbeat) {
                        pianoLH.push({ pitch: bassPitch - 12, onset: b, duration: 0.4, velocity: lhVel * 0.7 });
                    }

                    const keepNotes = isHeavy ? currentVoicing.length : Math.max(2, currentVoicing.length - 1);
                    for (let p of currentVoicing.slice(-keepNotes)) {
                        pianoRH.push({ pitch: p, onset: b, duration: 0.4, velocity: v * 0.8 });
                    }
                    b += 0.5;
                }

            } else if (strategy === 'funk_syncopation') {
                // Dense 16th syncopations interleaving left and right
                let b = currentBeat;
                
                while (b < chord.endBeat - 0.01) {
                    const relativeBeat = b % 4;
                    const gridIndex = Math.floor(relativeBeat / 0.25) % 16;
                    
                    // Interlocking grooves
                    if (gridIndex % 4 === 0 || gridIndex === 7 || gridIndex === 10 || gridIndex === 13) {
                        // "Heavy" hits -> BOTH or LH
                        if (PRNGManager.next() > 0.3) {
                            pianoLH.push({ pitch: bassPitch, onset: b, duration: 0.2, velocity: lhVel });
                            pianoLH.push({ pitch: bassPitch + 7, onset: b, duration: 0.2, velocity: lhVel * 0.8 });
                        }
                        const keepNotes = Math.max(1, Math.floor(currentVoicing.length / 2));
                        for (let p of currentVoicing.slice(-keepNotes)) {
                            pianoRH.push({ pitch: p, onset: b, duration: 0.2, velocity: rhVel });
                        }
                    } else if (PRNGManager.next() < persona.syncopationAssault) {
                        // Off beats -> RH only, short staccato
                        for (let p of currentVoicing.slice(-1)) { // top note only
                            pianoRH.push({ pitch: p, onset: b, duration: 0.15, velocity: rhVel * 0.7 });
                        }
                    }

                    b += 0.25;
                }
            }
        }

        // --- Adjust for Roles ---
        let finalLH = pianoLH;
        let finalRH = pianoRH;

        if (isSoloWithLead) {
            // Solo Mode: Absolute priority to Lead.
            // "绝对不生成冗余的右手和声轨道" - We completely clear the RH harmony to prevent the "third hand".
            // Since RH will play the melody, it cannot simultaneously play chord patterns.
            finalRH = [];
            
            // To prevent LH from being too sparse (since we deleted RH chords), we ONLY enrich 
            // LH if it's playing simple blocks (like in syncopated_comp or sustained_pad).
            // But we NEVER merge the busy RH arpeggios/rhythms into LH, which would be physically impossible
            // if LH is already doing a broken accompanying pattern.
            // finalLH remains as pianoLH, as we now handle fuller LH inside the strategy loops!
            finalLH = pianoLH;
        }

        return { pianoLH: finalLH, pianoRH: finalRH };
    }
}
\n```\n\n### File: `${file}`
**Description**: Logic for generating pop piano patterns.
\n```${lang}\nimport { GeneratedChord, SectionMetadata, GrooveDNA, MusicContext, NoteData, ContourType, RoleType } from '../types';
import { PRNGManager } from '../../utils/PRNG';
import { IdiomUtils } from './IdiomUtils';

export class PopPianoIdiom {
    public static generate(chords: GeneratedChord[], sections: SectionMetadata[], grooveDNA: GrooveDNA, context: MusicContext): { pianoLH: NoteData[]; pianoRH: NoteData[] } {
        const pianoLH: NoteData[] = [];
        const pianoRH: NoteData[] = [];
        let currentVoicing: number[] = [];

        const accompMusician = context.band?.find(m => m.role === RoleType.AccompInst);
        const bassMusician = context.band?.find(m => m.role === RoleType.Bass);
        
        const accompPersona = accompMusician?.persona || { colorBias: 0.5, sparsityTendency: 0.5, contourPreference: ContourType.Alternating, syncopationAssault: 0.3, dynamicRange: [40, 100] as [number, number] };
        const bassPersona = bassMusician?.persona || { colorBias: 0.1, sparsityTendency: 0.5, contourPreference: ContourType.Alternating, syncopationAssault: 0.3, dynamicRange: [40, 100] as [number, number] };

        const accompBusyLevel = 1.0 - accompPersona.sparsityTendency;
        const bassBusyLevel = 1.0 - bassPersona.sparsityTendency;

        for (let ci = 0; ci < chords.length; ci++) {
            const chord = chords[ci];
            let energy = 5;
            for (let i = 0; i < sections.length; i++) {
                if (chord.startBeat >= sections[i].startBeat - 0.001 && chord.startBeat < sections[i].endBeat - 0.001) { 
                    energy = sections[i].energyLevel; break; 
                }
            }

            // Adjust extension usage based on persona
            const { rhVoicing, bassPitch } = IdiomUtils.calculateVoicing(
                chord, 
                currentVoicing, 
                energy / 10 + accompPersona.colorBias * 0.5,
                context.style?.tensionLimits
            );
            currentVoicing = rhVoicing;

            // Pop piano: Straight 8ths, solid roots, predictable arpeggios
            let currentBeat = chord.startBeat;
            const normalizedEnergy = Math.max(0.1, energy / 10);
            
            // Generate pattern dynamic based on Persona's busyLevel and syncopation
            const patternLength = 4; // 1 measure motif
            let rhPattern = normalizedEnergy > 0.6 || accompBusyLevel > 0.6 ? [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5] // straight 8ths
                         : [1.0, 1.0, 1.0, 1.0]; // quarter notes

            // If syncopation is high, tie some 8ths into quarter notes
            if (accompPersona.syncopationAssault > 0.6 && rhPattern[0] === 0.5) {
                rhPattern = [0.5, 0.5, 1.0, 0.5, 0.5, 1.0];
            }

            if (normalizedEnergy > 0.8 && accompBusyLevel > 0.7) {
                // 16th note arpeggios for climax
                rhPattern = [0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.5, 0.5, 0.5, 0.5]; 
            }

            let patternIdx = 0;
            let lhPlayed = false;

            while (currentBeat < chord.endBeat - 0.001) {
                const relativeBeat = currentBeat % 4;
                let stepDur = rhPattern[patternIdx % rhPattern.length];
                
                if (currentBeat + stepDur > chord.endBeat) {
                    stepDur = chord.endBeat - currentBeat;
                }

                const isChordStart = Math.abs(currentBeat - chord.startBeat) < 0.01;
                const isDownbeat = (relativeBeat % 1) < 0.05;

                // Left Hand: Built around Bass Persona
                const isBassAnchor = isChordStart || (isDownbeat && bassBusyLevel > 0.4 && !lhPlayed);
                if (isBassAnchor) {
                    const lhVel = 0.65 + (bassPersona.dynamicRange[1]/127) * 0.2;
                    let dur = chord.endBeat - currentBeat;
                    
                    // Extend duration to overlap slightly (legato pedaling effect)
                    if (ci < chords.length - 1) {
                        dur += 0.25; 
                    }
                    
                    pianoLH.push({ pitch: bassPitch, onset: currentBeat, duration: dur, velocity: lhVel });
                    // Add 5th if density allows
                    if (bassBusyLevel > 0.3) {
                        pianoLH.push({ pitch: bassPitch + 7, onset: currentBeat, duration: dur * 0.9, velocity: lhVel * 0.8 });
                    }
                    if (normalizedEnergy > 0.5 && bassBusyLevel > 0.5) {
                        pianoLH.push({ pitch: bassPitch + 12, onset: currentBeat, duration: dur * 0.9, velocity: lhVel * 0.85 });
                    }
                    lhPlayed = true;
                }

                // If high bass syncopation, add some offbeat hits or passing notes
                if (bassPersona.syncopationAssault > 0.5 && !isDownbeat && (relativeBeat % 0.5 === 0) && PRNGManager.nextFloat(0, 1) < bassPersona.syncopationAssault * 0.5) {
                    // Occasionally use a passing note (up or down a step) leading into the next chord
                    let hitPitch = bassPitch + 12;
                    if (currentBeat > chord.endBeat - 1.0 && ci < chords.length - 1) {
                         const nextChordRoot = chords[ci+1].root;
                         const dist = nextChordRoot - (bassPitch % 12);
                         if (Math.abs(dist) === 2 || Math.abs(dist) === 1) {
                             hitPitch = bassPitch + dist; // scalar step towards next root
                         }
                    }
                    pianoLH.push({ pitch: hitPitch, onset: currentBeat, duration: stepDur * 0.8, velocity: 0.5 });
                }

                // Right Hand: Blocks or simple alternating Arp
                const useArp = (normalizedEnergy > 0.4 && normalizedEnergy < 0.9) || accompBusyLevel > 0.8;
                const baseRhVel = 0.65 + (accompPersona.dynamicRange[1]/127) * 0.25;
                
                // For a more flowing, pedaled sound, we don't truncate notes if they are quarter notes or larger
                const isFlowing = stepDur >= 1.0 && useArp;
                const noteDurMult = isFlowing ? 1.05 : 0.9;
                
                if (useArp) {
                    // Simple pop upward/downward arp
                    let arpIdx = patternIdx % rhVoicing.length;
                    let pitch = rhVoicing[arpIdx];
                    pianoRH.push({ pitch, onset: currentBeat, duration: stepDur * noteDurMult, velocity: baseRhVel - 0.1 + (isDownbeat ? 0.1 : 0) });
                } else {
                    // Block chords 
                    // Use syncopation to randomly skip some non-downbeat chords
                    const skipChord = !isDownbeat && (PRNGManager.nextFloat(0, 1) < accompPersona.syncopationAssault * 0.5);
                    if (!skipChord) {
                        for (let p of rhVoicing) {
                            pianoRH.push({ pitch: p, onset: currentBeat, duration: stepDur * (stepDur >= 1.0 ? 1.1 : 0.9), velocity: baseRhVel + (isDownbeat ? 0.1 : 0) });
                        }
                    }
                }

                currentBeat += stepDur;
                patternIdx++;
            }
        }
        return { pianoLH, pianoRH };
    }
}
\n```\n\n### File: `${file}`
**Description**: Logic for bass synthesis.
\n```${lang}\nimport { InstrumentConfig, MusicalRole } from '../types';

export const ElectricBass: InstrumentConfig = {
    id: 2,
    name: 'Electric Bass',
    minPitch: 28, // E1
    maxPitch: 67, // G4
    maxPolyphony: 4, 
    antiMudThreshold: 0, // N/A
    supportsPitchBend: true,
    supportsSlide: true,
    isMonophonic: true,
    capabilities: [MusicalRole.Bass, MusicalRole.Lead] // Can play bass lines, and technically melodies
};
\n```\n\n### File: `${file}`
**Description**: Electric piano instrument configuration.
\n```${lang}\nimport { InstrumentConfig, MusicalRole } from '../types';

export const ElectricPiano: InstrumentConfig = {
    id: 1,
    name: 'Electric Piano',
    minPitch: 21,
    maxPitch: 108,
    maxPolyphony: 10,
    antiMudThreshold: 45, // A2 (rhodes can go lower before muddiness sometimes)
    supportsPitchBend: false,
    supportsSlide: false,
    isMonophonic: false,
    capabilities: [MusicalRole.Lead, MusicalRole.Accomp, MusicalRole.Bass]
};
\n```\n\n### File: `${file}`
**Description**: Grand piano instrument configuration.
\n```${lang}\nimport { InstrumentConfig, MusicalRole } from '../types';

export const GrandPiano: InstrumentConfig = {
    id: 0,
    name: 'Grand Piano',
    minPitch: 21, // A0
    maxPitch: 108, // C8
    maxPolyphony: 10, // Ten fingers
    antiMudThreshold: 48, // C3
    supportsPitchBend: false,
    supportsSlide: false,
    isMonophonic: false,
    capabilities: [MusicalRole.Lead, MusicalRole.Accomp, MusicalRole.Bass]
};
\n```\n\n### File: `${file}`
**Description**: Standard drum mapped patterns.
\n```${lang}\nimport { InstrumentConfig, MusicalRole } from '../types';

export const StandardDrumKit: InstrumentConfig = {
    id: 3,
    name: 'Standard Drum Kit',
    minPitch: 35, // Acoustic Bass Drum
    maxPitch: 81, // Open Triangle
    maxPolyphony: 4, // 4 limbs
    antiMudThreshold: 0,
    supportsPitchBend: false,
    supportsSlide: false,
    isMonophonic: false,
    capabilities: [MusicalRole.Percussion]
};
\n```\n\n### File: `${file}`
**Description**: Registry defining available instruments.
\n```${lang}\nimport { InstrumentConfig } from '../types';
import { GrandPiano } from '../instruments/GrandPiano';
import { ElectricPiano } from '../instruments/ElectricPiano';
import { ElectricBass } from '../instruments/ElectricBass';
import { StandardDrumKit } from '../instruments/StandardDrumKit';

export const INSTRUMENT_REGISTRY: Record<number, InstrumentConfig> = {
    0: GrandPiano,
    1: ElectricPiano,
    2: ElectricBass,
    3: StandardDrumKit
};

export function getInstrumentConfig(id: number): InstrumentConfig {
    return INSTRUMENT_REGISTRY[id] || INSTRUMENT_REGISTRY[0];
}
\n```\n\n### File: `${file}`
**Description**: Registry mapping personas to generated playing styles.
\n```${lang}\nimport { RoleType, MusicianProfile, IdiomType, ContourType } from '../types';
import { AlexPopPiano } from '../personas/AlexPopPiano';
import { MarcusNeoSoulKeys } from '../personas/MarcusNeoSoulKeys';
import { DaveSteadyPopDrums } from '../personas/DavePopDrums';
import { NinaChillJazzPiano } from '../personas/NinaChillJazzPiano';

export const MUSICIAN_REGISTRY: MusicianProfile[] = [
    AlexPopPiano,
    MarcusNeoSoulKeys,
    DaveSteadyPopDrums,
    NinaChillJazzPiano
];

export function getMusiciansByRole(role: RoleType): MusicianProfile[] {
    return MUSICIAN_REGISTRY.filter(m => m.role === role);
}

export function getMusicianById(id: string): MusicianProfile | undefined {
    return MUSICIAN_REGISTRY.find(m => m.id === id);
}
\n```\n\n### File: `${file}`
**Description**: Mappings for genre specific values (Swing, tempo, chords).
\n```${lang}\nimport { StyleConfig } from "../types";
import { PopStyle } from "../styles/PopStyle";
import { NeoSoulStyle } from "../styles/NeoSoulStyle";
import { ChillJazzStyle } from "../styles/ChillJazzStyle";
export { DefaultHarmony } from "../styles/Shared";

export const StyleRegistry: Record<string, StyleConfig> = {
    'Pop': PopStyle,
    'Neo-Soul': NeoSoulStyle,
    'Chill Jazz': ChillJazzStyle
};

\n```\n\n### File: `${file}`
**Description**: Rhythmic building blocks for melody.
\n```${lang}\nexport const BASIC_RHYTHM_CELLS: number[][] = [
    // Standard quarter & half notes
    [1.0, 1.0, 1.0, 1.0],
    [1.0, 1.0, 2.0],
    [2.0, 2.0],
    
    // 8th note runs (continuous, flowing)
    [0.5, 0.5, 0.5, 0.5, 1.0, 1.0],
    [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1.0],
    [1.0, 0.5, 0.5, 1.0, 1.0],
    [0.5, 0.5, 1.0, 0.5, 0.5, 1.0],
    [1.0, 1.0, 0.5, 0.5, 0.5, 0.5],
    [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    
    // Syncopated patterns & triplets (represented closely by combining varying divisions if needed, though strictly we stick to multiples of 0.25)
    [0.75, 0.25, 1.0, 1.0, 1.0],
    [1.0, 0.75, 0.25, 2.0],
    [0.5, 1.0, 0.5, 1.0, 1.0],
    [1.5, 0.5, 1.0, 1.0],
    
    // 16th note flourishes
    [0.25, 0.25, 0.25, 0.25, 1.0, 1.0, 1.0],
    [1.0, 0.25, 0.25, 0.5, 1.0, 1.0],
    [0.5, 0.25, 0.25, 0.5, 0.5, 1.0, 1.0],

    // Rest/Phrasing patterns (used sparingly for human-like breathing)
    [-0.5, 0.5, 1.0, 2.0],
    [1.0, -0.5, 0.5, 1.0, 1.0],
    [-1.0, 1.0, 1.0, 1.0],
    [0.5, 0.5, -0.5, 0.5, 2.0]
];
\n```\n\n### File: `${file}`
**Description**: Core system to generate the melodic phrasing.
\n```${lang}\nimport { NoteData, GeneratedChord, Tonality, GlobalHarmonicFrame, MusicalRole, SectionMetadata } from '../types';
import { PRNGManager } from '../../utils/PRNG';
import { MusicTheory } from '../theory/MusicTheory';
import { GrooveEngine } from './GrooveEngine';
import { MelodicContourEngine } from './MelodicContourEngine';
import { ToplinePlugin } from './plugins/ToplinePlugin';
import { PassingNotePlugin } from './plugins/PassingNotePlugin';

export class ToplineEngine {
    private static plugins: ToplinePlugin[] = [
        new PassingNotePlugin()
    ];

    public static registerPlugin(plugin: ToplinePlugin) {
        this.plugins.push(plugin);
    }

    public static generateMelody(chords: GeneratedChord[], tonality: Tonality, harmonicFrames?: GlobalHarmonicFrame[], sections?: SectionMetadata[]): NoteData[] {
        let melody: NoteData[] = [];
        let currentBeat = 0;
        
        // General bounding (relative to Key Root, so 0 is the Tonic)
        const minPitch = -14; // Allow a bit more range
        const maxPitch = 14;
        let lastPitch = 0; // Starting at the Tonic
        let lastMotion = 0; // Track the previous melodic interval
        
        let currentMotif: number[] = [];
        let motifBeatCursor = 0;
        let currentSectionEnergy = 5;

        for (let i = 0; i < chords.length; i++) {
            const chord = chords[i];
            const frame = harmonicFrames?.find(f => Math.abs(f.startBeat - chord.startBeat) < 0.01);
            
            // Move currentBeat up to chord start if we fell behind somehow
            if (currentBeat < chord.startBeat) {
                currentBeat = chord.startBeat;
            }

            // Determine section energy for motivic development
            if (sections) {
                const sec = sections.find(s => currentBeat >= s.startBeat && currentBeat < s.endBeat);
                if (sec) {
                    // Start of a new 4-bar phrase or new section regenerates the motif
                    if (currentMotif.length === 0 || currentBeat % 16 === 0) {
                        currentMotif = GrooveEngine.generateMotif(16, sec.energyLevel);
                        motifBeatCursor = 0;
                        currentSectionEnergy = sec.energyLevel;
                    }
                }
            } else if (currentMotif.length === 0 || currentBeat % 16 === 0) {
                currentMotif = GrooveEngine.generateMotif(16, 5); // fallback energy
                motifBeatCursor = 0;
            }

            // Figure out available target pitches for the melody over this chord
            const targetPcs: number[] = [];
            let scalePcs: number[] = [];

            if (frame) {
                // Find all allocations that the Lead is allowed/supposed to play
                const leadAllocations = frame.toneAllocations.filter(t => t.role === MusicalRole.Lead);
                for (const al of leadAllocations) {
                    targetPcs.push(al.pitchClass);
                }
                scalePcs = frame.pitchScale;
            }

            // Fallback if no specific target PCs
            if (targetPcs.length === 0) {
                const intervals = MusicTheory.getChordTones(chord.quality);
                if (intervals && intervals.length >= 3) {
                    targetPcs.push((chord.root + intervals[0]) % 12);
                    targetPcs.push((chord.root + intervals[1]) % 12);
                    targetPcs.push((chord.root + intervals[2]) % 12);
                } else {
                    targetPcs.push(chord.root);
                    targetPcs.push((chord.root + 7) % 12);
                    targetPcs.push((chord.root + 4) % 12);
                }
            }
            if (scalePcs.length === 0) {
                // strict local scale to avoid clashing with passing chords
                scalePcs = MusicTheory.getLocalScalePitches(chord.root, chord.quality, tonality);
            }

            // Generate rhythm for the duration of this chord
            const chordDuration = chord.endBeat - chord.startBeat;
            let beatsFilled = 0;

            while (beatsFilled < chordDuration) {
                // Get duration from the motif instead of randomly
                let dur = currentMotif[motifBeatCursor];
                
                // If we ran out of motif somehow (it shouldn't typically happen since it repeats, but safety first)
                if (dur === undefined) {
                    motifBeatCursor = 0;
                    dur = currentMotif[motifBeatCursor] || 1.0;
                }
                
                motifBeatCursor = (motifBeatCursor + 1) % currentMotif.length;
                
                if (beatsFilled >= chordDuration) break;
                
                const actualDur = Math.abs(dur);
                const isRest = dur < 0;

                // Trim if it exceeds chord boundary
                let noteDur = actualDur;
                if (beatsFilled + noteDur > chordDuration) {
                    noteDur = chordDuration - beatsFilled;
                }

                if (!isRest && noteDur > 0) {
                        // Decide which pitch to play. 
                        // High chance to play a target PC (essential/tension assigned to lead)
                        // Lower chance to play a random scale tone (passing tone)
                        let selectedPc = -1;
                        
                        if (PRNGManager.nextFloat(0, 1) < 0.8) { // 80% target chord tone
                            selectedPc = targetPcs[PRNGManager.nextInt(0, targetPcs.length - 1)];
                        } else {
                            selectedPc = scalePcs[PRNGManager.nextInt(0, scalePcs.length - 1)];
                        }

                        // Map selected Pitch Class to a MIDI pitch 
                        let possiblePitches: number[] = [];
                        for (let oct = -2; oct <= 2; oct++) {
                            const p = selectedPc + oct * 12;
                            if (p >= minPitch && p <= maxPitch) {
                                possiblePitches.push(p);
                            }
                        }

                        if (possiblePitches.length > 0) {
                            const { bestPitch } = MelodicContourEngine.selectBestPitch(
                                possiblePitches,
                                lastPitch,
                                lastMotion,
                                currentSectionEnergy
                            );
                            
                            const chosenPitch = bestPitch;

                            let actualOnset = currentBeat;
                            let actualDur = noteDur * 0.95; // More legato by default
                            
                            // Slight chance to make short notes slightly staccato for bounce
                            if (noteDur <= 0.5 && PRNGManager.nextFloat(0, 1) > 0.7) {
                                actualDur = noteDur * 0.7;
                            }

                            const baseVel = 45 + (currentSectionEnergy * 5);
                            let vel = PRNGManager.nextInt(baseVel, baseVel + 20);
                            
                            // Accentuate downbeats slightly
                            if ((actualOnset % 1.0) === 0) {
                                vel += 10;
                            }
                            // Emphasize long notes
                            if (actualDur >= 1.0) {
                                vel += 5;
                            }

                            melody.push({
                                pitch: chosenPitch,
                                onset: actualOnset,
                                duration: actualDur,
                                velocity: Math.min(127, vel) / 127.0
                            });

                            lastMotion = chosenPitch - lastPitch;
                            lastPitch = chosenPitch;
                        }
                    }

                    currentBeat += noteDur;
                    beatsFilled += noteDur;
            }
        }

        // Apply Plugins
        for (const plugin of this.plugins) {
            melody = plugin.process(melody, { 
                tonality, 
                frames: harmonicFrames, 
                sections, 
                energyLevel: currentSectionEnergy 
            });
        }

        return melody;
    }
}
\n```\n\n### File: `${file}`
**Description**: Plugin to connect melody gaps smoothly.
\n```${lang}\nimport { NoteData, Tonality, GlobalHarmonicFrame, SectionMetadata } from '../../types';
import { ToplinePlugin } from './ToplinePlugin';
import { PRNGManager } from '../../../utils/PRNG';

import { MusicTheory } from '../../theory/MusicTheory';

export class PassingNotePlugin implements ToplinePlugin {
    process(melodyTrack: NoteData[], context: { tonality: Tonality, frames?: GlobalHarmonicFrame[], sections?: SectionMetadata[], energyLevel: number }): NoteData[] {
        const enhancedMelody: NoteData[] = [];
        const scalePcs = MusicTheory.getScalePitches(context.tonality);
        
        for (let i = 0; i < melodyTrack.length; i++) {
            const currentNote = melodyTrack[i];
            const previousNote = i > 0 ? melodyTrack[i - 1] : null;

            if (previousNote && currentNote.duration >= 0.5 && PRNGManager.nextFloat(0, 1) > 0.6) {
                const dist = Math.abs(currentNote.pitch - previousNote.pitch);
                // Trigger if there is a gap or leap
                if (dist >= 3 && dist <= 7) {
                    
                    // Simple passing approach
                    let approachPitch = currentNote.pitch > previousNote.pitch ? currentNote.pitch - PRNGManager.nextInt(1, 2) : currentNote.pitch + PRNGManager.nextInt(1, 2);
                    
                    // Snap to local scale if available
                    let localScalePcs = scalePcs;
                    if (context.frames) {
                        const frame = context.frames.find(f => currentNote.onset >= f.startBeat && currentNote.onset < f.endBeat);
                        if (frame) {
                            localScalePcs = frame.pitchScale;
                        }
                    }

                    approachPitch = MusicTheory.snapToPool(approachPitch, localScalePcs);
                    
                    // The passing note takes up a small syncopated fraction
                    const passingDur = currentNote.duration >= 1.0 ? 0.25 : 0.25; 
                    const baseVelPassing = 40 + (context.energyLevel * 5); // softer for passing
                    
                    // Place the passing note right BEFORE the current note
                    const passingOnset = currentNote.onset - passingDur;
                    
                    // If the previous note is too close, trim it
                    if (previousNote.onset + previousNote.duration > passingOnset) {
                        previousNote.duration = passingOnset - previousNote.onset;
                        // if we squeezed it too much, just cancel the passing note (rare)
                        if (previousNote.duration <= 0.125) {
                            enhancedMelody.push(currentNote);
                            continue;
                        }
                    }

                    enhancedMelody.push({
                        pitch: approachPitch,
                        onset: passingOnset,
                        duration: passingDur * 0.9,
                        velocity: PRNGManager.nextInt(baseVelPassing, baseVelPassing + 15) / 127.0
                    });

                    // We DO NOT shift the current note's onset, it stays exactly on its intended rhythmic position.
                }
            }
            enhancedMelody.push(currentNote);
        }

        return enhancedMelody;
    }
}
\n```\n\n### File: `${file}`
**Description**: Base melody plugin.
\n```${lang}\nimport { NoteData, Tonality, GlobalHarmonicFrame, SectionMetadata } from '../../types';

export interface ToplinePlugin {
    process(melodyTrack: NoteData[], context: {
        tonality: Tonality, 
        frames?: GlobalHarmonicFrame[],
        sections?: SectionMetadata[],
        energyLevel: number
    }): NoteData[];
}
\n```\n\n### File: `${file}`
**Description**: Persona config for Alex (Pop Piano).
\n```${lang}\nimport { RoleType, MusicianProfile, ContourType } from '../types';

export const AlexPopPiano: MusicianProfile = {
    id: 'accomp_alex_pop',
    name: 'Alex (Pop Piano)',
    role: RoleType.AccompInst,
    styleId: 'Pop',
    instrumentId: 0,
    persona: { 
        colorBias: 0.4, 
        sparsityTendency: 0.5, 
        contourPreference: ContourType.Alternating,
        syncopationAssault: 0.3, 
        dynamicRange: [35, 100], 
        signatureLickProb: 0.15 
    },
    description: 'Solid pop piano accompaniment with moderate extensions.'
};
\n```\n\n### File: `${file}`
**Description**: Persona config for Dave (Pop Drums).
\n```${lang}\nimport { RoleType, MusicianProfile, ContourType } from '../types';

export const DaveSteadyPopDrums: MusicianProfile = {
    id: 'drums_dave_pop',
    name: 'Dave (Steady Pop)',
    role: RoleType.Drums,
    styleId: 'Pop',
    instrumentId: 3,
    persona: { 
        colorBias: 0.0, 
        sparsityTendency: 0.6, 
        contourPreference: ContourType.Random,
        syncopationAssault: 0.2, 
        dynamicRange: [45, 105], 
        signatureLickProb: 0.05 
    },
    description: 'Straightforward 4/4 pop beats, very reliable.'
};
\n```\n\n### File: `${file}`
**Description**: Persona config for Marcus (Neo Soul Keys).
\n```${lang}\nimport { RoleType, MusicianProfile, ContourType } from '../types';

export const MarcusNeoSoulKeys: MusicianProfile = {
    id: 'accomp_marcus_neosoul',
    name: 'Marcus (Neo-Soul Keys)',
    role: RoleType.AccompInst,
    styleId: 'Neo-Soul',
    instrumentId: 1, // EPiano
    persona: { 
        colorBias: 0.9, 
        sparsityTendency: 0.8, // Plays very minimally (lots of rests)
        contourPreference: ContourType.Downward,
        syncopationAssault: 0.9, 
        dynamicRange: [40, 85], 
        signatureLickProb: 0.4 
    },
    description: 'Extremely sparse but complex voicings, heavy syncopation.'
};
\n```\n\n### File: `${file}`
**Description**: Persona config for Nina (Jazz Piano).
\n```${lang}\nimport { RoleType, MusicianProfile, ContourType } from '../types';

export const NinaChillJazzPiano: MusicianProfile = {
    id: 'accomp_nina_chill_jazz',
    name: 'Nina (Chill Jazz Piano)',
    role: RoleType.AccompInst,
    styleId: 'Chill Jazz',
    instrumentId: 0, // Acoustic Grand Piano
    persona: { 
        colorBias: 0.8, // Loves colorful extensions (9ths, 11ths)
        sparsityTendency: 0.65, // Gives space to the melody
        contourPreference: ContourType.Downward,
        syncopationAssault: 0.5, // Relaxed syncopation, not aggressive
        dynamicRange: [30, 75], // Very gentle touch
        signatureLickProb: 0.2 
    },
    description: 'Soft, sophisticated jazz voicings with laid-back timing and a gentle touch.'
};
\n```\n\n### File: `${file}`
**Description**: Config file for chill jazz style constants.
\n```${lang}\nimport { StyleConfig, SectionType } from '../types';
import { defaultDrumProbabilities } from './Shared';

export const ChillJazzHarmony = {
    major: {
        [SectionType.Intro]:   [['ii7', 'V7', 'Imaj7', 'Imaj7'], ['Imaj7', 'vi7', 'ii7', 'V7']],
        [SectionType.Verse]:   [['Imaj7', 'vi7', 'ii7', 'V7'], ['ii7', 'V7', 'Imaj7', 'VI7'], ['IVmaj7', 'iii7', 'ii7', 'Imaj7']],
        [SectionType.PreChorus]: [['ii7', 'V7', 'iii7', 'vi7'], ['IVmaj7', 'V7', 'iii7', 'VI7']],
        [SectionType.Chorus]:  [['IVmaj7', 'V7', 'iii7', 'vi7', 'ii7', 'V7', 'Imaj7', 'I7'], ['Imaj7', 'IVmaj7', 'iii7', 'vi7'], ['ii7', 'V7', 'Imaj7', 'VI7']],
        [SectionType.Outro]:   [['IVmaj7', 'iv7', 'Imaj7', 'Imaj7'], ['ii7', 'V7', 'Imaj7', 'Imaj7']]
    },
    minor: {
        [SectionType.Intro]:   [['i7', 'iv7', 'i7', 'v7'], ['i7', 'VImaj7', 'i7', 'V7']],
        [SectionType.Verse]:   [['i7', 'iv7', 'VII7', 'IIImaj7'], ['i7', 'VImaj7', 'iiø7', 'V7'], ['VImaj7', 'V7', 'i7', 'i7']],
        [SectionType.PreChorus]: [['iv7', 'VII7', 'IIImaj7', 'VImaj7'], ['iiø7', 'V7', 'i7', 'I7']],
        [SectionType.Chorus]:  [['VImaj7', 'VII7', 'i7', 'v7'], ['i7', 'VImaj7', 'IIImaj7', 'VII7'], ['VImaj7', 'VII7', 'IIImaj7', 'VImaj7', 'iiø7', 'V7', 'i7', 'i7']],
        [SectionType.Outro]:   [['VImaj7', 'iv7', 'i7', 'i7'], ['i7', 'V7', 'i7', 'i7']]
    }
};

// Chill Jazz features relaxed tempos, moderate to high tension, 
// and gentle swing with lots of anticipation/push beats.
export const ChillJazzStyle: StyleConfig = {
    id: 'Chill Jazz',
    name: 'Chill Jazz',
    tensionLimits: 11, // Allows 7ths, 9ths, and 11ths for a colorful but not overly dissonant sound
    densityBaseline: 0.4, // Sparse and breathable
    drumProbabilities: defaultDrumProbabilities, // In reality, more ride cymbal/brushes
    harmony: ChillJazzHarmony, // Custom jazz harmony progressions
    passingChordProb: 0.5, // Moderate passing chords for color
    anticipationProb: 0.6, // Frequent laid-back syncopation
    swingRatio: 0.55 // Gentle swing feel
};
\n```\n\n### File: `${file}`
**Description**: Config file for neo soul style constants.
\n```${lang}\nimport { StyleConfig } from '../types';
import { defaultDrumProbabilities, DefaultHarmony } from './Shared';

export const NeoSoulStyle: StyleConfig = {
    id: 'Neo-Soul',
    name: 'Neo-Soul',
    tensionLimits: 13, // Full spectrum of extensions allowed
    densityBaseline: 0.5,
    drumProbabilities: defaultDrumProbabilities, // In reality this would be more swung/syncopated
    harmony: DefaultHarmony, // Ideally custom harmony with lots of ii-V-Is
    passingChordProb: 0.6, // High passing chords
    anticipationProb: 0.7, // Heavy syncopation / push beats
    swingRatio: 0.6 // Slight swing
};
\n```\n\n### File: `${file}`
**Description**: Config file for pop style constants.
\n```${lang}\nimport { StyleConfig } from '../types';
import { defaultDrumProbabilities, DefaultHarmony } from './Shared';

export const PopStyle: StyleConfig = {
    id: 'Pop',
    name: 'Standard Pop',
    tensionLimits: 9, // Pop usually goes up to 7ths and 9ths, rarely 11 or 13
    densityBaseline: 0.6,
    drumProbabilities: defaultDrumProbabilities,
    harmony: DefaultHarmony,
    passingChordProb: 0.2,
    anticipationProb: 0.3
};
\n```\n\n### File: `${file}`
**Description**: Shared logic across genres.
\n```${lang}\nimport { StyleConfig, SectionType } from "../types";

export const DefaultHarmony = {
    major: {
        [SectionType.Intro]:   [['I', 'IVmaj7', 'I', 'IVmaj7'], ['vi', 'IV', 'I', 'V']],
        [SectionType.Verse]:   [['I', 'vi', 'IV', 'V'], ['I', 'V', 'vi', 'IV'], ['I', 'IV', 'ii', 'V']],
        [SectionType.PreChorus]: [['ii', 'V', 'I', 'vi'], ['IV', 'V', 'iii', 'vi']],
        [SectionType.Chorus]:  [['I', 'V', 'vi', 'IV'], ['IVmaj7', 'V', 'iii', 'vi'], ['I', 'V/VII', 'vi', 'I/V', 'IV', 'I/III', 'ii', 'V']],
        [SectionType.Outro]:   [['IV', 'iv', 'I', 'I'], ['vi', 'V', 'IV', 'I']]
    },
    minor: {
        [SectionType.Intro]:   [['i', 'VI', 'i', 'VI'], ['i', 'v', 'VI', 'VII']],
        [SectionType.Verse]:   [['i', 'VI', 'III', 'VII'], ['i', 'iv', 'v', 'i'], ['i', 'VII', 'VI', 'v']],
        [SectionType.PreChorus]: [['iv', 'v', 'i', 'i'], ['VI', 'VII', 'i', 'i']],
        [SectionType.Chorus]:  [['VI', 'VII', 'i', 'v'], ['i', 'VI', 'III', 'VII'], ['VI', 'VII', 'III', 'VI', 'iiø', 'V7', 'i', 'i']],
        [SectionType.Outro]:   [['VI', 'iv', 'i', 'i'], ['i', 'v', 'i', 'i']]
    }
};

export const defaultDrumProbabilities = [
    [1.0, 0.0, 0.4, 60, 80], [0.0, 0.0, 0.3, 30, 50], [0.1, 0.0, 0.6, 40, 60], [0.0, 0.0, 0.2, 30, 50],
    [0.0, 1.0, 0.5, 70, 90], [0.0, 0.0, 0.2, 30, 50], [0.2, 0.0, 0.5, 40, 60], [0.0, 0.0, 0.3, 30, 50],
    [0.6, 0.0, 0.4, 60, 80], [0.0, 0.0, 0.3, 30, 50], [0.1, 0.0, 0.5, 40, 60], [0.0, 0.0, 0.2, 30, 50],
    [0.0, 1.0, 0.5, 70, 90], [0.0, 0.0, 0.2, 30, 50], [0.1, 0.3, 0.5, 40, 60], [0.1, 0.0, 0.3, 30, 50],
];
\n```\n\n### File: `${file}`
**Description**: Functions for scales, semitones, and chords.
\n```${lang}\nexport enum Tonality {
    Major = 0, Minor = 1, Major_Pentatonic = 2, Minor_Pentatonic = 3,
    Blues = 4, Dorian = 5, Mixolydian = 6, Melodic_Minor = 7, Lydian = 8,
    Harmonic_Minor = 9, Phrygian = 10
}

export const TonalityName: string[] = [];
TonalityName[Tonality.Major] = 'Major';
TonalityName[Tonality.Minor] = 'Minor';
TonalityName[Tonality.Major_Pentatonic] = 'Major_Pentatonic';
TonalityName[Tonality.Minor_Pentatonic] = 'Minor_Pentatonic';
TonalityName[Tonality.Blues] = 'Blues';
TonalityName[Tonality.Dorian] = 'Dorian';
TonalityName[Tonality.Mixolydian] = 'Mixolydian';
TonalityName[Tonality.Melodic_Minor] = 'Melodic_Minor';
TonalityName[Tonality.Lydian] = 'Lydian';
TonalityName[Tonality.Harmonic_Minor] = 'Harmonic_Minor';
TonalityName[Tonality.Phrygian] = 'Phrygian';

export const SCALE_INTERVALS: number[][] = [];
SCALE_INTERVALS[Tonality.Major]            = [0, 2, 4, 5, 7, 9, 11];
SCALE_INTERVALS[Tonality.Minor]            = [0, 2, 3, 5, 7, 8, 10];
SCALE_INTERVALS[Tonality.Major_Pentatonic] = [0, 2, 4, 7, 9];
SCALE_INTERVALS[Tonality.Minor_Pentatonic] = [0, 3, 5, 7, 10];
SCALE_INTERVALS[Tonality.Blues]            = [0, 3, 5, 6, 7, 10];
SCALE_INTERVALS[Tonality.Dorian]           = [0, 2, 3, 5, 7, 9, 10];
SCALE_INTERVALS[Tonality.Mixolydian]       = [0, 2, 4, 5, 7, 9, 10];
SCALE_INTERVALS[Tonality.Melodic_Minor]    = [0, 2, 3, 5, 7, 9, 11];
SCALE_INTERVALS[Tonality.Lydian]           = [0, 2, 4, 6, 7, 9, 11];
SCALE_INTERVALS[Tonality.Harmonic_Minor]   = [0, 2, 3, 5, 7, 8, 11];
SCALE_INTERVALS[Tonality.Phrygian]         = [0, 1, 3, 5, 7, 8, 10];

export enum ChordQualityEnum {
    Major = 0, Minor = 1, Diminished = 2, Diminished7 = 3, Augmented = 4,
    Dominant7 = 5, Minor7 = 6, Major7 = 7, HalfDiminished = 8,
    Sus4 = 9, Dominant7Sus4 = 10, Add9 = 11, Minor9 = 12, Major9 = 13,
    Dominant9 = 14, Minor11 = 15, Dominant13 = 16
}

export const CHORD_INTERVALS: number[][] = [];
CHORD_INTERVALS[ChordQualityEnum.Major]          = [0, 4, 7];
CHORD_INTERVALS[ChordQualityEnum.Minor]          = [0, 3, 7];
CHORD_INTERVALS[ChordQualityEnum.Diminished]     = [0, 3, 6];
CHORD_INTERVALS[ChordQualityEnum.Diminished7]    = [0, 3, 6, 9];
CHORD_INTERVALS[ChordQualityEnum.Augmented]      = [0, 4, 8];
CHORD_INTERVALS[ChordQualityEnum.Dominant7]      = [0, 4, 7, 10];
CHORD_INTERVALS[ChordQualityEnum.Minor7]         = [0, 3, 7, 10];
CHORD_INTERVALS[ChordQualityEnum.Major7]         = [0, 4, 7, 11];
CHORD_INTERVALS[ChordQualityEnum.HalfDiminished] = [0, 3, 6, 10];
CHORD_INTERVALS[ChordQualityEnum.Sus4]           = [0, 5, 7];
CHORD_INTERVALS[ChordQualityEnum.Dominant7Sus4]  = [0, 5, 7, 10];
CHORD_INTERVALS[ChordQualityEnum.Add9]           = [0, 4, 7, 14];
CHORD_INTERVALS[ChordQualityEnum.Minor9]         = [0, 3, 7, 10, 14];
CHORD_INTERVALS[ChordQualityEnum.Major9]         = [0, 4, 7, 11, 14];
CHORD_INTERVALS[ChordQualityEnum.Dominant9]      = [0, 4, 7, 10, 14];
CHORD_INTERVALS[ChordQualityEnum.Minor11]        = [0, 3, 7, 10, 14, 17];
CHORD_INTERVALS[ChordQualityEnum.Dominant13]     = [0, 4, 7, 10, 14, 21];

const NUMERAL_REGEX = /^([b#]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(maj9|maj7|m7b5|m11|m9|m7|dim7|dim|aug|add9|7sus4|sus4|13|11|9|7|ø|\\+|m)?(?:\/([b#]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i))?$/;

export class MusicTheory {
    public static getScalePitches(tonality: Tonality): number[] {
        return SCALE_INTERVALS[tonality];
    }

    public static getLocalScalePitches(chordRoot: number, quality: ChordQualityEnum, globalTonality?: Tonality): number[] {
        let globalScale = [0, 2, 4, 5, 7, 9, 11]; // default major
        if (globalTonality !== undefined) {
             globalScale = MusicTheory.getScalePitches(globalTonality);
        }

        const chordTones = MusicTheory.getChordTones(quality).map(i => (chordRoot + i) % 12);
        let localScale = [...globalScale];

        for (const ct of chordTones) {
            if (localScale.includes(ct)) continue;

            const intervalFromRoot = (ct - chordRoot + 12) % 12;

            // Find all notes in global scale that are 1 semitone away from our chord tone
            const neighbors = localScale.filter(g => {
                const diff = Math.abs(g - ct);
                const d = Math.min(diff, 12 - diff);
                return d === 1;
            });

            for (const n of neighbors) {
                const neighborInterval = (n - chordRoot + 12) % 12;
                
                let shouldReplace = false;
                // If it's a 3rd conflict (minor vs major 3rd)
                if ((intervalFromRoot === 3 || intervalFromRoot === 4) && (neighborInterval === 3 || neighborInterval === 4)) {
                    shouldReplace = true;
                }
                // If it's a 7th conflict (minor vs major 7th)
                else if ((intervalFromRoot === 10 || intervalFromRoot === 11) && (neighborInterval === 10 || neighborInterval === 11)) {
                    shouldReplace = true;
                }
                // If it's a 5th conflict (perfect vs diminished/augmented)
                else if ((intervalFromRoot === 6 || intervalFromRoot === 7 || intervalFromRoot === 8) && (neighborInterval === 6 || neighborInterval === 7 || neighborInterval === 8)) {
                    // Be careful not to replace the 4th (5) or 6th (9) unless they are strictly functioning as an altered 5th.
                    // But 6 and 8 are explicitly augmented 4th / minor 6th in isolation. 
                    // Let's just say if the neighbor is exactly 7 (perfect fifth) we replace it, or if interval is 7 and neighbor is 6/8 we replace it.
                    if (intervalFromRoot === 7 || neighborInterval === 7) {
                        shouldReplace = true;
                    }
                }
                // Check flat 9 vs natural 9
                else if ((intervalFromRoot === 1 || intervalFromRoot === 2) && (neighborInterval === 1 || neighborInterval === 2)) {
                    shouldReplace = true;
                }

                if (shouldReplace) {
                    localScale = localScale.filter(x => x !== n);
                }
            }
        }

        const finalSet = new Set([...localScale, ...chordTones]);
        return Array.from(finalSet).sort((a, b) => a - b);
    }

    public static getChordTones(quality: ChordQualityEnum): number[] {
        return CHORD_INTERVALS[quality];
    }

    public static snapToScale(pitch: number, tonality: Tonality): number {
        const scale = SCALE_INTERVALS[tonality];
        if (!scale || scale.length === 0) return pitch;
        
        return this.snapToPool(pitch, scale);
    }

    public static snapToPool(pitch: number, poolPcs: number[]): number {
        if (poolPcs.length === 0) return pitch;

        const pc = ((pitch % 12) + 12) % 12;
        const octave = Math.floor(pitch / 12);

        let bestPc = poolPcs[0];
        let firstDiff = Math.abs(pc - poolPcs[0]);
        let bestDist = Math.min(firstDiff, 12 - firstDiff);
        for (let i = 1; i < poolPcs.length; i++) {
            const diff = Math.abs(pc - poolPcs[i]);
            const d = Math.min(diff, 12 - diff);
            if (d < bestDist) {
                bestDist = d;
                bestPc = poolPcs[i];
            }
        }

        const cand0 = bestPc + (octave - 1) * 12;
        const cand1 = bestPc + octave * 12;
        const cand2 = bestPc + (octave + 1) * 12;

        let best = cand0;
        let bestAbs = Math.abs(pitch - cand0);

        const d1 = Math.abs(pitch - cand1);
        if (d1 < bestAbs) { bestAbs = d1; best = cand1; }

        const d2 = Math.abs(pitch - cand2);
        if (d2 < bestAbs) { bestAbs = d2; best = cand2; }

        return best;
    }

    public static getSmoothVoicing(
        chordPcs: number[],
        prevVoicing: number[],
        targetCenter: number
    ): number[] {
        const result: number[] = [];
        let center = targetCenter;

        if (prevVoicing && prevVoicing.length > 0) {
            let sum = 0;
            for (let i = 0; i < prevVoicing.length; i++) sum += prevVoicing[i];
            center = sum / prevVoicing.length;
        }

        for (let i = 0; i < chordPcs.length; i++) {
            result.push(this.snapToPool(center, [chordPcs[i]]));
        }
        result.sort((a, b) => a - b);

        if (result.length >= 4) {
            let hasCluster = true;
            let iterations = 0;
            while (hasCluster && iterations < 5) {
                hasCluster = false;
                for (let i = 1; i < result.length; i++) {
                    if (result[i] - result[i - 1] <= 2) {
                        result[i] += 12;
                        hasCluster = true;
                        break;
                    }
                }
                if (hasCluster) result.sort((a, b) => a - b);
                iterations++;
            }
        }

        return result;
    }

    public static getDrop2Voicing(voicing: number[]): number[] {
        if (voicing.length < 4) return voicing;
        const result = [...voicing];
        result.sort((a, b) => a - b);
        const dropIdx = result.length - 2;
        result[dropIdx] -= 12;
        result.sort((a, b) => a - b);
        return result;
    }

    public static parseNumeral(numeral: string, tonality?: Tonality): { root: number; quality: ChordQualityEnum; bassOverride?: number } {
        const m = numeral.match(NUMERAL_REGEX);
        if (!m) return { root: 0, quality: ChordQualityEnum.Major };

        const accidental = m[1] ?? '';
        const roman = m[2];
        const suffix = (m[3] ?? '').toLowerCase();
        const upperRoman = roman.toUpperCase();
        const isMinorStr = roman === roman.toLowerCase();

        let root = 0;
        if (upperRoman === 'I')        root = 0;
        else if (upperRoman === 'II')  root = 2;
        else if (upperRoman === 'III') root = 4;
        else if (upperRoman === 'IV')  root = 5;
        else if (upperRoman === 'V')   root = 7;
        else if (upperRoman === 'VI')  root = 9;
        else if (upperRoman === 'VII') root = 11;

        let offset = 0;
        if (accidental === 'b') offset = -1;
        else if (accidental === '#') offset = 1;
        let targetRoot = (root + offset + 12) % 12;

        let quality = isMinorStr ? ChordQualityEnum.Minor : ChordQualityEnum.Major;

        const isMinorTonality =
            tonality !== undefined &&
            (tonality === Tonality.Minor ||
                tonality === Tonality.Minor_Pentatonic ||
                tonality === Tonality.Melodic_Minor ||
                tonality === Tonality.Harmonic_Minor ||
                tonality === Tonality.Phrygian ||
                tonality === Tonality.Dorian ||
                tonality === Tonality.Blues);
                
        if (isMinorTonality && accidental === '') {
            if (upperRoman === 'I')        { quality = ChordQualityEnum.Minor; }
            else if (upperRoman === 'II')  { quality = ChordQualityEnum.Diminished; }
            else if (upperRoman === 'III') { targetRoot = 3; quality = ChordQualityEnum.Major; }
            else if (upperRoman === 'IV')  { quality = ChordQualityEnum.Minor; }
            else if (upperRoman === 'V')   { quality = ChordQualityEnum.Minor; }
            else if (upperRoman === 'VI')  { targetRoot = 8; quality = ChordQualityEnum.Major; }
            else if (upperRoman === 'VII') { targetRoot = 10; quality = ChordQualityEnum.Major; }
        }

        if (suffix.length > 0) {
            if (suffix === 'ø' || suffix === 'm7b5') quality = ChordQualityEnum.HalfDiminished;
            else if (suffix === 'dim7') quality = ChordQualityEnum.Diminished7;
            else if (suffix === 'dim')  quality = ChordQualityEnum.Diminished;
            else if (suffix === 'aug' || suffix === '+') quality = ChordQualityEnum.Augmented;
            else if (suffix === 'maj9') quality = ChordQualityEnum.Major9;
            else if (suffix === 'maj7') quality = ChordQualityEnum.Major7;
            else if (suffix === 'm11')  quality = ChordQualityEnum.Minor11;
            else if (suffix === 'm9')   quality = ChordQualityEnum.Minor9;
            else if (suffix === 'm7')   quality = ChordQualityEnum.Minor7;
            else if (suffix === 'm')    quality = ChordQualityEnum.Minor;
            else if (suffix === 'add9') quality = ChordQualityEnum.Add9;
            else if (suffix === '7sus4') quality = ChordQualityEnum.Dominant7Sus4;
            else if (suffix === 'sus4') quality = ChordQualityEnum.Sus4;
            else if (suffix === '13')   quality = ChordQualityEnum.Dominant13;
            else if (suffix === '11')   quality = ChordQualityEnum.Minor11;
            else if (suffix === '9') {
                quality = isMinorStr ? ChordQualityEnum.Minor9 : ChordQualityEnum.Dominant9;
            }
            else if (suffix === '7') {
                if (quality === ChordQualityEnum.Major) quality = ChordQualityEnum.Dominant7;
                else if (quality === ChordQualityEnum.Minor) quality = ChordQualityEnum.Minor7;
                else if (quality === ChordQualityEnum.Diminished) quality = ChordQualityEnum.Diminished7;
            }
        }

        let bassOverride: number | undefined = undefined;
        if (m[5]) {
            const bassAcc = m[4] ?? '';
            const bassRoman = m[5].toUpperCase();
            let bRoot = 0;
            if (bassRoman === 'I')        bRoot = 0;
            else if (bassRoman === 'II')  bRoot = 2;
            else if (bassRoman === 'III') bRoot = 4;
            else if (bassRoman === 'IV')  bRoot = 5;
            else if (bassRoman === 'V')   bRoot = 7;
            else if (bassRoman === 'VI')  bRoot = 9;
            else if (bassRoman === 'VII') bRoot = 11;

            let bOffset = 0;
            if (bassAcc === 'b') bOffset = -1;
            else if (bassAcc === '#') bOffset = 1;

            if (isMinorTonality && bassAcc === '') {
                if (bassRoman === 'III') bRoot = 3;
                else if (bassRoman === 'VI') bRoot = 8;
                else if (bassRoman === 'VII') bRoot = 10;
            }
            bassOverride = (bRoot + bOffset + 12) % 12;
        }

        return { root: targetRoot, quality, ...(bassOverride !== undefined ? { bassOverride } : {}) };
    }
}
\n```\n\n### File: `${file}`
**Description**: Global music theory and generative engine types.
\n```${lang}\nexport interface NoteData { pitch: number; onset: number; duration: number; velocity: number; isGraceNote?: boolean; isUserMotif?: boolean; }
export interface GeneratedChord { numeral: string; root: number; quality: any; startBeat: number; endBeat: number; keyOffset?: number; bassOverride?: number; isSignatureEnding?: boolean; }
export enum SectionType { Intro = 'intro', Verse = 'verse', PreChorus = 'preChorus', Chorus = 'chorus', Bridge = 'bridge', Outro = 'outro' }
export interface SectionMetadata { name: string; startBeat: number; endBeat: number; energyLevel: number; type?: SectionType; numBars?: any; }

export enum MusicalRole {
    Lead = 'lead',
    Accomp = 'accomp',
    Bass = 'bass',
    Percussion = 'percussion',
    CounterMelody = 'counterMelody'
}

export interface ToneAllocation {
    pitchClass: number; // 0-11
    role: MusicalRole;
    isEssential: boolean; // e.g., root, 3rd, 7th
    isTension: boolean; // e.g., 9, 11, 13
}

export interface GlobalHarmonicFrame {
    startBeat: number;
    endBeat: number;
    chord: GeneratedChord;
    toneAllocations: ToneAllocation[]; // How the chord tones are distributed among roles
    pitchScale: number[]; // The available scale degrees over this chord (0-11)
}

export interface InstrumentConfig {
    id: number;
    name: string;
    minPitch: number;
    maxPitch: number;
    maxPolyphony: number;
    antiMudThreshold: number; // Pitch threshold below which intervals > minor 3rd are needed
    supportsPitchBend: boolean;
    supportsSlide: boolean;
    isMonophonic: boolean;
    capabilities: MusicalRole[];
}

export enum Tonality { Major = 0, Minor = 1 }
export const TonalityName: string[] = ['Major', 'Minor'];
export const SCALE_INTERVALS: number[][] = [];
SCALE_INTERVALS[Tonality.Major] = [0, 2, 4, 5, 7, 9, 11];
SCALE_INTERVALS[Tonality.Minor] = [0, 2, 3, 5, 7, 8, 10];

export enum ChordQuality { Major = 0, Minor = 1, Diminished = 2, Diminished7 = 3, Augmented = 4, Dominant7 = 5, Minor7 = 6, Major7 = 7, HalfDiminished = 8, Sus4 = 9, Dominant7Sus4 = 10, Add9 = 11, Minor9 = 12, Major9 = 13, Dominant9 = 14, Minor11 = 15, Dominant13 = 16 }

export enum ContourType { Upward = 0, Downward = 1, Alternating = 2, Random = 3 }
export enum LHRole { Anchor = 0, Stride = 1, Comp = 2, Arp = 3, Walking = 4 }
export enum RHRole { Block = 0, Arp = 1, Linear = 2, Sparse = 3, Comp = 4 }

export interface PianoMotifDNA {
    voicingPreference: number; // 0 = close, 1 = wide
    rhythmicAnchor: number; // 0 = on-beat, 1 = syncopated
    contour: ContourType;
    densityBaseline: number; // 0.0 to 1.0, where 0 is sparse, 1 is busy
    lhRole: LHRole;
    rhRole: RHRole;
    interlock: number; // 0 = hands together, 1 = independent/hocket
}

export interface GrooveDNA { anchors: number[]; density: number; intensity: number; pianoMotifDNA?: PianoMotifDNA; }

export type HarmonyProgressionPool = Record<string, string[][]>;
export interface StyleHarmonyConfig { major: HarmonyProgressionPool; minor: HarmonyProgressionPool; }

export interface StyleConfig { 
    id?: string;
    name?: string;
    tensionLimits?: number; // Maximum chord extension allowed (e.g. 7 for pop, 13 for jazz)
    drumProbabilities: number[][]; 
    passingChordProb?: number; 
    anticipationProb?: number; 
    densityBaseline?: number; // overall crowdedness
    harmony: StyleHarmonyConfig;
    swingRatio?: number;
}
export enum OutroStrategy {
    FadeOut = 0,
    Ritardando = 1,
    SuddenStop = 2,
    MotifDecay = 3,
    Unresolved = 4
}

export enum RoleType {
    Vocal = 'vocal',
    MainInst = 'mainInst',
    AccompInst = 'accompInst',
    Bass = 'bass',
    Drums = 'drums'
}

export enum IdiomType {
    PopPiano = 0,
    GenericPiano = 4
}

export interface MusicianPersona {
    colorBias: number;      // 0.0 (Triad) to 1.0 (High extensions) - intercepts tension
    sparsityTendency: number; // 0.0 (busy/always play) to 1.0 (sparse/lots of rests)
    contourPreference: ContourType;
    syncopationAssault: number; // 0.0 to 1.0 (On-beat to Syncopated)
    dynamicRange: [number, number]; // e.g. [40, 110]
    signatureLickProb?: number; // Probability of overriding the base idiom (e.g. 0.2 for 20%)
    lickPool?: any[];       // Placeholder for actual specialized motifs
}

export interface MusicianProfile {
    id: string;
    name: string;
    role: RoleType;
    styleId: string; // The musician's native style (used for persona signature licks)
    instrumentId: number;
    persona: MusicianPersona;
    description: string;
}

export interface BandMusician {
    id: string; // Add id to refer back
    role: RoleType;
    styleId: string;
    instrumentId: number;
    persona: MusicianPersona;
}

export interface MusicContext {
    keyOffset: number; tonality: Tonality; bpm: number; timeSignature: [number, number];
    sections: SectionMetadata[];
    globalStyleId?: string; // Add global style reference
    style?: StyleConfig;
    outroStrategy?: OutroStrategy;
    band?: BandMusician[];
    swingRatio?: number;
    melody?: NoteData[];
    harmonicFrames?: GlobalHarmonicFrame[];
    seed?: number;
}
export interface GeneratedTrack {
    chords: GeneratedChord[]; harmonicFrames: GlobalHarmonicFrame[]; melody: NoteData[];
    bpm: number; key: string; keyOffset: number; tonality: Tonality; timeSignature: [number, number]; sections: SectionMetadata[];
    absoluteStartBeat: number; hasIntro: boolean;
}
export interface ArrangedTrack {
    bpm: number; key: string; absoluteStartBeat: number; timeSignature?: [number, number];
    melody: NoteData[]; pianoLH: NoteData[]; pianoRH: NoteData[];
    chords?: GeneratedChord[]; sections?: SectionMetadata[]; palette?: any;
    drums?: NoteData[]; counterMelody?: NoteData[]; secondaryMelody?: NoteData[]; vocal?: NoteData[]; userMotif?: NoteData[]; tempoCurves?: any[];
}
export enum InstrumentType { PIANO_1 = 0, PIANO_2 = 1, BASS = 2, DRUMS = 3 }
\n```\n\n### File: `${file}`
**Description**: Utility wrapper for random numbers.
\n```${lang}\nexport type PRNGSnapshotKey = 'A' | 'B' | 'C' | 'D';
export class PRNG {
    private state: number;
    private lastSeed: number = 0;
    private snapshots: any = {};
    constructor(seed: number) { this.state = seed; this.lastSeed = seed >>> 0; }
    public next(): number {
        this.state = (this.state * 1664525 + 1013904223) % 4294967296;
        return this.state / 4294967296;
    }
    public nextInt(min: number, max: number): number { return Math.floor(this.next() * (max - min + 1)) + min; }
    public nextFloat(min: number, max: number): number { return this.next() * (max - min) + min; }
    public setSeed(seed: number): void { this.state = seed; this.lastSeed = seed >>> 0; this.snapshots = {}; }
    public getInitialSeed(): number { return this.lastSeed; }
    public getState(): number { return this.state; }
    public setState(state: number): void { this.state = state; }
    public recordSnapshot(key: PRNGSnapshotKey): void { this.snapshots[key] = this.state; }
}
export const PRNGManager = new PRNG(0);
\n```\n\n### File: `${file}`
**Description**: Global Tailwind CSS styles.
\n```${lang}\n@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;1,500&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
@import "tailwindcss";

@theme {
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-serif: "Cormorant Garamond", ui-serif, Georgia, serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
}

.acg-gradient { 
  background: linear-gradient(135deg, #FFEFD5 0%, #E6EAD3 100%); 
}

.glass { 
  background: rgba(255, 255, 255, 0.4); 
  backdrop-filter: blur(8px); 
  border: 1px solid rgba(255, 255, 255, 0.6); 
}
\n```\n\n### File: `${file}`
**Description**: React DOM rendering entry point.
\n```${lang}\nimport {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
\n```\n\n### File: `${file}`
**Description**: Vite types.
\n```${lang}\n/// <reference types="vite/client" />

declare module '*?url' {
  const src: string
  export default src
}
\n```\n\n### File: `${file}`
**Description**: Entry script for standalone testing.
\n```${lang}\nimport { MusicTheory, Tonality } from './src/core/generation/theory/MusicTheory';
import { GlobalVoicer } from './src/core/generation/harmony/GlobalVoicer';
import { IdiomUtils } from './src/core/generation/idioms/IdiomUtils';

const chord_i = { numeral: 'i', root: 0, quality: 1, startBeat: 0, endBeat: 4 };
const frame_i = GlobalVoicer.createHarmonicFrames([chord_i]);
const allocs = frame_i[0].toneAllocations.filter(t => t.role === 'accomp').map(t => t.pitchClass);

const voicing = IdiomUtils.calculateVoicing(chord_i, [], 0.5, undefined, allocs);
console.log('voicing i:', voicing.rhVoicing.map(v => v % 12));

const chord_iv = { numeral: 'iv', root: 5, quality: 1, startBeat: 4, endBeat: 8 };
const frame_iv = GlobalVoicer.createHarmonicFrames([chord_iv]);
const allocs_iv = frame_iv[0].toneAllocations.filter(t => t.role === 'accomp').map(t => t.pitchClass);

const voicing_iv = IdiomUtils.calculateVoicing(chord_iv, voicing.rhVoicing, 0.5, undefined, allocs_iv);
console.log('voicing iv:', voicing_iv.rhVoicing.map(v => (v%12+12)%12));
\n```\n\n### File: `${file}`
**Description**: Script to score harmonic generation penalties.
\n```${lang}\nimport { ChordQualityEnum, MusicTheory } from './src/core/generation/theory/MusicTheory';

const chords = [
    { root: 0, quality: ChordQualityEnum.Minor9 } as any,
    { root: 5, quality: ChordQualityEnum.Dominant13 } as any,
    { root: 10, quality: ChordQualityEnum.Major9 } as any,
    { root: 2, quality: ChordQualityEnum.Minor9 } as any,
    { root: 7, quality: ChordQualityEnum.Dominant13 } as any,
    { root: 0, quality: ChordQualityEnum.Major9 } as any,
    { root: 5, quality: ChordQualityEnum.Minor11 } as any,
];

function calculateVoicing(
        chord: any,
        currentVoicing: number[],
        sectionVoicingSpan: number
    ): { rhVoicing: number[], actualBassPc: number, bassPitch: number, intervals: number[] } {
        const intervals = MusicTheory.getChordTones(chord.quality);
        const isAdvanced = intervals.length >= 4;
        
        let corePitches: number[] = [];
        let extPitches: number[] = [];
        for (let j = 0; j < intervals.length; j++) {
            if (isAdvanced && intervals[j] === 0) continue; // Rootless 
            let pitch = chord.root + intervals[j];
            if (intervals[j] < 12 && corePitches.length < 4) {
                corePitches.push(pitch);
            } else {
                extPitches.push(pitch);
            }
        }
        if (corePitches.length === 0) corePitches.push(chord.root);

        let prevCenter = 0;
        if (currentVoicing.length > 0) {
            prevCenter = currentVoicing.reduce((a, b) => a + b, 0) / currentVoicing.length;
        }

        let bestVoicing: number[] = [];
        let bestDist = Infinity;
        let bestOct = 0;

        for (let inv = 0; inv < corePitches.length; inv++) {
            let invCore = [...corePitches];
            for (let i = 0; i < inv; i++) {
                invCore[i] += 12;
            }
            invCore.sort((a,b) => a - b);

            let penalty = 0;
            if (invCore.length > 1 && (invCore[1] - invCore[0] <= 2)) penalty = 12; // High penalty for minor 2nd at the bottom
            
            for (let oct = -1; oct <= 1; oct++) {
                let candidate = invCore.map(p => p + (oct * 12));
                let center = candidate.reduce((a,b) => a + b, 0) / candidate.length;
                let dist = Math.abs(center - prevCenter) + Math.abs(center) * 0.1 + penalty;
                if (dist < bestDist) {
                    bestDist = dist;
                    bestVoicing = candidate;
                    bestOct = oct;
                }
            }
        }

        let outVoicing = [...bestVoicing];
        for (let ext of extPitches) {
            let target = ext + (bestOct * 12);
            while (target < outVoicing[0] + 3) target += 12;
            while (target > outVoicing[0] + 16) target -= 12;
            outVoicing.push(target);
            outVoicing.sort((a, b) => a - b);
        }

        const rawVoicing = outVoicing;
        let finalVoicing = sectionVoicingSpan > 0.6 ? MusicTheory.getDrop2Voicing(rawVoicing) : rawVoicing;

        const actualBassPc = chord.bassOverride !== undefined ? chord.bassOverride : chord.root;
        const bassPitch = actualBassPc - 24;

        return { rhVoicing: finalVoicing, actualBassPc, bassPitch, intervals };
    }

let currentVoicing: number[] = [];
for (const chord of chords) {
    const { rhVoicing } = calculateVoicing(chord, currentVoicing, 0.9);
    currentVoicing = rhVoicing;
    console.log(rhVoicing, "Center:", rhVoicing.reduce((a:number,b:number)=>a+b,0)/rhVoicing.length);
}
\n```\n\n### File: `${file}`
**Description**: Typescript configuration.
\n```${lang}\n{
  "compilerOptions": {
    "target": "ES2022",
    "experimentalDecorators": true,
    "useDefineForClassFields": false,
    "module": "ESNext",
    "lib": [
      "ES2022",
      "DOM",
      "DOM.Iterable"
    ],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "isolatedModules": true,
    "moduleDetection": "force",
    "allowJs": true,
    "jsx": "react-jsx",
    "paths": {
      "@/*": [
        "./*"
      ]
    },
    "allowImportingTsExtensions": true,
    "noEmit": true
  }
}
\n```\n\n### File: `${file}`
**Description**: Vite build configurations.
\n```${lang}\nimport tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
\n```\n\n