import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(resolve(path), 'utf8');

describe('Copych output chain bypass guards', () => {
    it('AudioWorklet processor always hands rendered PCM to device_postchain', () => {
        const source = read('public/copych/copych_processor.js');
        expect(source).toContain('this.M._copych_wasm_render(this.pL, this.pR, len)');
        expect(source).toContain('this.postchain.process(out[0], out[1] || out[0], len);');
        expect(source).not.toMatch(/if\s*\(\s*this\.postchain\.isActive\(\)\s*\)\s*\{\s*this\.postchain\.process/s);
    });

    it('device_postchain defaults to temporary SF2-direct bypass, while preserving 24k EQ gating for enabled audits', () => {
        const source = read('public/copych/device_postchain.mjs');
        expect(source).toContain('DEVICE_POSTCHAIN_DEFAULT_PRESET');
        expect(source).toContain('enabled: false');
        expect(source).toContain('isActive() { return cfg.enabled; }');
        expect(source).toContain('if (!cfg.enabled) return;');
        expect(source).toContain('const eqActive = cfg.eq && eqRateOk;');
        expect(source).not.toContain('cfg.enabled = true;');
        expect(source).not.toContain('if (!cfg.enabled || !srOk) return');
    });

    it('facade applies the SF2-direct postchain preset during init, before the synth is exposed', () => {
        const source = read('src/core/audio/copych/CopychSynthFacade.ts');
        expect(source).toContain('export const COPYCH_DEVICE_POSTCHAIN_PRESET');
        expect(source).toContain('enabled: false');
        expect(source).toContain('this.setDevicePostChain(COPYCH_DEVICE_POSTCHAIN_PRESET)');
        expect(source).toContain('COPYCH_MASTER_LIFT_MIN = 0.05');
        expect(source).toContain('COPYCH_MASTER_LIFT_MAX = 4');
    });

    it('SoundFontSelector exposes masterLift as the master volume fader', () => {
        const source = read('src/components/SoundFontSelector.tsx');
        expect(source).toContain('id="copych-master-volume"');
        expect(source).toContain('type="range"');
        expect(source).toContain('COPYCH_MASTER_LIFT_MIN');
        expect(source).toContain('COPYCH_MASTER_LIFT_MAX');
        expect(source).toContain('setCopychDevicePostChain({ masterLift: Number(event.target.value) })');
        expect(source).not.toContain('trimDb');
        expect(source).toContain('直出');
        expect(source).toContain('enabled: true, gain: true, eq: true, softclip: true, quantize: true');
        expect(source).not.toContain('setCopychDevicePostChain({ enabled: !pcState.cfg.enabled })');
    });

    it('SoundFontSelector keeps only the Aura25 runtime bank while preserving raw bank/program audition', () => {
        const synth = read('src/core/audio/SynthManager.ts');
        const ui = read('src/components/SoundFontSelector.tsx');
        expect(synth).toContain('Aura25 24k Micro');
        expect(synth).not.toContain('piano-audition');
        expect(ui).not.toContain('PIANO_AUDITION_INSTRUMENTS');
        expect(ui).not.toContain('piano-audition');
        expect(ui).toContain('activeSynth.controllerChange(channel, 0');
        expect(ui).toContain('activeSynth.controllerChange(channel, 32');
        expect(ui).toContain('activeSynth.programChange(channel');
    });

    it('official playback sample-rate options are locked to the 24 kHz SF2 rate', () => {
        const source = read('src/core/audio/audioOutputPrefs.ts');
        expect(source).toContain('export type SampleRatePref = 24000');
        expect(source).toContain('SAMPLE_RATE_OPTIONS: readonly SampleRatePref[] = [24000]');
        expect(source).not.toMatch(/22050\s*\|\s*24000|24000\s*\|\s*44100|44100\s*\|\s*48000/);
    });

    it('SynthManager has one transparent Copych output graph and no browser master bypass', () => {
        const source = read('src/core/audio/SynthManager.ts');
        expect(source).toContain('synth.connect(unityOut)');
        expect(source).toContain('unityOut.connect(channelMode)');
        expect(source).toContain('channelMode.connect(ctx.destination)');
        expect(source).toContain('synth.setDevicePostChain({ masterLift: _playbackMasterLift })');
        expect(source).not.toMatch(/createDynamicsCompressor|createWaveShaper|createBiquadFilter/);
    });

    it('generated playback consumes style master lift and song space before scheduler start', () => {
        const source = read('src/core/audio/AudioEngine.ts');
        const method = source.slice(source.indexOf('public async playMusicGeneration'));
        const idxMaster = method.indexOf('setPlaybackMasterStyle(result.styleHint)');
        const idxSpace = method.indexOf('activeSynth.setSongSpace({');
        const idxLoad = method.indexOf('globalMidiScheduler.loadTrack([...events, ...visuals], result.bpm)');
        const idxStart = method.indexOf('globalMidiScheduler.start()');

        expect(idxMaster).toBeGreaterThanOrEqual(0);
        expect(idxSpace).toBeGreaterThanOrEqual(0);
        expect(idxLoad).toBeGreaterThanOrEqual(0);
        expect(idxStart).toBeGreaterThanOrEqual(0);
        expect(idxMaster).toBeLessThan(idxLoad);
        expect(idxSpace).toBeLessThan(idxLoad);
        expect(idxLoad).toBeLessThan(idxStart);
    });

    it('uploaded MIDI resets song FX to Copych boot state before playback', () => {
        const source = read('src/core/audio/AudioEngine.ts');
        const method = source.slice(source.indexOf('public async playUploadedMidi'));
        const idxBoot = method.indexOf('activeSynth.setSongSpace(COPYCH_FX_BOOT)');
        const idxLoad = method.indexOf('globalMidiScheduler.loadTrack(events, bpm)');
        const idxStart = method.indexOf('globalMidiScheduler.start()');

        expect(idxBoot).toBeGreaterThanOrEqual(0);
        expect(idxLoad).toBeGreaterThanOrEqual(0);
        expect(idxStart).toBeGreaterThanOrEqual(0);
        expect(idxBoot).toBeLessThan(idxLoad);
        expect(idxLoad).toBeLessThan(idxStart);
    });
});
