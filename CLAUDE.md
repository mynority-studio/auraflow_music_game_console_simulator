# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AuraFlow Tap! Ver.7.6** — A web-based hardware music workstation simulator that combines tactile touch interaction with procedural music generation. It simulates a 5×3 pad controller with a full algorithmic music engine (Euclidean rhythms, Markov melody chains, harmony expert system). Designed for 1:1 porting to ESP32-S3 firmware.

Research/analysis documents go in `./docs`.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Dev server on port 3000 (Vite)
npm run build        # Production build
npm run lint         # Type-check only (tsc --noEmit)
npm run clean        # Remove dist/
```

Requires `GEMINI_API_KEY` in `.env.local` (see `.env.example`).

## Architecture

### Dual-Platform Design

The codebase enforces strict separation between **Core Logic** (portable to ESP32 C++) and **Platform Layer** (Web-specific):

- `/src/core/generation/` — Pure music theory & generation algorithms. **Must remain 100% platform-agnostic** (no React, no Web APIs). Direct 1:1 translation target for C++ on ESP32-S3.
- `/src/core/hal/` — Hardware Abstraction Layer interfaces (`ILedMatrix`, `ITouchPad`, `IAudioOut`, `ISystemTimer`). Web implementations in `WebSimulatorHAL.ts`; ESP32 would provide C++ implementations.
- `/src/core/audio/` — Web-specific audio (SpessaSynth + MidiScheduler). **Replaced by I2S/FluidSynth on ESP32.**
- `/src/apps/` — Application state machines (pure TS classes, not React hooks).
- `/src/components/`, `/src/core/hardware/`, `/src/system/` — React UI for the web simulator. **Ignored in ESP32 port.**

### Music Generation Pipeline (strictly sequential)

```
MelodyEngine.generateFullSong(styleId, options)
  → StructureEngine     → SectionMetadata[] (Intro/Verse/Chorus/Bridge/Outro)
  → HarmonyCore         → GeneratedChord[] (chord progressions with voice leading)
  → EnsembleDrafter     → EnsembleDraft (instrument palette selection)
  → ToplineEngine       → NoteData[] (melody with GrooveDNA rhythm fingerprints)
  → Orchestrator        → ArrangedTrack (piano LH/RH, bass, drums, counter melody)
  → InstrumentIdiom     → Humanized per-instrument performance
  → SingerPersona       → Vocal expression (grace notes, pitch bends, breath breaks)
```

Output is pure data (`ArrangedTrack`) — no audio playback happens during generation.

### Audio Playback Pipeline

```
ArrangedTrack → PlaybackEngine → MidiEvent[] → MidiScheduler (5ms tick loop)
  → SpessaSynth (SF2 synthesis) → AudioMixer (compressor + makeup gain) → speakers
  → VisualEvent → LedMatrix (LED visualization)
```

All mixing uses MIDI CC messages (CC7=Volume, CC10=Pan, CC91=Reverb). No Web Audio GainNodes for per-track mixing.

### Key Singletons

| Singleton | File | Purpose |
|---|---|---|
| `globalPRNG` | `core/utils/PRNG.ts` | Deterministic LCG random — never use `Math.random()` |
| `globalMidiScheduler` | `core/audio/MidiScheduler.ts` | MIDI event dispatch (5ms tick, mimics FreeRTOS timer) |
| `AudioEngine` | `core/audio/AudioEngine.ts` | SpessaSynth lifecycle & playback orchestration |
| `GlobalContext` | `core/generation/GlobalContext.ts` | Shared musical state (BPM, key, tonality, time sig) |

### Style System

13 style configs in `/src/core/generation/config/styles/` (ClassicJPop, LofiHipHop, Synthwave, GhibliOrchestral, etc.). Each defines harmonic pools, rhythm params, melodic constraints, orchestration, and allowed vocalist personas. Adding a new style = add one file, no core changes.

### Idiom System

Instrument-specific renderers in `/src/core/generation/performance/idioms/` (Piano, Guitar, String, Drum, Bass, Wind, SynthVoice). Each takes shared `HarmonyState` and outputs instrument-appropriate `NoteData`. The `InstrumentIdiom` dispatcher routes by instrument name.

## Critical Development Rules

1. **No React in `/src/core/`** — Core generation must be pure TS classes/functions. No `useState`, `useEffect`, JSX.
2. **No `Math.random()`** — Always use `globalPRNG.next()`. Same seed must produce identical output on Web and ESP32.
3. **No Tone.js** — All audio via `MidiScheduler` + SpessaSynth. Mixing via MIDI CC only.
4. **Memory-conscious in core** — Avoid object creation in tight loops. Prefer pre-allocated arrays / TypedArrays. `TrackSerializer` demonstrates the flat-memory pattern for C++ interop.
5. **Pure data output** — `ArrangedTrack` must be JSON-serializable. No functions or class instances in generation output.
6. **All instruments share harmony** — Every instrument reads from the same `HarmonyState` produced by `HarmonyCore`. Instruments never generate their own chord progressions.

## Verification: Golden Seed Test

To verify C++ port parity: fix seed via `globalPRNG.setSeed(12345)`, generate, serialize output, then compare byte-for-byte with C++ output. Any divergence indicates a logic error (float precision, sort order, or missed PRNG call).

## Tech Stack

- **Framework**: React 19 + TypeScript 5.8 + Vite 6
- **Styling**: Tailwind CSS 4 (via `@tailwindcss/vite`)
- **Audio**: SpessaSynth (SF2 web synthesizer) + Web Audio API
- **Soundfont**: `public/GM128_3MB.sf2` (General MIDI 128 instruments)
- **Animation**: Motion (Framer Motion successor)
- **AI**: Google Gemini API (`@google/genai`)
- **Path alias**: `@/` maps to project root
