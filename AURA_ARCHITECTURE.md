# AuraFlow Core Architecture & ESP32-S3 Porting Guide

## Version Info
- **Current Version:** 1.4.0
- **Last Updated:** 2026-03-30
- **Update Log:**
  - `v1.4.0`: Completely removed `Meowsynth.sf2` and all related dependencies. Consolidated all audio synthesis to use a single standard SoundFont (`GM128_3MB.sf2`). Replaced the `Meowsynth_Vocal` instrument with `Solo_Vox` (GM program 85) across all generation and orchestration logic. Verified 1:1 sound parity and correct MIDI channel allocation.
  - `v1.3.0`: Completely removed all `Tone.js` dependencies from `package.json` and source code. Refactored `LedMatrix` and `WebSimulatorHAL` to use native Web Audio API and `spessasynth_lib`. Ensured 1:1 sound parity with ESP32-S3 by enforcing strict MIDI-driven mixing and scheduling.
  - `v1.2.0`: Eradicated Tone.js dependency. Introduced `MidiScheduler` to mimic ESP32 FreeRTOS timer tasks. All audio mixing and playback is now strictly MIDI-driven via `spessasynth_lib` (SF2).
  - `v1.1.0`: Added comprehensive AI-Assisted Porting Guide, detailing component coupling, SPI/I2S mapping, memory optimization (TrackSerializer), and the "Golden Seed" verification method.
  - `v1.0.1`: Replaced all `Math.random()` with `globalPRNG.next()` for deterministic generation. Refactored `EndlessRadioManager` into a pure TS class to decouple from React hooks.
  - `v1.0.0`: Initial architecture documentation, defined HAL interfaces, PRNG, and C++ porting guidelines.

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
2. **Deterministic Randomness**: Never use `Math.random()`. Always use `globalPRNG.next()` from `/src/core/utils/PRNG.ts`. This ensures the same seed produces the same song on both Web and ESP32.
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
1. **Fix the Seed**: In the Web Simulator, hardcode `globalPRNG.setSeed(12345)`.
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
