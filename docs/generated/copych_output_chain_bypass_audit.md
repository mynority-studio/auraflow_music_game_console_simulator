# Copych Output Chain Bypass Audit

Scope: browser Copych playback path and ESP32-equivalent output chain.

Current required route:

```text
MusicalIR TrackMix/CC
  -> musicalIRToMidiEvents(CC7/10/11/64/72/91/93/95)
  -> MidiScheduler
  -> CopychSynthFacade
  -> copych_processor.js
  -> copych_wasm_render
  -> device_postchain.process
  -> AudioContext destination
```

Official sample-rate contract: Aura25 SF2 samples are locked to `24000 Hz`; browser and ESP32 playback must request `24000 Hz` as the native rate. Non-24 kHz handling in `device_postchain` is only a defensive fallback for browsers/hardware that refuse the requested AudioContext rate, not a selectable playback mode.

## Disallowed bypasses now guarded

- Processor cannot skip `device_postchain.process()` with a second `isActive()` gate.
- `device_postchain.enabled=false` cannot bypass the full chain; the compatibility field is coerced back to `true`.
- `device_postchain` cannot bypass the full chain just because the browser AudioContext is not 24 kHz.
- User-facing sample-rate options cannot expose 22.05/44.1/48 kHz while the runtime SF2 is locked to 24 kHz.
- The device chain default is active and user-facing UI shows it as always-on, so startup does not depend on a later UI toggle to enable gain/clip/mono/clamp.
- Generated playback must apply style `masterLift` and per-song `SongSpaceProfile` before `MidiScheduler.start()`.
- Uploaded MIDI must reset Copych FX to boot state before playback, so the previous song's space does not leak.
- `SynthManager` must keep a transparent Copych-only graph and must not add a browser compressor/waveshaper/biquad master path after Copych.

Guard test:

```text
src/core/audio/copychOutputChainGuards.test.ts
```

## Allowed / intentional bypasses

- `device_postchain.eq` at non-24 kHz: only the 6-band speaker EQ is bypassed because its coefficients are 24 kHz-specific. Gain, softclip, mono fold, quantization, meters, and final clamp still run.
- `FxDelay` when `SongSpaceProfile.delayMode=off`: musical design, not output bypass.
- `copych_processor` before `ready`: startup silence only; no synth PCM exists yet.
- User channel mute / panic / stop: explicit playback control.

## Verification Commands

- `pnpm exec vitest run src/core/audio/copychOutputChainGuards.test.ts src/core/audio/copych/devicePostChain.test.ts src/core/audio/copychBackend.test.ts src/core/audio/MidiScheduler.test.ts src/core/generation/newEngine/sandbox/irToMidiMix.test.ts src/core/generation/newEngine/sandbox/irToMidi.test.ts src/core/generation/newEngine/render/renderMixAudit.test.ts`
- `pnpm audit:mix`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
