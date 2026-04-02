# AuraFlow Core Architecture & ESP32-S3 Porting Guide

## Version Info
- **Current Version:** 1.34.0
- **Last Updated:** 2026-04-02
- **Update Log:**
  - `v1.34.0`: **Pipeline Rule Full Compliance — S-2/T-3/D-4/T-4 Violations Zeroed.**
    1. **S-2 GlobalContext Decoupling (Complete)**: Removed ALL `GlobalContext` imports, reads, and writes from `/src/core/generation/`. Context is now passed explicitly via `MusicContext` return values, `TextureRenderContext` parameters, `BassIdiomContext` fields, and method parameter chains. `initializeNewEra()` and `updateCurrentSlice()` calls removed from MelodyEngine, ToplineEngine, and Orchestrator.
    2. **Bass Idiom S-2 Compliance**: Added `beatsPerBar`, `activeSection`, `keyOffset`, `grooveDNA` to `BassIdiomContext`. Extracted `isGrooveHit`/`isLayeringHit`/`isInterleavingHit` as pure static methods on `BaseBassIdiom`, replacing GlobalContext singleton calls.
    3. **HarmonyCore S-2 Compliance**: Added `tonality` and `keyOffset` parameters to `generateHarmonyTimeline`, `generateDynamicProgression`, `generateFromFunction`, and `applyStyleSpices`. All 14 internal `GlobalContext.currentTonality`/`currentKeyOffset` reads replaced.
    4. **T-3 `any` Type Elimination**: Defined `IdiomPreferences` and `RuntimeIdiomPreferences` interfaces in `types.ts`. Replaced ~30 occurrences of `idiomPreferences?: any` across all Performance Idioms, Bass/Drum Idiom contexts, and `InstrumentIdiom` dispatcher.
    5. **D-4 Float Epsilon Compliance**: Replaced ~22 floating-point `===` comparisons with `Math.abs(x - target) < 1e-6` across drum/bass/piano/vocal/transition idioms.
    6. **T-4 Type Assertion Cleanup**: Removed redundant `as` casts on now-typed `idiomPreferences`, narrowed `passingType as any` to concrete union type with safety comments.
  - `v1.33.0`: **Global Sprint Retrospective & Next-Gen Polish.**
    1. **Motif Development (Plan A)**: Added advanced motif transformations (`_split`, `_merge`, `_shift`) to `ToplineEngine.ts` to make melodies more human-like and memorable.
    2. **Passing Chords & Voice Avoidance (Plan B)**: Added `truncateToChordEnd` in `TextureMapper.ts` to strictly prevent Bass, CounterMelody, and ChordTexture notes from bleeding into passing chords, eliminating vertical clashes.
    3. **Dynamic Drum Fills (Plan C)**: Upgraded `TransitionEngine.ts` to use `energyDelta` to dynamically scale fill complexity and density (e.g., 32nd note linear fills for huge energy jumps).
  - `v1.32.3`: **Critical Bug Fix: Inverted Relative Minor Logic & Double Flattening.**
    1. **Inverted Relative Minor Logic**: Fixed a bug in `HarmonyCore.generateHarmonyTimeline` where `isRelativeMinor` was calculated backwards (true for minor progressions, false for major progressions). This caused major progressions in minor keys to NOT be shifted to the relative major, and minor progressions to be incorrectly shifted. Renamed variables to `isMinorProgression` and `isRelativeMajorProgression` to clarify intent and fixed the boolean logic.
    2. **Double Flattening of Accidentals**: Fixed a bug in `HarmonyCore.parseRomanNumeral` where explicit accidentals like `bVI` in minor keys were double-flattened (e.g., `bVI` in C minor became G major instead of Ab major). The natural flattening of III, VI, and VII in minor keys is now only applied if there is no explicit accidental (`rootOffset === 0`).
  - `v1.32.2`: **Critical Bug Fix: Double Key Offset & Minor Tonality Root Calculation.**
    1. **Double Key Offset Fix**: Reverted the changes from `v1.32.1` that passed `GlobalContext.currentKeyOffset` to `HarmonyCore.getSafeScalePitches`. The generation engines (`ToplineEngine`, `TextureMapper`, etc.) are designed to generate pitches relative to C, and `Orchestrator` applies the `keyOffset` globally at the end of the pipeline. Passing `keyOffset` to `getSafeScalePitches` caused the scale to be shifted twice, resulting in severe out-of-tune melodies (e.g., generating in D Major instead of Db Major).
    2. **Minor Tonality Root Fix**: Fixed a critical bug in `HarmonyCore.parseRomanNumeral` where `root += 3` was incorrectly applied to all chords when `tonality === 'Minor'`. This caused chords in minor keys to be generated relative to the relative major (e.g., `i` in C Minor became Eb Minor). Corrected the logic to naturally flatten `III`, `VI`, and `VII` in minor keys, ensuring `i` correctly maps to root 0.
  - `v1.32.1`: **Bug Fixes: Scale Clash, Grid Collapse, and Chord Pad Leak.**
    1. **Major/Minor Scale Clash Fix**: Fixed a critical bug where `HarmonyCore.getSafeScalePitches` was not receiving the `GlobalContext.currentKeyOffset`, causing the melody engine to default to C Major/Minor scales regardless of the actual song key. Passed `GlobalContext.currentKeyOffset` to all `getSafeScalePitches` calls across `ToplineEngine`, `Orchestrator`, `TextureMapper`, `GlobalReviewer`, and various Idioms.
    2. **Grid Collapse Fix**: Fixed an issue where unquantized floating-point durations and onsets were causing rhythmic instability ("drunk robot" effect). Added mandatory grid snap (`Math.round(val / 0.25) * 0.25`) to both `onset` and `duration` in `PlaybackEngine.ts` before generating MIDI events.
    3. **Verse_2 Chord Pad Leak Fix**: Removed the "Dynamic F-M-B Role Swapping" logic in `Orchestrator.ts` that was incorrectly swapping chord notes into the melody track during `Verse_2` and `Break` sections, causing the melody instrument to play block chords instead of a monophonic line.
  - `v1.32.0`: **Dynamic Phrase Structure Generation (Mood-Driven).**
    1. **Mood Integration**: Added `phraseActionBias` to `MoodConfig` in `MoodFlags.ts` to define the probabilities of [Repeat, Vary, Contrast] for phrase generation based on the selected mood (e.g., Euphoric is highly repetitive, Melancholic has more contrast).
    2. **ToplineEngine Update**: Replaced hardcoded phrase `FORMS` with a dynamic generation system in `ToplineEngine.ts`. Phrase labels (A, B, A_prime, C, etc.) are now generated probabilistically using the mood's `phraseActionBias`.
    3. **Resolution Logic**: Updated `isAnswer` logic to handle dynamically generated phrase labels and implemented a smart resolution mechanism that forces a strong resolution if there are consecutive unresolved phrases.
  - `v1.31.0`: **Affective-Biased Adaptive Engine (Mood + Style).**
    1. **Mood Integration**: Introduced `MoodId` and `MoodConfig` to decouple BPM, density, and energy caps from rigid `StyleConfig`s.
    2. **MelodyEngine Update**: `MelodyEngine` now applies `Mood` multipliers to dynamically calculate the final BPM and biases tonality selection (e.g., Melancholic favors Minor).
    3. **StructureEngine Update**: `StructureEngine` now applies `Mood` energy caps and density multipliers to the generated sections.
    4. **Dynamic Idiom Routing**: `TextureMapper` now selects Idioms (Bass, Drums, Piano, CounterMelody) based on the *actual* generated BPM and Energy Level, rather than strictly following the style's default preferences. This allows for "slow/sad EDM" or "fast/aggressive Ballads" without creating contradictory idiom selections.
  - `v1.30.5`: **Fix Undefined Variables & Linter Errors.**
    1. **TextureMapper Fix**: Defined missing `isCinematic` and `isBallad` variables using `StyleId` before passing them to the `BassIdiomContext`.
    2. **VocalHarmony Fix**: Added `vocalStyle` to `idiomPreferences` in `types.ts` and updated `generateVocalHarmony` in `TextureMapper.ts` to use it instead of the removed `stringStyle`.
    3. **PlaybackEngine Fix**: Updated `InteractivePlaybackEngine`, `LiveLoopingEngine`, and `PlaybackEngine` to use `styleId` directly for determining the mix style, replacing the outdated `drumStyle` string comparisons and removing references to non-existent `StyleId`s.
  - `v1.30.4`: **Idiom Refactoring (Characteristic-Based Naming).**
    1. **Renaming**: Renamed genre-based idioms to characteristic-based idioms (e.g., `PopBassIdiom` -> `SteadyBassIdiom`, `FunkDrumIdiom` -> `SyncopatedDrumIdiom`, `PopCounterMelodyIdiom` -> `SustainedCounterMelodyIdiom`, `JazzCounterMelodyIdiom` -> `MelodicCounterMelodyIdiom`).
    2. **Registry Updates**: Updated `CounterMelodyIdiomRegistry`, `BassIdiomRegistry`, `DrumIdiomRegistry`, and `PianoIdiomRegistry` to use the new characteristic-based names and removed hardcoded fallback logic, relying on dynamic registration.
    3. **Style Configuration**: Updated all style configuration files (`PopStyles.ts`, `CinematicStyles.ts`, `ElectronicStyles.ts`, `BalladStyles.ts`, `RockStyles.ts`, `LofiStyles.ts`) to use characteristic-based idiom preferences (e.g., `counterMelodyStyle: 'sustained'`).
    4. **Logic Updates**: Updated `TextureMapper.ts`, `EnsembleDrafter.ts`, `GrammarRegistry.ts`, and `HarmonyCore.ts` to use `StyleId` instead of idiom names for determining style-specific logic (e.g., `isEDM`, `isCinematic`).
  - `v1.30.3`: **Fix Build Errors & Clean Up Unused Styles.**
    1. **DynamicChoirIdiom**: Created missing `DynamicChoirIdiom.ts` to resolve Vite build error in `VocalHarmonyIdiomRegistry.ts`.
    2. **StyleId Cleanup**: Removed references to undefined `StyleId`s (`SmoothJazz`, `NeoSoul`, `BossaNova`, `IndieRock`, `PostRock`) from `Orchestrator.ts` and `StructureEngine.ts`.
    3. **Config Cleanup**: Removed invalid `humanizeAmount` property from `ElectronicStyles.ts` and `LofiStyles.ts`.
    4. **Context Cleanup**: Removed unused `melodyNotes` property from `BassIdiomContext` usage in `PopBassIdiom.ts`.
  - `v1.30.2`: **Revert Melody & Crossover Features.**
    1. **Reverted Melody Contour & Resolution**: Removed the `range` enhancement, `Global Resolution Logic`, and `Linearity Rule for Complex Chords` from `ToplineEngine.ts`.
    2. **Reverted Texture Allocation & Fusion Cohesion**: Removed `TextureAllocation`, `GrooveMask`, and `FusionProfile` from `types.ts`, `GlobalContext.ts`, `StructureEngine.ts`, `TextureMapper.ts`, and all idiom files.
  - `v1.30.1`: **Melody Generation Refinement (Contour & Resolution).**
    1. **Contour Enhancement**: Increased the `range` parameter in `ToplineEngine.ts` to allow for more distinct and expressive melodic shapes (Ascending, Descending, Arch, Bowl, etc.). Improved the logic for `Static` and `Wandering` contours to be more mathematically sound and musically pleasing.
    2. **Global Resolution Logic**: Implemented a global resolution check in `ToplineEngine.ts` for phrase endings (`isAnswer`). If the current chord is tense or non-diatonic (e.g., in Dark Pop), the melody now prioritizes resolving to the global tonic's stable tones (1, 3, 5) if they are compatible with the current chord, rather than blindly resolving to the local chord's root.
    3. **Linearity Rule for Complex Chords**: Added a specific rule in `ToplineEngine.ts` to enforce stepwise motion (diatonic steps) when playing over complex chords (e.g., Minor9, Add9, HalfDiminished). This prevents the melody from jumping around weird chord extensions and maintains a smooth, independent melodic line that anchors the harmony.
  - `v1.30.0`: **Texture Allocation & Fusion Cohesion (Music Fusion Refinement).**
    1. **Texture Allocation Integration**: Added `TextureAllocation` interface to `types.ts` to manage the density of different musical elements (bass, chords, drums, melody). Integrated this into `SectionMetadata` and `GlobalContext`.
    2. **Density Control in Idioms**: Updated `TextureMapper.ts` to apply `textureAllocation` multipliers to `grooveDensity` for bass, drums, and piano generation. This allows for section-specific, dynamic control over the rhythmic activity and complexity of each instrument group.
    3. **Fusion Cohesion**: Refined fusion logic in `TextureMapper.ts` and `StructureEngine.ts` to ensure that when a `fusionProfile` is active, the selected fusion style is consistently applied to the designated instrument roles (e.g., rhythm section vs. harmonic section), preventing chaotic, independent idiom selection and maintaining a unified musical output. Fixed TypeScript errors related to `StyleId` enum usage in fusion profile generation.
  - `v1.29.0`: **Groove Parameter Integration (Music Fusion Refinement).** 
    1. **Context Updates**: Added `grooveDensity` and `grooveSyncopation` to `PianoIdiomContext`, `DrumIdiomContext`, and `BassIdiomContext` to allow idioms to react to the global groove parameters.
    2. **Idiom Adaptation**: Updated all Piano, Drum, and Bass idioms (e.g., `PopPianoIdiom`, `FunkDrumIdiom`, `ReggaeBassIdiom`) to utilize these parameters for probabilistic note placement, syncopation, fill generation, and velocity adjustments, enhancing musicality and reducing repetitive patterns.
    3. **TextureMapper Refinement**: Updated `TextureMapper.ts` to pass the groove parameters from `GlobalContext` to the idiom contexts. Refined fusion logic to exclude certain "merged" or "alias" idioms for more coherent cross-genre fusions.
    4. **StyleGrammar Enhancements**: Added `tailResolution`, `preferredScales`, `repetitionProbability`, `maxLeap`, `maxTensionPerPhrase`, and `pitchWeights` to `StyleGrammar.melodyRules` to allow for more nuanced, style-specific melody generation. Updated `EDMGrammar`, `FolkGrammar`, `JazzGrammar`, and `RockGrammar` to reflect these changes.
  - `v1.28.2`: **Debugging Mode: Removed All Sound Effects.** Completely removed all special audio effects to simplify the audio pipeline and focus on core MIDI generation. Removed `applyEDMIntroSweep` and `triggerEDMDropEnding` from `AudioMixer.ts` and `PlaybackEngine.ts`. Removed the entire Lo-Fi DSP chain (`lofiBitcrusher`, `lofiBandpass`, `lofiGainComp`) from `AudioMixer.ts`. Removed the Tape Wow & Flutter (LFO Pitch Bend) logic and Reverse Cymbal interception from `PlaybackEngine.ts`. Removed `lofiEffect` flag from `StructureEngine.ts`, `ToplineEngine.ts`, and `types.ts`.
  - `v1.28.1`: **Debugging Mode: Intro Sections Disabled.** Temporarily disabled the generation of all "Intro" sections in `StructureEngine.ts` to facilitate faster debugging and testing of core song sections (Verse, Chorus, etc.). The song structure now immediately begins with the first active section (e.g., Verse_1 or Chorus_1) at beat 0.
  - `v1.28.0`: **Sprint 2: Ritardando & Trading Fours.** 
    1. **Ritardando (Non-linear tempo deceleration)**: Upgraded `MidiScheduler.ts` to use `requestAnimationFrame` for smooth, jitter-free timing. Added `TempoCurve` support to dynamically interpolate BPM. Implemented logic in `Orchestrator.ts` to apply an exponential tempo curve (slowing down by 40%) over the last 2 bars of the Outro for appropriate styles (Ballad, Jazz, NeoSoul, etc.).
    2. **Trading Fours (Call & Response)**: Introduced a "Call & Response State Machine" in `Orchestrator.ts`. For Jazz and Blues styles, during `Solo_Bridge` sections, the melody is automatically split into 4-bar chunks, alternating between the primary and secondary melody instruments (e.g., Electric Piano and Saxophone) to simulate a live jam session.
  - `v1.27.0`: **Outro Generation Overhaul.** Implemented advanced outro generation logic based on the "Reconstruction Blueprint".
    1. **Thematic Echo (Motif Fragmentation)**: Added `generateFadingEchoOutro` to `ToplineEngine.ts` to extract the core motif from the chorus hook, fragment it (randomly dropping notes, delaying onsets for a rubato feel, extending durations), and linearly decrease velocity to simulate a fading memory.
    2. **Jazz/R&B Signature Ending**: Added `injectJazzSignatureEnding` to `HarmonyCore.ts` to force a `maj9#11` chord voicing at the end of the outro for Jazz/R&B styles. Integrated MIDI CC 64 (Sustain Pedal) in `PlaybackEngine.ts` to create a romantic, lingering sound.
    3. **EDM/Synthwave Signature Ending**: Added `triggerEDMDropEnding` to `AudioMixer.ts` and triggered it in `PlaybackEngine.ts` for EDM styles. Uses the Web Audio API to generate a short white noise buffer with a low-pass filter (exponential frequency ramp down) and a gain envelope to simulate a massive sound decay.
  - `v1.26.0`: **Intro Generation Overhaul.** Implemented a comprehensive overhaul of the intro generation logic based on the "Reconstruction Blueprint". 
    1. **Acoustic Triangle**: Replaced the random "naked solo" logic in `Orchestrator.ts` with a state machine that enforces harmonic support (melody + chords + bass) based on style and energy level.
    2. **Thematic Foreshadowing**: Added `extractForeshadowingIntro` to `ToplineEngine.ts` to extract and simplify the main Chorus hook, using it as the intro melody to create thematic cohesion. Integrated this into `Orchestrator.ts` with a 60% probability.
    3. **Signature Riff Generator**: Added `generateSignatureRiff` to `TextureMapper.ts` to create catchy, syncopated pentatonic riffs for specific styles (Eurodance, Trance, Synthwave, PopRock, IndieRock) during intros.
    4. **EDM Filter Sweep**: Implemented a Web Audio API-based lowpass filter sweep (`applyEDMIntroSweep`) in `AudioMixer.ts` and triggered it in `PlaybackEngine.ts` for EDM styles during the intro section, simulating a classic rising effect with minimal CPU overhead.
  - `v1.25.0`: **Lo-Fi Aesthetic & DSP Chain Implementation.** Implemented a "defect as a feature" approach for the ESP32-S3. Added `StyleId.Lofi` and `LofiHipHopStyle` configuration. Implemented "Tape Wow & Flutter" via LFO-driven MIDI Pitch Bend events in `PlaybackEngine.ts` and `MidiScheduler.ts`, avoiding heavy DSP pitch shifting. Implemented "Dilla Groove" in `DrumIdiom.ts` with micro-timing offsets and velocity randomization. Added a highly optimized Lo-Fi Master Bus in `AudioMixer.ts` using native Web Audio nodes (`WaveShaperNode` for bitcrushing, `BiquadFilterNode` for telephone EQ) to simulate vintage sampler degradation with O(1) CPU overhead.
  - `v1.24.0`: **100% Idiom Extraction Complete.** Extracted the remaining hardcoded generation logic from `TextureMapper.ts` (`generateCounterMelody`, `generateRiff`, `generateVocalHarmony`) into their respective dedicated idiom registries (`CounterMelodyIdiomRegistry`, `RiffIdiomRegistry`, `VocalHarmonyIdiomRegistry`). `TextureMapper.ts` is now a pure delegator, acting solely as a time-grid and chord provider. All style-specific logic is fully encapsulated within individual idiom classes (e.g., `PopCounterMelodyIdiom`, `GospelVocalHarmonyIdiom`), achieving complete adherence to the Open-Closed Principle and maximizing C++ portability.
  - `v1.23.0`: **Piano Idiom Decoupling.** Extracted all piano comping and texture generation logic from `TextureMapper.ts` into a dedicated `PianoIdiomRegistry` and individual `IPianoIdiom` implementations (e.g., `PopPianoIdiom`, `BossaPianoIdiom`, `FunkPianoIdiom`, `ReggaePianoIdiom`, `ElectronicPianoIdiom`). `TextureMapper.generateChordTexture` now delegates the heavy lifting of note generation to the registered idiom based on the current style. This removes massive `if/else` blocks, significantly improving code maintainability, testability, and adherence to the Open-Closed Principle, further paving the way for easier C++ porting of isolated rhythmic styles.
  - `v1.22.0`: **Grammar Delegation (Melody & Harmony Rules).** Removed hardcoded melodic rules from `ToplineEngine.ts` and `GlobalReviewer.ts`. The engine now dynamically reads `maxJumpInterval`, `chromaticPassingProbability`, and `leapResolutionThreshold` from `StyleConfig.melody`. This ensures that melodic generation (e.g., chromatic enclosures, maximum leap intervals) and global review (e.g., leap resolution enforcement) strictly adhere to the specific style's grammar, improving stylistic accuracy and C++ configuration portability.
  - `v1.21.0`: **Drum Idiom Decoupling.** Extracted all drum generation logic from `TextureMapper.ts` into a dedicated `DrumIdiomRegistry` and individual `IDrumIdiom` implementations (e.g., `PopDrumIdiom`, `EurodanceDrumIdiom`, `JazzDrumIdiom`, etc.). `TextureMapper.generateDrumGroove` now purely acts as a delegator, passing a standardized `DrumIdiomContext` to the registered idiom. This eliminates the massive `if/else` block, significantly improving code maintainability, testability, and adherence to the Open-Closed Principle, paving the way for easier C++ porting of isolated rhythmic styles.
  - `v1.20.0`: **Refactoring for Style Purity.** Completely eliminated `StyleFlags` and `StyleFlagTable` from the codebase to achieve a pure, data-driven approach. Style-specific logic (idioms, mixing preferences, harmonic rules) is now entirely externalized into `StyleConfig` objects (e.g., `idiomPreferences.drumStyle`, `mixingPreferences.requireSidechain`). This ensures that core engines (`TextureMapper`, `TransitionEngine`, `Orchestrator`, `PlaybackEngine`, `HarmonyCore`) are agnostic to specific genres, relying solely on configuration parameters. Fixed missing properties in `MixingConfig` and updated `InstrumentManager` to accept optional mixing parameters. This significantly improves extensibility and C++ portability by removing hardcoded bitmask checks in favor of structured configuration data.
  - `v1.19.3`: Refined Eurodance and EDM Groove generation. In `TextureMapper.ts`, increased bassline quantization precision by changing the loop step from `0.5` to `0.25`. Implemented genre-specific bass idioms: "Gallop" rhythms and "Strict Off-beat Bass" for Eurodance, "Rolling 16th" for Trance, and "Driving 8th/16th" for Synthwave. Bypassed `isRiffDriven` and `isBassSolo` logic for these genres to ensure strict pattern adherence. Disabled chromatic bass approaches and random pedal points for EDM styles to maintain root stability. In `Orchestrator.ts`, enforced strict quantization using `StyleFlags.STRICT_GRID`. In `PlaybackEngine.ts`, implemented a "Fake Sidechain" effect using MIDI CC 11 (Expression) automation triggered by kick drums for styles with `StyleFlags.REQUIRE_SIDECHAIN`, ducking the bass, chord, and counter-melody tracks to simulate the characteristic EDM "pump".
  - `v1.19.2`: Refined Melody Generation Engine (`ToplineEngine.ts`) to enforce strict rhythm quantization (`validDurations = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0]`), eliminating arbitrary math that destroyed the grid. Fixed `legatoDuration` to respect the quantized duration. Adjusted `SingerPersona.ts` to use a clean `0.25` duration for grace notes instead of `0.08`. In `Orchestrator.ts`, forced `melody.pan = 0` globally for a centered lead, and prioritized `Acoustic_Guitar_Nylon` or `Electric_Piano_1` over `Alto_Sax` for Pop styles. In `TextureMapper.ts`, enforced whole-note durations for `Pad` and `Sustained` textures and implemented a "fake sidechain" effect by reducing pad velocity when the main melody is active.
  - `v1.19.1`: Enhanced console logging in `PlaybackEngine.ts` to include the bass track (`pianoLH`) and display the duration of each note alongside its pitch (e.g., `C4(0.5)`). This improves debugging and visualization of the generated arrangement.
  - `v1.19.0`: Implemented "Chip-Level Algorithmic Mixing Rules" for ESP32-S3 optimization. Added Zone Isolation in `Orchestrator.ts` to prevent low-frequency muddiness (Bass E1-B2, PianoRH/CounterMelody >= C3). Implemented Fake Sidechaining in `PlaybackEngine.ts` using MIDI CC 11 (Expression) automation for EDM/Pop kicks. Added Dynamic Panning (CC 10) and Reverb (CC 91) mapping based on section `energyLevel` (1-8) to create a "stage lighting automation system". Enforced Static Gain Staging (CC 7) across all 7 instrument roles based on priority tiers (T0-T4). Configured Master DSP (HPF, Peaking EQ, High Shelf, Compressor) in `AudioMixer.ts` as a cohesive "glue" for the mix.
  - `v1.18.0`: Refactored PRNG usage across the entire codebase. Replaced all instances of `globalPRNG` with `PRNGManager` to enforce strict deterministic behavior and snapshot capabilities (`getState`/`setState`). This fulfills the PRNG constraint for C++ portability. Updated `AURA_ARCHITECTURE.md` to include the core development system instructions.
  - `v1.17.0`: Comprehensive refactoring to replace string-based style identifiers with the `StyleId` enum across the entire codebase. Introduced `StyleFlags` and `StyleFlagTable` in `StyleFlags.ts` for efficient, bitmask-based style categorization and capability checking. Updated all core generation modules (`Orchestrator`, `TextureMapper`, `HarmonyCore`, `EnsembleDrafter`, `TransitionEngine`) and audio engines (`InteractivePlaybackEngine`, `LiveLoopingEngine`, `PlaybackEngine`) to utilize `StyleId` and flag-based logic, eliminating error-prone `.includes()` string comparisons and significantly improving type safety and C++ portability.
  - `v1.16.0`: Overhauled Melody Generation Engine in `ToplineEngine.ts`. Implemented Grammar-Based Rhythm Generation (Pick-up, Body, Tail) via `StyleGrammar`. Added Micro-Mutation Operators (Split, Merge, Shift) for motif variation. Integrated 5 Advanced Melodic Principles: "9th is the New Root" (PitchWeights), Meyer's Leap Rule & Interval Penalty, Syncopation Shift (Anticipation), Pentatonic Gap, and Tessitura Management with Golden Ratio Climax. Added Safeguards: Dissonance Budget (maxTensionPerPhrase) and Tail Resolution.
  - `v1.15.3`: Refined Drum Groove based on energy levels and grooveRatio (filtered Crash/Toms in low energy, downgraded Ride/OHH to CHH, upgraded CHH to Ride/OHH in high energy). Added Bossa Nova (Syncopated Chords) and EDM (Staccato Chords) comping styles to PianoIdiom. Added Pluck style (Staccato & Delay) to SynthIdiom.
  - `v1.15.2`: Expanded Instrument Idioms (P1). Added Stylistic Comping for PianoIdiom (Jazz Grace Notes/Ghost Chords, Pop Arpeggiated Fills). Created SynthIdiom for Synth/Pad/Lead/Arp with specific techniques (Arpeggiator, Glide/Vibrato, Pad Swell/Release). Added Arpeggio logic to GuitarIdiom for low energy sections or explicit arpeggio style.
  - `v1.15.1`: Fixed critical pitch clamping bugs (e.g., A8, C#17) in `ToplineEngine.ts` by replacing `if` statements with `while` loops to ensure pitches strictly fall within the instrument's safe range, preventing octave overflows. Verified `chordKeyOffset` application in `Orchestrator.ts` to prevent double-shifting.
  - `v1.15.0`: Implemented Layered Style-Aware Arrangement system. Added P0 Universal Foundations (Low-Frequency Guard, Melodic Key-Tone Evasion, Master Groove Grid). Added P1 Style-Specific Extensions (Style-Aware Arrangement Dynamics in Orchestrator, Instrument Idiom Engine for Bass). Added P2 Groove Ratio Controller to dynamically adjust instrument presence and texture based on style and energy. Implemented P2 Vocal Harmony Module to generate style-specific vocal harmonies (Pop/Ballad, R&B/Gospel).
  - `v1.14.0`: Addressed systemic harmonic issues in complex genres (Jazz, Neo-Soul, R&B). Refactored `applyStyleSpices` to respect functional harmony (e.g., restricting `VI7` to only appear before `ii`, and `m7b5` to appropriate scale degrees). Fixed "hanging passing chords" in `generateHarmonyTimeline` by strictly validating the next section's starting chord before inserting diminished or secondary dominant passing chords. Introduced "Turnaround" logic (e.g., `ii-V`, Plagal Cadence) at the end of 4/8 bar loops to break mechanical repetition. Replaced random Outro generation for Jazz/Soul with fixed, stylistically appropriate progressions (e.g., Tadd Dameron Turnaround, extended `ii-V-I`).
  - `v1.13.0`: Fixed critical harmonic instability and "Outro Disaster" issues. Enforced strict tonality checks in `HarmonyCore.ts` to prevent incorrect major/minor chord spices (e.g., `i` to `Iadd9` in minor keys). Implemented "look-ahead" target-oriented logic for passing chords (`vii°`, `III7`) to ensure proper resolution. Added Cadence awareness to force `V7` or `Vsus4` at the end of Chorus sections. Established strict style isolation for EDM genres (Trance, Eurodance, Synthwave) by disabling reharmonization and passing chords to maintain genre purity.
  - `v1.12.0`: Added Eurodance, Trance, and Synthwave styles to `ElectronicStyles.ts`. Updated `TextureMapper.ts` to support EDM specific drum (Four-on-the-floor, off-beat hi-hats, rolling hats) and bass (off-beat, rolling, driving 8th) patterns. Refined `ToplineEngine.ts` to support EDM specific melody generation and syncopation resolution.
  - `v1.11.0`: Verified and completed Phase 1, 2, and 3 of stylistic refinement. Added `isRock` and `isPop` fencing in `TextureMapper.ts` for straight rhythms and triads. Implemented `getSmoothVoicing` in `HarmonyCore.ts` for nearest-inversion voice leading. Added `Melodic_Minor` tonality, Rootless Voicings for Jazz, and a dedicated Jazz Swing drum pattern in `TextureMapper.ts`.
  - `v1.10.0`: Refined key offset logic across the generation pipeline (`ToplineEngine.ts`, `TextureMapper.ts`, `Orchestrator.ts`) to correctly handle section-specific `localKeyOffset` and global `currentKeyOffset` without double-shifting pitches. Added `Bossa_Nova` and `Jazz` styles with correct configuration.
  - `v1.9.1`: Refined Aura Bar layout to use ResizeObserver for full proportional responsive scaling across all screen sizes.
  - `v1.9.0`: Refactored "Aura Radio" to "Aura Bar" with a new card-based carousel UI. Implemented unified gesture controls (swipe left/right, double tap, triple tap) directly within the app component. Updated `EndlessRadioManager` to accept specific `allowedStyleIds` based on the selected bar's configuration (`BarData.ts`), ensuring thematic music generation.
  - `v1.8.1`: Refined `ToplineEngine.ts` to improve melody generation when vocals are absent. Differentiated `isVocal`, `isInstrumental`, `isLead`, and `isSolo` logic to ensure instrumental leads have appropriate melodic complexity and phrasing. Adjusted phrase forms, note density, breath/rest chances, and ornamentation probabilities based on the instrument's role to prevent repetitive or overly simple instrumental melodies.
  - `v1.8.0`: Implemented Phase 1 of Harmonic Color Enhancement. Introduced Modal Interchange (borrowing chords from parallel minor/major keys) and Secondary Dominants (V/V, V/vi) into `HarmonyCore.ts`. Enhanced `applyStyleSpices` to add style-specific chord extensions (maj9, m9, 9, add9) for Jazz, J-Pop, and EDM. Updated `MusicTheoryRules.ts` to support parsing and substituting these advanced chord structures.
  - `v1.7.2`: 引入了 R&B Phonetic Rhythm 和 R&B Riffs 机制，增强了 SingerPersona 的 R&B 演唱风格。修复了 SingerPersona.ts 中的语法错误。
  - `v1.7.0`: Enhanced `ToplineEngine.ts` with advanced melody generation techniques. Implemented 'Detonator' mechanism for explosive choruses by tracking `maxPitchBeforeChorus`. Added 'Attitude & Starting Position' logic to `generateMotifRhythm` based on energy levels. Introduced 'Switcheroo' transformation in `transformMotif` and integrated it into advanced motif development forms.
  - `v1.6.0`: Implemented advanced Neo-Soul musical features. Enhanced `ToplineEngine.ts` with pentatonic shifts and dynamic melody simplification. Added `Octave_Melody_Bass` texture logic to `TextureMapper.ts` for Neo-Soul and R&B styles. Updated `HarmonyCore.ts` and `MusicTheoryRules.ts` to support Neo-Soul specific voicings and reharmonization techniques.
  - `v1.5.0`: Changed vocal instrument from `Solo_Vox` (085) to `Marimba` (012). Added mandatory code verification and temporary file cleanup rules to System Instructions.
  - `v1.4.0`: Completely removed `Meowsynth.sf2` and all related dependencies. Consolidated all audio synthesis to use a single standard SoundFont (`GM128_3MB.sf2`). Replaced the `Meowsynth_Vocal` instrument with `Solo_Vox` (GM program 85) across all generation and orchestration logic. Verified 1:1 sound parity and correct MIDI channel allocation.
  - `v1.3.0`: Completely removed all `Tone.js` dependencies from `package.json` and source code. Refactored `LedMatrix` and `WebSimulatorHAL` to use native Web Audio API and `spessasynth_lib`. Ensured 1:1 sound parity with ESP32-S3 by enforcing strict MIDI-driven mixing and scheduling.
  - `v1.2.0`: Eradicated Tone.js dependency. Introduced `MidiScheduler` to mimic ESP32 FreeRTOS timer tasks. All audio mixing and playback is now strictly MIDI-driven via `spessasynth_lib` (SF2).
  - `v1.1.0`: Added comprehensive AI-Assisted Porting Guide, detailing component coupling, SPI/I2S mapping, memory optimization (TrackSerializer), and the "Golden Seed" verification method.
  - `v1.0.1`: Replaced all `Math.random()` with `globalPRNG.next()` for deterministic generation. Refactored `EndlessRadioManager` into a pure TS class to decouple from React hooks.
  - `v1.0.0`: Initial architecture documentation, defined HAL interfaces, PRNG, and C++ porting guidelines.

---

## AuraRadio Core Development System Instructions

### 🎯 Role Definition
You are a top-tier C++/TypeScript embedded firmware engineer and an expert in generative music algorithms. Your core mission is to develop and maintain the music generation engine for AuraRadio.

You must deeply understand: The current TypeScript/Web-based code is merely a high-fidelity simulation and pre-research environment for the physical hardware (ESP32-S3). All code under the `/src/core/generation/` directory must ultimately be 1:1 seamlessly and losslessly translatable to C/C++ code to run on resource-constrained microcontrollers.

### 🛑 CRITICAL CONSTRAINTS

#### 1. Memory & C++ Portability
- **No Dynamic Features**: Strictly prohibit the use of highly dynamic JavaScript features (e.g., dynamically adding object properties, reflection, `eval`, dynamic string key lookups).
- **Flat Data Structures**: All data output by the generation engine must be Plain Data, capable of being directly mapped to C++ `struct`s (e.g., `NoteData` must be a flat structure containing `pitch`, `onset`, `duration`, `velocity`).
- **Zero GC Awareness**: In generation loops (e.g., iterating through beats, generating notes), strictly prohibit the frequent use of syntax that generates many temporary objects, such as `new Object()`, `.map()`, `.filter()`. Reuse arrays or use primitive data types whenever possible.
- **Environment Isolation**: The `/src/core/generation/` directory is strictly forbidden from importing any React dependencies (`useState`, `useEffect`), DOM APIs (`window`, `document`), or Web Audio APIs (`Tone.js`).

#### 2. Absolute Determinism & PRNG Constraints
- **No Native Randomness**: The use of `Math.random()` is strictly prohibited globally.
- **Unified Random Source**: All random numbers must and can only be obtained via `PRNGManager.next()`.
- **State Snapshot Support**: Any entry point to a generation phase must support capturing a snapshot via `PRNGManager.getState()` and restoring it via `PRNGManager.setState()` to ensure independent testing and reproducibility of single modules. **Same Seed + Same Input = Absolutely Identical Output.**

#### 3. State Management & Data Flow
- **No Global Mutable State**: Modules are strictly prohibited from reading or writing to global singletons (like writing to the old `GlobalContext`).
- **Explicit Context Passing**: Music context must be explicitly passed via the `MusicContext` struct. The generation engine outputs `MusicContext`, and the orchestration engine receives `MusicContext` as a parameter.
- **Enums & Bitmasks Preferred**: Style IDs must use `StyleId` (Enum). Style category matching is strictly prohibited from using string `.includes()`; it must use `StyleFlags` for Bitwise AND operations to ensure extremely fast table lookups in C++.

### ⚙️ Four-Module Pipeline Interface Contract

The entire generation pipeline must strictly follow this unidirectional data flow. No overstepping, no reversing, no skipping steps:

#### Module 1: PRNGManager (Random Number Management)
- **Responsibility**: Maintain LCG state, provide the sole random number sequence for the entire pipeline.
- **Interface**: `setSeed(seed: number)`, `next(): number`, `getState(): number`, `setState(state: number)`

#### Module 2: MelodyEngine (Generation Engine)
- **Responsibility**: Determine macro structure, harmonic progression, and main/secondary melodies (Topline).
- **Interface**: `generateFullSong(styleId: StyleId, options?: GenerationOptions): { track: GeneratedTrack, context: MusicContext }`
- **Constraints**: Synchronous execution, pure data output. Internally consumes PRNG in a fixed order.

#### Module 3: Orchestrator (Orchestration Engine)
- **Responsibility**: Expand the single-line melody into 7 specific instrument tracks (Vocal, Melody, SecMelody, PianoLH, PianoRH, Drums, CounterMelody), applying instrument idioms.
- **Interface**: `arrange(track: GeneratedTrack, styleId: StyleId, context: MusicContext): ArrangedTrack`
- **Constraints**: Synchronous execution. Read-only `MusicContext`, does not modify the original `GeneratedTrack`, outputs a complete `ArrangedTrack`.

#### Module 4: PlaybackEngine (MIDI Conversion Layer)
- **Responsibility**: Convert note data into underlying MIDI event sequences.
- **Interface**: `convert(arranged: ArrangedTrack, styleId: StyleId): MidiEvent[]`
- **Constraints**: Pure data mapping, does not consume PRNG. The output `MidiEvent[]` is the absolute end of the generation pipeline.

### 📝 MANDATORY DOCUMENTATION RULE

Whenever you modify any of the following:
- Core algorithm logic (e.g., melody generation, harmony derivation, groove algorithms)
- Interface signatures (parameter types, return value structures)
- Architecture pipeline flow (Pipeline order, module responsibilities)
- Data structures (Addition/modification/deletion of Structs/Interfaces)

You **MUST** proactively edit and update the `AURA_ARCHITECTURE.md` file in the root directory within the **same conversation turn**:
1. Find `## Version Info -> Update Log`.
2. Increment the version number (Follow Semantic Versioning: Major refactor -> Minor, Bug fix -> Patch).
3. Detail the contents of this change, the modules involved, and the impact on C++ porting.
4. If interfaces or data flows were modified, you must synchronously update the ASCII flowcharts or interface tables in the document.

### 🛠️ Execution Standards

- **Action Over Talk**: Explain less, write more code. Use tools directly to modify files.
- **Strictly Follow Existing Interfaces**: When adding new features, prioritize reusing existing structures in `types.ts`. If a new structure must be added, consider: "How much memory will this structure consume in C++? Can it be serialized?"
- **Clean Up Ghost Code**: During refactoring, proactively find and delete unused deprecated variables, unreferenced files, and redundant `console.log`s. Keep the codebase extremely clean.
- **Language**: All communication must be strictly in Chinese.

---

## 1. Architecture Overview
AuraFlow is designed with a strict separation between **Core Logic (Music Engine)** and **Platform Layer (Web/ESP32)**. 
The simulator uses React and WebAssembly (SpessaSynth), but the core engine must remain platform-agnostic to allow 1:1 translation to C/C++ for the ESP32-S3.

### Directory Structure
- `/src/core/generation/`: Pure music theory and generation algorithms. **(Must be 100% portable C++ logic)**
- `/src/core/hal/`: Hardware Abstraction Layer. Defines interfaces for I/O.
- `/src/core/audio/`: Web-specific audio implementation (SpessaSynth + MidiScheduler). **(Will be replaced by I2S/Synth in ESP32)**
- `/src/apps/`: Application state machines. **(Should be pure TS classes, not React hooks)**
- `/src/components/`: React UI components for the simulator. **(Ignored in ESP32)**

---

## 2. Music Generation Pipeline
The pipeline is strictly sequential and data-driven. It does NOT play audio; it generates a `GeneratedTrack` data structure.

1. **Input & Seed**: User interaction triggers generation with a specific PRNG seed.
2. **Structure Engine (`StructureEngine.ts`)**: Determines sections (Intro, Verse, Chorus) and lengths.
3. **Harmonic Engine (`HarmonicEngine.ts`)**: Generates chord progressions based on tonality and style.
4. **Groove & Topline (`ToplineEngine.ts`)**: Generates rhythm fingerprints and melody notes.
5. **Orchestration (`Orchestrator.ts`)**: Assigns notes to specific instruments (Piano, Drums, Bass).
6. **Output**: Returns an `ArrangedTrack` containing pure note data (`pitch`, `onset`, `duration`, `velocity`).

---

## 3. Hardware Abstraction Layer (HAL) Mapping
When porting to ESP32-S3, the TypeScript interfaces in `/src/core/hal/IHardware.ts` map directly to ESP-IDF drivers:

| TS Interface | Simulator Implementation | ESP32-S3 Implementation (C/C++) |
| :--- | :--- | :--- |
| `ILedMatrix` | React State + CSS Grid | **SPI / RMT** (WS2812B / APA102 drivers) |
| `ITouchPad` | DOM `onPointerDown` | **I2C** (e.g., CST816S) or Native Touch Pad |
| `IAudioOut` | SpessaSynth (SF2) + MidiScheduler | **I2S** (e.g., MAX98357A) + FluidSynth/TinySoundFont |
| `ISystemTimer` | `setTimeout` / `performance.now()` | `vTaskDelay()` / `esp_timer_get_time()` |

---

## 4. C/C++ Porting Development Standards (CRITICAL)

To ensure the TS code can be easily translated to C/C++ for the ESP32-S3, all future development in `/src/core/` MUST adhere to these rules:

1. **No React in Core**: Never use `useState`, `useEffect`, or JSX inside `/src/core/`. Core logic must be pure TS classes or functions.
2. **Deterministic Randomness**: Never use `Math.random()`. Always use `PRNGManager.next()` from `/src/core/utils/PRNG.ts`. This ensures the same seed produces the same song on both Web and ESP32.
3. **Memory Management (Avoid GC)**: 
   - Avoid creating objects inside tight loops (e.g., `new Object()`, `.map()`, `.filter()`).
   - Prefer pre-allocated arrays or TypedArrays (`Uint8Array`, `Float32Array`) where possible.
   - In C++, these will map to static arrays or memory pools to prevent heap fragmentation and OOM crashes on the ESP32.
4. **Pure Data Structures**: The output of the generation engine must be plain data (JSON-serializable). No functions or class instances in the final `ArrangedTrack` object.
5. **Tone.js is Forbidden**: All audio scheduling must use `MidiScheduler`. All mixing must use MIDI CC messages (CC 7 for Volume, CC 10 for Pan, CC 91 for Reverb).

---

## 5. AI-Assisted Porting Guide (For Firmware Engineers & Claude/AI)

If you are an AI assistant or a Firmware Engineer tasked with porting this codebase to the ESP32-S3, read this section carefully to understand the boundaries and coupling of the system.

### 5.1 Code Segregation: What to Keep vs. What to Replace
- **DO NOT TOUCH (1:1 Port to C++)**: Everything in `/src/core/generation/` and `/src/core/utils/PRNG.ts`. This is pure algorithmic logic. Translate TS classes directly to C++ classes. TS `number` becomes `float` or `uint8_t` depending on context.
- **REPLACE (Hardware Specific)**: Everything in `/src/core/hal/` and `/src/core/audio/`. You must write C++ classes that implement the HAL interfaces and the MIDI Scheduler.
  - `ILedMatrix` -> Implement using ESP-IDF **SPI Master** driver or **RMT** peripheral to drive WS2812/APA102 LEDs.
  - `ITouchPad` -> Implement using ESP-IDF **I2C** driver to read from the touch controller (e.g., CST816S).
  - `MidiScheduler` -> Implement using a FreeRTOS Timer Task (`vTaskDelay`) that reads a queue of MIDI events and pushes them to the SF2 engine.

### 5.2 Component Coupling & Data Flow (How it all connects)
To prevent instruments from "playing their own game" (clashing notes, out-of-sync rhythms), the architecture enforces a strict **Top-Down, Shared-Context data flow**:
1. **Style & Config (`StyleRegistry`)**: Defines the global rules (BPM range, allowed chords, instruments).
2. **Macro Structure (`StructureEngine`)**: Divides the song into sections (Intro, Verse, Chorus).
3. **Global Harmony (`HarmonyCore`)**: Generates a single, unified Chord Progression for each section. **CRITICAL**: All instruments (Main Melody, Bass, Accompaniment Chords) MUST reference this exact same `HarmonyState`. They do not generate their own chords.
4. **Global Groove (`GrooveEngine`)**: Generates a unified rhythmic grid (syncopation, swing).
5. **Orchestration (`Orchestrator`)**: Acts as the dispatcher. It takes the Global Harmony and Global Groove, and passes them to specific **Idioms**.
6. **Idioms (`PianoIdiom`, `BassIdiom`, `StringIdiom`)**: These are instrument-specific renderers. They take the shared `HarmonyState` and translate it into instrument-specific `NoteData` (e.g., BassIdiom only plays the root/fifth of the shared chord; PianoIdiom plays block chords). This guarantees musical cohesion.

### 5.3 Memory Management & C++ Struct Mapping
JavaScript uses Garbage Collection. ESP32-S3 will crash (OOM) if you dynamically allocate objects in the audio loop.
- **TS `NoteData`** must be translated to a packed C struct:
  ```cpp
  struct NoteData {
      uint8_t pitch;       // 0-127 MIDI note
      uint8_t velocity;    // 0-127
      float onset;         // Beat position
      float duration;      // Beat length
  };
  ```
- **Avoid `std::vector` reallocations**: Pre-allocate arrays for notes (e.g., `NoteData trackBuffer[1024]`). See `/src/core/utils/TrackSerializer.ts` for how we simulate this flat memory layout in TS using `Float32Array`.

### 5.4 Verification Strategy (The "Golden Seed" Test)
How do you prove your C++ port is 1:1 accurate to this Web Simulator?
1. **Fix the Seed**: In the Web Simulator, hardcode `PRNGManager.setSeed(12345)`.
2. **Generate & Export**: Run the generation pipeline and serialize the resulting `ArrangedTrack` to a JSON file (or use `TrackSerializer` to get a binary buffer).
3. **Run C++ Port**: On the ESP32 (or a PC C++ test build), initialize your ported PRNG with `12345`. Run your ported generation pipeline.
4. **Compare**: The resulting C++ structs MUST byte-for-byte match the Web Simulator's output. If a single note's `onset` or `pitch` differs, your C++ port has a logic error (usually a floating-point precision issue, a different array sorting algorithm, or a missed `PRNG.next()` call).

---

## 6. Interface Usage Instructions & Calling Logic (接口使用说明与调用逻辑)

### 6.1 HAL Interfaces (`/src/core/hal/IHardware.ts`)
These interfaces define the boundary between the OS logic and the physical hardware.
- **`IAudioOut`**: 
  - *Web*: Handled by `AudioEngine` (SpessaSynth + Web Audio API).
  - *ESP32*: Must be implemented using I2S DMA. The `playNote` and `stopNote` methods should push MIDI events to the FluidSynth/TinySoundFont engine running on the ESP32.
- **`ILedMatrix`**:
  - *Web*: Simulated via React state (`LedMatrix.tsx`).
  - *ESP32*: Implement using SPI or RMT. The `setPixel` method writes to a frame buffer, and `update` flushes the buffer to the LEDs via DMA.
- **`ITouchPad`**:
  - *Web*: Simulated via DOM Pointer Events.
  - *ESP32*: Implement using I2C to read from the touch controller. `getTouchState` reads the current register, while `onPadDown`/`onPadUp` should be triggered by hardware interrupts (ISR) mapped to FreeRTOS queues.
- **`ISystemTimer`**:
  - *Web*: Uses `performance.now()` and `setTimeout`.
  - *ESP32*: Implement using `esp_timer_get_time()` for microsecond precision and `vTaskDelay()` for blocking delays.

### 6.2 Audio Calling Logic (The MIDI Pipeline)
1. **Event Generation**: The `PlaybackEngine` or `LiveLoopingEngine` reads `ArrangedTrack` data and converts it into `MidiEvent` objects.
2. **Scheduling**: These events are pushed to the `globalMidiScheduler` (`MidiScheduler.ts`).
3. **Execution**: The scheduler uses a look-ahead loop (mimicking a FreeRTOS timer task). When an event's time arrives, it calls the corresponding method on the `spessaSynth` instance (e.g., `noteOn`, `noteOff`, `controllerChange`).
4. **Mixing**: All mixing (volume, panning, reverb) is done by sending MIDI Control Change (CC) messages to specific MIDI channels before or during note playback. No Web Audio API GainNodes are used for per-track mixing.

---

## 7. AuraRadio 核心接口约束框架

> 本文档定义 AuraRadio 生成管道的四模块接口边界、数据结构与行为约束。
> 用途：指导需求改动评审、C++ 移植设计、测试用例编写。
> 数据类型与当前源码（`types.ts`、`GlobalContext.ts`、`PRNG.ts`、`MidiScheduler.ts`）一致。

### 7.1 管道总览

#### 7.1.1 四模块与数据流

```text
┌──────────────────────────────────────────────────────────────────────┐
│                        AuraRadio 无限电台                              │
│                                                                      │
│  ┌────────────────┐   ┌──────────────────────┐                       │
│  │  PRNGManager   │   │ 风格查表（静态只读）    │                       │
│  │ setSeed/next   │   │ ·StyleId (enum)      │                       │
│  │ getState/      │   │ ·StyleFlagTable      │                       │
│  │ setState       │   │ ·StyleConfigTable    │                       │
│  └──┬─────────┬───┘   └────┬─────────┬───────┘                       │
│     │         │             │         │                               │
│     ▼         ▼             ▼         ▼                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │
│  │  生成引擎     │  │  编配引擎     │  │ MIDI 转换层   │                │
│  │  MelodyEngine├─►│  Orchestrator├─►│ PlaybackEngine│                │
│  │              │  │              │  │  .convert()   │                │
│  └──────────────┘  └──────────────┘  └──────┬───────┘                │
│   GeneratedTrack    ArrangedTrack           │                        │
│   + MusicContext                            │ MidiEvent[]            │
│                                             │ ← 生成管道终点          │
│  ╔══════════════════════════════════════════╧═══════════════╗        │
│  ║              【平台层 — 不属于生成管道】                    ║        │
│  ║  MidiScheduler → 合成器 → 音频输出 → onTrackEnd → 循环   ║        │
│  ╚═════════════════════════════════════════════════════════╝        │
└──────────────────────────────────────────────────────────────────────┘
```

#### 7.1.2 黑盒接口输入输出图

以下是四个黑盒模块的完整输入、输出和数据流。此图定义了模块间的不可变边界——无论各黑盒内部如何改动，输入数据、输出数据和流向不变。

```text
                    显式输入                     隐式输入
                 ┌───────────┐    ┌────────┐   ┌──────────────┐
                 │  styleId  │    │options? │   │ PRNGManager  │
                 │(StyleId   │    │·motif   │   │ .next()      │
                 │  enum)    │    │·tonality│   │ .getState()  │
                 └─────┬─────┘    │·timeSig │   │ .setState()  │
                       │          └────┬────┘   │              │
                       │               │        └──────┬───────┘
                       │               │               │
                       ▼               ▼               ▼
                    ┌────────────────────────────────────────┐
                    │                                        │
                    │ MelodyEngine.generateFullSong(styleId) │
                    │          【生成引擎黑盒】                │
                    │                                        │
                    │ 内部查表: StyleConfigTable[styleId]     │
                    │         StyleFlagTable[styleId]        │
                    │                                        │
                    │   同步 · 纯数据 · 确定性                │
                    │                                        │
                    └───────┬────────────────┬───────────────┘
                            │                │
                            ▼                ▼
                    ┌──────────────────────────┐  ┌──────────────┐
                    │      GeneratedTrack       │  │ MusicContext  │
                    │ ·vocal, melody, chords    │  │ ·keyOffset   │
                    │ ·sections                 │  │ ·tonality    │
                    │ ·bpm, key, keyOffset      │  │ ·bpm         │
                    │ ·tonality, timeSignature  │  │ ·timeSignature│
                    │ ·blockIndex               │  │ ·grooveDNA   │
                    │ ·absoluteStartBeat        │  │ ·singerPersona│
                    │ ·hasIntro                 │  └──────┬───────┘
                    │ ·preSelectedPalette       │         │
                    │ ·globalRiff               │         │
                    │ ·processedUserMotif       │         │
                    │ ·motifRole                │         │
                    └────────────┬─────────────┘         │
                                 │                       │
                                 │  styleId              │
                                 ▼  (透传)               ▼
                    ┌────────────────────────────────────────┐
                    │                                        │
                    │ Orchestrator.arrange(track, styleId,   │
                    │                      context)          │
                    │          【编配引擎黑盒】                │
                    │                                        │
                    │ 内部查表: StyleConfigTable[styleId]     │
                    │         StyleFlagTable[styleId]        │
                    │ 读取 context: keyOffset, tonality, ... │
                    │                                        │
                    │   单旋律 → 7 轨 · Idiom 渲染           │
                    │   人性化处理 · 消耗 PRNG                │
                    │                                        │
                    └──────────────┬─────────────────────────┘
                                  │
                                  ▼
                    ┌────────────────────────────────────┐
                    │        ArrangedTrack               │
                    │  ·vocal           : NoteData[]?    │
                    │  ·melody          : NoteData[]     │
                    │  ·secondaryMelody : NoteData[]?    │
                    │  ·pianoLH         : NoteData[]     │
                    │  ·pianoRH         : NoteData[]     │
                    │  ·drums           : NoteData[]?    │
                    │  ·counterMelody   : NoteData[]?    │
                    │  ·palette         : EnsembleDraft  │
                    │  ·sections        : SectionMeta[]? │
                    │  ·bpm, key, absStartBeat           │
                    │  ·timeSignature, styleId           │
                    │  ·globalRiff, userMotif            │
                    └──────────────┬─────────────────────┘
                                  │
                                  │  styleId (透传)
                                  │
                                  ▼
                    ┌────────────────────────────────────────┐
                    │                                        │
                    │  PlaybackEngine.convert(arranged)      │
                    │          【MIDI 转换层】                 │
                    │                                        │
                    │ 内部查表: StyleFlagTable[styleId]       │
                    │          （混音风格 → MIDI CC）          │
                    │                                        │
                    │   NoteData → MidiEvent[]               │
                    │   (noteOn/noteOff/CC + channel + time) │
                    │                                        │
                    └──────────────┬─────────────────────────┘
                                  │
                                  │  MidiEvent[] ← 生成管道终点（测试断言点）
                                  │
                    ╔═════════════╧═══════════════════════════╗
                    ║          【平台层 — 不属于生成管道】       ║
                    ║                                         ║
                    ║  MidiScheduler（5ms 轮询）               ║
                    ║       ↓                                 ║
                    ║  合成器（SpessaSynth / FluidSynth）      ║
                    ║       ↓                                 ║
                    ║  音频输出（扬声器）                       ║
                    ║       ↓                                 ║
                    ║  onTrackEnd → playNext() → 循环回顶部    ║
                    ╚═════════════════════════════════════════╝
```

#### 7.1.3 四个模块职责

| # | 模块 | 类 | 输入 | 输出 | PRNG |
|---|------|---|------|------|------|
| 1 | PRNGManager | （新增包装层） | seed | 随机数序列 | — |
| 2 | 生成引擎 | `MelodyEngine` | styleId + options | GeneratedTrack + MusicContext | 消耗 N 次 |
| 3 | 编配引擎 | `Orchestrator` | track + styleId + context | ArrangedTrack | 消耗 M 次 |
| 4 | MIDI 转换层 | `PlaybackEngine.convert` | ArrangedTrack + styleId | MidiEvent[] | 不消耗 |

**风格查表系统**（StyleId enum + StyleFlagTable + StyleConfigTable）是共享的静态只读数据层，程序启动时固定，不作为独立模块。

#### 7.1.4 完整执行周期

**第 0 步 — 初始化**
- AuraRadio 调用 `PRNGManager.setSeed(seed)`，LCG 状态归零，序列从此确定

**第 1 步 — 选风格**
- AuraRadio 调用 `PRNGManager.next()` → 从 14 个 StyleId 中选一个

**第 2 步 — 生成曲目**
- AuraRadio 调用 `MelodyEngine.generateFullSong(styleId, options)`
- 内部按固定顺序执行：决策 BPM/调性/拍号 → StructureEngine → HarmonyEngine → EnsembleDrafter → SingerPersona → ToplineEngine → reharmonize
- 返回 `{ track: GeneratedTrack, context: MusicContext }`

**第 3 步 — 存历史**
- AuraRadio 将 `(track, styleId, context)` 存入历史栈

**第 4 步 — 编配**
- 调用 `Orchestrator.arrange(track, styleId, context)`
- 内部：查表 → 读 context → 逐段落展开为 7 轨 → Idiom 渲染 → 人性化
- 返回 `ArrangedTrack`

**第 5 步 — MIDI 转换**
- 调用 `PlaybackEngine.convert(arranged, styleId)`
- 内部：7 轨 NoteData → MidiEvent[]（noteOn/noteOff/CC + 通道 + 时间戳）
- 返回 `MidiEvent[]` — **生成管道到此结束**

**第 6 步 — 平台层播放**（不属于生成管道）
- MidiScheduler 加载 MidiEvent[]，5ms 轮询驱动合成器输出音频

**第 7 步 — 循环**
- onTrackEnd → playNext()：历史有下一首 → 跳到第 4 步；末尾 → 跳到第 1 步

---

### 7.2 PRNGManager 接口

贯穿全管道的随机数供给模块。内部维护一个 LCG（线性同余生成器），所有需要随机数的模块统一从这里取数。

**工作原理**:
PRNGManager 内部只有一个整数 `state`，这就是它的全部状态。
seed 决定起点，之后每次 `next()` 不可逆地往前走一步。整条序列是一条**单向链**，完全由 seed 唯一确定。不管谁调用 `next()`，只要调用顺序一样，出来的数就一样。

**实际消费顺序**（单次生成周期）:

```text
setSeed(seed)
  │
  ├─ AuraRadio 选风格            → next() ×1      ← 从 14 个 StyleId 中选一个
  │
  ├─ 生成引擎内部                 → next() ×N 次
  │   ├─ StructureEngine         → next() ×若干
  │   ├─ HarmonyEngine           → next() ×若干
  │   ├─ EnsembleDrafter         → next() ×若干
  │   ├─ ToplineEngine           → next() ×若干
  │   │   ├─ GrooveEngine        → next() ×若干
  │   │   ├─ RhythmCells         → next() ×若干
  │   │   └─ SingerPersona.apply → next() ×若干
  │   └─ reharmonize             → next() ×0      ← 纯 Viterbi DP，不消耗
  │
  ├─ 编配引擎内部                 → next() ×M 次
  │   ├─ Orchestrator 自身        → next() ×若干   ← 乐器选择 + 编排决策
  │   ├─ TextureMapper           → next() ×若干   ← 贝斯/和弦织体/鼓/副旋律
  │   ├─ TransitionEngine        → next() ×若干   ← 段落过渡
  │   ├─ InstrumentIdiom         → next() ×若干
  │   └─ humanize                → next() ×若干
  │
  └─ MIDI 转换层                  → next() ×0      ← 纯数据转换，不消耗随机数
```

**接口**:

```typescript
PRNGManager.setSeed(seed: number): void       // 设置 state = seed，序列从头开始
PRNGManager.next(): number                    // 算下一个 state，返回 0~1
PRNGManager.nextInt(min, max): number         // next() 基础上映射到整数范围
PRNGManager.nextFloat(min, max): number       // next() 基础上映射到浮点范围
PRNGManager.getState(): number                // 读取当前 state（用于快照）
PRNGManager.setState(state: number): void     // 恢复到指定 state（用于复现）
```

**行为约束**:
- v1 实现与当前 `PRNGManager` 行为完全一致，黄金种子测试零差异
- `getState()`/`setState()` 是新增能力，当前代码已实现
- 当前源码中 `PRNGManager` 默认使用 `Date.now()` 初始化，黄金种子测试需在入口处显式调用 `PRNGManager.setSeed(固定值)`
- 纯确定性，不依赖任何外部状态
- C++ 侧对应 `struct PRNGManager { uint32_t state; }` + `uint8_t protocolVersion`

---

### 7.3 生成引擎接口

```typescript
MelodyEngine.generateFullSong(styleId: StyleId, options?: GenerationOptions)
  → { track: GeneratedTrack, context: MusicContext }
```

同步调用，返回纯数据，不触发音频。

#### 7.3.1 显式输入

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `styleId` | `StyleId`（enum） | 是 | 风格枚举值，索引 `StyleConfigTable` 和 `StyleFlagTable` |
| `options.userMotifRoot` | `KeyId`（enum） | 否 | 调号枚举（0=C, 1=Db, ..., 11=B），直接锁定全曲调号。不传则由内部 PRNG 生成 |
| `options.processedUserMotif` | `NoteData[]` | 否 | 用户动机音符序列，由上层意图识别模块给出。不传则全部由 PRNG 生成 |
| `options.motifRole` | `MotifRole`（enum） | 否 | 动机角色枚举，决定 processedUserMotif 在编配中的层级。默认 `Foreground` |
| `options.detectedTimeSignature` | `[int, int]` | 否 | 拍号，如 `[4, 4]`。传入则直接使用，不传则由 PRNG 随机抽取 |
| `options.detectedTonality` | `TonalityId`（enum） | 否 | 调式枚举。`0`=随机抽取，非 0 直接作为调式引用 |

#### 7.3.2 隐式输入

| 名称 | 说明 |
|------|------|
| `PRNGManager` | 入口自动记录状态快照（`getState()`），内部各子模块依次调用 `next()` 消耗随机数 |
| `StyleConfigTable[styleId]` | 内部查表得到，定义 BPM 范围、和弦池、旋律约束、乐器候选等规则边界 |
| `StyleFlagTable[styleId]` | 内部查表得到，风格分类标签位掩码（25 flag） |

#### 7.3.3 输出：GeneratedTrack & MusicContext

- **GeneratedTrack**: `chords`, `melody`, `vocal`, `bpm`, `key`, `keyOffset`, `tonality`, `timeSignature`, `sections`, `blockIndex`, `absoluteStartBeat`, `hasIntro`, `preSelectedPalette`, `globalRiff`, `processedUserMotif`, `motifRole`
- **MusicContext**: `keyOffset`, `tonality`, `bpm`, `timeSignature`, `grooveDNA`, `singerPersona`

#### 7.3.4 行为约束

1. **确定性**：相同 PRNG 状态 + 相同输入 = 相同输出
2. **纯数据**：不触发音频、不访问硬件、不产生副作用
3. **PRNG 消耗**：每次调用消耗若干 `next()`，状态不可逆前进
4. **无全局写入**：音乐上下文通过返回值 `context` 显式输出，不写入 `GlobalContext` 等全局单例
5. **快照支持**：入口处 `PRNGManager.getState()` 自动快照，支持独立复现本阶段输出

---

### 7.4 编配引擎接口

```typescript
Orchestrator.arrange(
  track: GeneratedTrack,
  styleId: StyleId,
  context: MusicContext
): ArrangedTrack
```

**输入**: `track` (GeneratedTrack), `styleId` (StyleId), `context` (MusicContext)
**输出**: 七轨分离的 `ArrangedTrack`（vocal / melody / secondaryMelody / pianoLH / pianoRH / drums / counterMelody），含乐器编制、混音参数，以及透传的元数据。

**行为约束**:
- 同步调用，返回纯数据
- 入口自动记录 `PRNGManager.getState()` 快照，内部调用 `next()` 消耗随机数
- 同一 `GeneratedTrack` + 同一 `MusicContext` + 同一 PRNG 状态 = 同一输出
- **不读写任何全局状态**：所有音乐上下文从 `context` 参数读取，不访问全局单例
- 编配引擎内部逐段落遍历时的段落级状态通过局部变量管理并显式传参给 TextureMapper / Idiom，不纳入 MusicContext

---

### 7.5 MIDI 转换层接口

生成管道的末端。将编配引擎输出的 `ArrangedTrack` 转换为 `MidiEvent[]` 序列，这是整个生成管道的最终确定性输出。

```typescript
PlaybackEngine.convert(arranged: ArrangedTrack, styleId: StyleId): MidiEvent[]
```

**输入**: `ArrangedTrack` + `StyleId`
**输出**: `MidiEvent[]`——时间排序的 MIDI 指令序列（noteOn/noteOff/CC + 通道 + 时间戳）

**行为约束**:
- 同步调用，纯数据转换，不涉及音频硬件
- 同一 `ArrangedTrack` + 同一 `StyleId` = 同一 `MidiEvent[]`（确定性）
- 不消耗 PRNG，不读写 MusicContext

---

### 7.6 数据结构定义

> 管道中流转的核心数据结构，字段类型与当前源码一致。

- **NoteData**: `pitch`, `onset`, `duration`, `velocity`, `isGraceNote`, `pitchBend`, `pitchBendDuration`, `fadeOutDuration`, `isUserMotif`
- **GeneratedChord**: `numeral`, `root`, `quality`, `startBeat`, `endBeat`
- **SectionMetadata**: `name`, `startBeat`, `endBeat`, `energyLevel`, `grooveDNA`, `lofiEffect`, `endingType`, `type`, `lengthBars`, `phraseTemplate`, `harmony`, `groove`, `tracks`, `localStyleOverride`, `isRiffDriven`
- **EnsembleDraft**: `melodySound`, `vocalSound`, `secondaryMelodySound`, `chordSound`, `bassSound`, `drumSound`, `counterMelodySound`, `filterSweep`, `mixing`
- **MixingConfig**: `pan`, `reverb`, `volume`, `delay`
- **SingerPersonaConfig**: `id`, `name`, `traits`
- **ArrangedTrack**: `bpm`, `key`, `absoluteStartBeat`, `timeSignature`, `styleId`, `vocal`, `melody`, `secondaryMelody`, `pianoLH`, `pianoRH`, `drums`, `counterMelody`, `userMotif`, `palette`, `sections`, `globalRiff`
- **MidiEvent**: `ticks`, `type`, `channel`, `data1`, `data2`, `visualData`

---

### 7.7 与当前源码的差异

> 本文档描述的是**目标接口设计**。以下列出与当前源码实现的具体差异。
> 
> **v1.34.0 更新**：生成管道核心部分（`/src/core/generation/`）的 GlobalContext 解耦已 100% 完成。
> 标记 ✅ 的项表示源码已与框架对齐。

| 项 | 当前源码 | 本框架 | 状态 |
|---|---|---|---|
| **基础设施** | | | |
| styleId 类型 | `StyleId`（enum 数值） | `StyleId`（enum 数值） | ✅ 已对齐 |
| 风格分类方式 | `StyleFlagTable[styleId]` 位掩码查表 | `StyleFlagTable[styleId]` 位掩码查表 | ✅ 已对齐 |
| 风格配置查询 | `getStyleConfig(id: string)` 哈希表查找 | `StyleConfigTable[styleId]` 静态数组直接寻址 | 待迁移 |
| PRNG 管理 | `PRNGManager` 模块 | `PRNGManager` 模块 | ✅ 已对齐 |
| 音乐上下文传递 | `MusicContext` 显式传递（生成管道内零 GlobalContext） | `MusicContext` 结构体，显式传递 | ✅ 已对齐 |
| idiomPreferences 类型 | `IdiomPreferences` / `RuntimeIdiomPreferences` 接口 | 类型化接口 | ✅ 已对齐 |
| 浮点比较 | `Math.abs(x - y) < 1e-6` epsilon 容差 | epsilon 容差 | ✅ 已对齐 |
| **生成引擎** | | | |
| 生成引擎参数签名 | `generateFullSong(styleId: StyleId)` | `generateFullSong(styleId: StyleId)` | ✅ 已对齐 |
| 生成引擎返回值 | `{ track: GeneratedTrack, context: MusicContext }` | `{ track: GeneratedTrack, context: MusicContext }` | ✅ 已对齐 |
| HarmonyCore 参数 | `generateHarmonyTimeline(sections, style, timeSig, tonality, keyOffset)` | tonality/keyOffset 显式传递 | ✅ 已对齐 |
| **编配引擎** | | | |
| 编配引擎参数 | `arrange(track, styleId: StyleId, context: MusicContext)` | `arrange(track, styleId: StyleId, context: MusicContext)` | ✅ 已对齐 |
| TextureMapper 上下文 | `TextureRenderContext` 显式注入（零 GlobalContext fallback） | 显式参数传递 | ✅ 已对齐 |
| Bass Idiom 上下文 | `BassIdiomContext` 含 beatsPerBar/activeSection/keyOffset/grooveDNA | 显式参数传递 | ✅ 已对齐 |
| Groove 判定函数 | `BaseBassIdiom.isGrooveHit()` 等纯静态方法 | 纯函数，无全局状态 | ✅ 已对齐 |
| **播放引擎** | | | |
| 生成管道终点 | `AudioEngine.playSong()` 内调用 `Orchestrator.arrange()` + `PlaybackEngine.loadSong()` | 独立 `PlaybackEngine.convert()` 纯函数输出 `MidiEvent[]` | 待迁移 |
| **外围（平台层，不受 Pipeline Rule 管辖）** | | | |
| 播放引擎参数 | `playSong(track, style: StyleConfig, ...)` | `playSong(track, styleId: StyleId, context: MusicContext, ...)` | 待迁移 |
| 历史栈存储 | `{ track: GeneratedTrack, style: StyleConfig }` | `{ track: GeneratedTrack, styleId: StyleId, context: MusicContext }` | 待迁移 |
| GlobalContext 平台层使用 | `/src/core/audio/`、`/src/apps/`、`/src/components/` 仍引用 | 不受 Pipeline Rule 管辖 | N/A |

---

### 7.8 接口设计约束

1. **PRNG 由 `PRNGManager` 统一管理**：统一通过 `PRNGManager.next()` 获取随机数，模块管理种子、状态快照（`getState()`/`setState()`）、协议版本。
2. **`StyleId` 为 enum 类型**：废弃 `style.id` 字符串。所有接口只传 `StyleId`（enum 数值），各组件内部按需查 `StyleConfigTable[styleId]` 和 `StyleFlagTable[styleId]`。
3. **风格分类走 `StyleFlagTable` 位掩码**：废弃所有 `style.id.includes()` 子串匹配。flag 分配按代码中实际的分支命中路径确定，确保替换前后每个风格命中的 if 分支完全一致。
4. **接口参数统一**：`generateFullSong(styleId)`、`arrange(track, styleId, context)`、`playSong(track, styleId, context, ...)` 全部只收 `StyleId`，消除 StyleConfig 对象的冗余传递。
5. **`MusicContext` 显式传递**：废弃 `GlobalContext` 全局可变单例。生成引擎通过返回值 `MusicContext` 显式输出，编配引擎通过参数显式接收。各黑盒不读写任何全局状态。
6. **阶段入口自动快照**：`generateFullSong()` 和 `arrange()` 入口处自动记录 `PRNGManager.getState()`，支持独立复现任一阶段的输出。
7. **`StyleId`、`StyleFlagTable`、`StyleIdName` 集中定义**：统一在一处（如 `StyleFlags.ts`），禁止散落。
8. **生成管道终点为 `MidiEvent[]`**：整个生成管道的最终确定性输出为 `MidiEvent[]`，不涉及音频。MIDI 之后的调度与合成属于平台层，不纳入测试范围。

---

### 7.9 复核结论

#### 7.9.1 可测试性复核
验证四个黑盒（PRNGManager、生成引擎、编配引擎、MIDI 转换层）是否可通过 `getState()`/`setState()` 测试钩子独立测试。

**结论：框架设计可测试，当前源码未实现。**
按本框架实施后，四个黑盒均可独立测试：
- **PRNGManager**：`setSeed()` + 调用序列 → 验证输出数列
- **生成引擎**：`setState(stateA)` + styleId + options → 验证 GeneratedTrack + MusicContext
- **编配引擎**：`setState(stateC)` + 预录 track/styleId/context → 验证 ArrangedTrack
- **MIDI 转换层**：预录 ArrangedTrack + styleId → 验证 MidiEvent[]（不消耗 PRNG，无需快照）

#### 7.9.2 机械替换兼容性复核
验证本框架的所有接口变更在完整机械替换后是否保证生成效果零差异。

**结论：全部 7 项替换零差异可行。其中生成管道核心项已于 v1.34.0 完成实施。**
- StyleId enum 替换 string：✅ 已实施
- GlobalContext → MusicContext 显式传递：✅ 已实施（v1.34.0，生成管道内零 GlobalContext）
- globalPRNG → PRNGManager：✅ 已实施
- userMotifRoot 类型 enum 化：✅ 零差异
- detectedTonality enum 化：✅ 零差异
- motifExpertise 删除：✅ 零差异
- 返回值 { track, context }：✅ 已实施
