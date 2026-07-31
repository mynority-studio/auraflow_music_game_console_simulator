import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(resolve(path), 'utf8');

describe('Dream 5504 hardware MIDI output guards', () => {
    it('MidiScheduler no longer dispatches events to the browser synth fallback', () => {
        const source = read('src/core/audio/MidiScheduler.ts');
        expect(source).not.toContain("from './" + "Synth" + "Manager'");
        expect(source).not.toContain('from "./' + 'Synth' + 'Manager"');
        expect(source).not.toContain('active' + 'Synth');
        expect(source).not.toContain('synth.noteOn');
        expect(source).not.toContain('synth.programChange');
        expect(source).toContain('this.notifyMidiEventListeners(outputEvent, timestampMs);');
        expect(source).toContain('MIDI_SCHEDULE_LOOKAHEAD_MS');
    });

    it('AudioEngine requires Dream5504MidiOutput before generated or uploaded playback', () => {
        const source = read('src/core/audio/AudioEngine.ts');
        const generated = source.slice(
            source.indexOf('public async playMusicGeneration'),
            source.indexOf('public async playUploadedMidi'),
        );
        const uploaded = source.slice(
            source.indexOf('public async playUploadedMidi'),
            source.indexOf('private buildVisualEvents'),
        );

        expect(source).toContain("import { Dream5504MidiOutput } from './Dream5504MidiOutput'");
        expect(source).not.toContain("from './" + "Synth" + "Manager'");
        expect(source).not.toContain("from './audio" + "OutputPrefs'");
        expect(source).not.toContain('setPlaybackMasterStyle');
        expect(source).not.toContain('SAMPLE_RATE_OPTIONS');
        expect(generated).toContain("Dream5504MidiOutput.requireReady('播放生成音乐')");
        expect(uploaded).toContain("Dream5504MidiOutput.requireReady('播放上传 MIDI')");
        expect(generated).not.toContain('Dream5504MidiOutput.setNeutralOutputBaseline()');
        expect(uploaded).not.toContain('Dream5504MidiOutput.setNeutralOutputBaseline()');
        expect(generated).not.toContain('Dream5504MidiOutput.setGeneralMasterVolume(');
        expect(uploaded).not.toContain('Dream5504MidiOutput.setGeneralMasterVolume(');
        expect(source).not.toContain('planDream5504Master');
        expect(generated).not.toContain('Dream5504MidiOutput.applyGeneratedMasterPlan(');
        expect(generated).toContain('Dream5504MidiOutput.applyDefaultMasterVolume()');
        expect(uploaded).toContain('Dream5504MidiOutput.applyDefaultMasterVolume()');
        expect(uploaded).toContain('await Dream5504MidiOutput.enableOutput()');
        expect(uploaded).toContain('outputChannel: Math.max(1, Math.min(16, Math.round(event.channel) + 1))');
        expect(uploaded).toContain('globalMidiScheduler.loadTrack(uploadedEvents, bpm)');
        expect(uploaded).not.toContain('generateMidiAccompaniment');
        expect(generated).not.toContain('await startAudioContext()');
        expect(generated).not.toContain('active' + 'Synth.setSongSpace');
    });

    it('uploaded MIDI gain is guarded from the generated playback branch', () => {
        const source = read('src/core/audio/AudioEngine.ts');
        const setter = source.slice(
            source.indexOf('public setUploadedMidiGainScale'),
            source.indexOf('public getUploadedMidiGainScale'),
        );
        expect(setter).toContain("if (this.currentPlaybackKind !== 'uploaded')");
        expect(setter).toContain('this.uploadedMidiGainScale = 1');
    });

    it('AudioEngine realtime note and controller APIs send to Dream5504MidiOutput', () => {
        const source = read('src/core/audio/AudioEngine.ts');
        const noteOn = source.slice(source.indexOf('public noteOnAt'));
        const noteOff = source.slice(source.indexOf('public noteOffAt'));
        const program = source.slice(source.indexOf('public programChange'));
        const cc = source.slice(source.indexOf('public controllerChange'));

        expect(noteOn).toContain("Dream5504MidiOutput.sendSchedulerChannelMessage(ch, { type: 'noteOn'");
        expect(noteOff).toContain("Dream5504MidiOutput.sendSchedulerChannelMessage(ch, { type: 'noteOff'");
        expect(program).toContain("Dream5504MidiOutput.sendSchedulerChannelMessage(ch, { type: 'programChange'");
        expect(cc).toContain("Dream5504MidiOutput.sendSchedulerChannelMessage(ch, { type: 'cc'");
        expect(noteOn.slice(0, noteOn.indexOf('public noteOff'))).not.toContain('setTimeout');
        expect(noteOff.slice(0, noteOff.indexOf('public programChange'))).not.toContain('setTimeout');
        expect(noteOn).toContain('audioTime * 1000');
    });

    it('Dream5504MidiOutput owns scheduler routing and polyphony audition sending', () => {
        const source = read('src/core/audio/Dream5504MidiOutput.ts');
        expect(source).toContain('globalMidiScheduler.addMidiEventListener');
        expect(source).not.toContain('applyGeneratedMasterPlan');
        expect(source).toContain('registerMidiPolyphonyAuditionSender');
        expect(source).toContain('midiEventToRoutedMessage(event');
        expect(source).toContain('const isUploadedMidiBus = event.outputChannel !== undefined');
        expect(source).toContain('if (!isUploadedMidiBus && !isDream5504RawDefaultMessageAllowed');
        expect(source).toContain('播放需要 Dream 5504 EK MIDI 输出：未连接，已静音');
        expect(source).toContain("if (request.role !== 'drum')");
        expect(source).toContain("sendMidiMessage(output, { type: 'cc', channel, data1: 0, data2: bank })");
        expect(source).toContain('sendMidiMessage(output, routedMessage, timestampMs)');
        expect(source).toContain('(event, timestampMs) => this.routeSchedulerEvent(event, timestampMs)');
        expect(source).toContain('clearScheduledMessages()');
        expect(source).not.toContain("event.outputRouting === 'native-file'");
        expect(source).toContain('midiEventToRoutedMessage(event, this.state.channels, this.state.mode)');
    });

    it('Q+M panel is a controller for the core MIDI output singleton, not the bridge owner', () => {
        const source = read('src/core/generation/midiOutSandbox/ui/MidiOutSandboxPanel.tsx');
        expect(source).toContain('Dream5504MidiOutput.getState()');
        expect(source).toContain('Dream5504MidiOutput.subscribe');
        expect(source).not.toContain('globalMidiScheduler.addMidiEventListener');
        expect(source).not.toContain('registerMidiPolyphonyAuditionSender');
        expect(source).not.toContain('requestMidiOutputAccess');
    });

    it('SoundFontSelector auditions use AudioEngine MIDI APIs instead of the browser synth singleton', () => {
        const source = read('src/components/SoundFontSelector.tsx');
        expect(source).not.toContain('active' + 'Synth');
        expect(source).toContain('AudioEngine.controllerChange(channel, 0, bank)');
        expect(source).toContain('AudioEngine.programChange(channel');
        expect(source).not.toContain('controllerChange(channel, 32');
    });
});
