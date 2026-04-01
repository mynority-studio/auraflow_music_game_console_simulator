import { spessaSynth } from '../core/audio/SynthManager';

// ==========================================
// SYSTEM MENU EXCLUSIVE AUDIO ENGINE
// ==========================================
// 这个文件锁定了 AuraSystem 的专属音色和效果器。
// 无论其他 App 如何修改 core/audio/AudioEngine.ts，
// 系统菜单的声音永远保持最初的空灵感和交互反馈。

// MIDI Channel 15 for System Lead Synth
const LEAD_CHANNEL = 15;
// MIDI Channel 9 for Drums (Standard MIDI Drum Channel)
const DRUM_CHANNEL = 9;

// Helper to convert note name to MIDI number
function noteToMidi(note: string | number): number {
    if (typeof note === 'number') return note;
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const match = note.match(/^([A-G]#?)(-?\d+)$/);
    if (!match) return 60;
    const n = notes.indexOf(match[1]);
    const oct = parseInt(match[2], 10);
    return (oct + 1) * 12 + n;
}

// Convert duration strings to seconds (approximate for UI sounds)
function durationToSeconds(dur: string | number): number {
    if (typeof dur === 'number') return dur;
    if (dur === '16n') return 0.125;
    if (dur === '8n') return 0.25;
    if (dur === '4n') return 0.5;
    if (dur === '2n') return 1.0;
    if (dur === '32n') return 0.0625;
    return 0.5;
}

let isInitialized = false;

function initSystemAudio() {
    if (!spessaSynth || isInitialized) return;
    
    // Setup Lead Synth on Channel 15
    spessaSynth.programChange(LEAD_CHANNEL, 11); // Vibraphone (ethereal)
    spessaSynth.controllerChange(LEAD_CHANNEL, 7, 100); // Volume
    spessaSynth.controllerChange(LEAD_CHANNEL, 91, 127); // Reverb max
    spessaSynth.controllerChange(LEAD_CHANNEL, 93, 64); // Chorus
    
    // Setup Drums on Channel 9
    spessaSynth.controllerChange(DRUM_CHANNEL, 7, 100); // Volume
    spessaSynth.controllerChange(DRUM_CHANNEL, 91, 64); // Reverb
    
    isInitialized = true;
}

export const systemLeadSynth = {
    triggerAttackRelease: (notes: string | number | (string | number)[], duration: string | number, timeDelaySeconds: number = 0, velocity: number = 0.5) => {
        if (!spessaSynth) return;
        initSystemAudio();
        
        const noteArray = Array.isArray(notes) ? notes : [notes];
        const durSecs = durationToSeconds(duration);
        const velMidi = Math.floor(velocity * 127);
        
        setTimeout(() => {
            noteArray.forEach(note => {
                const midiNote = noteToMidi(note);
                if (spessaSynth) {
                    spessaSynth.noteOn(LEAD_CHANNEL, midiNote, velMidi);
                    setTimeout(() => {
                        if (spessaSynth) spessaSynth.noteOff(LEAD_CHANNEL, midiNote);
                    }, durSecs * 1000);
                }
            });
        }, timeDelaySeconds * 1000);
    }
};

export const systemAudio = {
    triggerKick: (timeDelaySeconds: number = 0, velocity: number = 1) => {
        if (!spessaSynth) return;
        initSystemAudio();
        const velMidi = Math.floor(velocity * 127);
        setTimeout(() => {
            if (spessaSynth) {
                spessaSynth.noteOn(DRUM_CHANNEL, 36, velMidi); // Bass Drum 1
                setTimeout(() => { if (spessaSynth) spessaSynth.noteOff(DRUM_CHANNEL, 36); }, 100);
            }
        }, timeDelaySeconds * 1000);
    },
    triggerSnare: (timeDelaySeconds: number = 0, velocity: number = 1) => {
        if (!spessaSynth) return;
        initSystemAudio();
        const velMidi = Math.floor(velocity * 127);
        setTimeout(() => {
            if (spessaSynth) {
                spessaSynth.noteOn(DRUM_CHANNEL, 38, velMidi); // Acoustic Snare
                setTimeout(() => { if (spessaSynth) spessaSynth.noteOff(DRUM_CHANNEL, 38); }, 100);
            }
        }, timeDelaySeconds * 1000);
    },
    triggerHiHat: (timeDelaySeconds: number = 0, velocity: number = 1) => {
        if (!spessaSynth) return;
        initSystemAudio();
        const velMidi = Math.floor(velocity * 127);
        setTimeout(() => {
            if (spessaSynth) {
                spessaSynth.noteOn(DRUM_CHANNEL, 42, velMidi); // Closed Hi-Hat
                setTimeout(() => { if (spessaSynth) spessaSynth.noteOff(DRUM_CHANNEL, 42); }, 100);
            }
        }, timeDelaySeconds * 1000);
    },
    triggerTom: (timeDelaySeconds: number = 0, velocity: number = 1) => {
        if (!spessaSynth) return;
        initSystemAudio();
        const velMidi = Math.floor(velocity * 127);
        setTimeout(() => {
            if (spessaSynth) {
                spessaSynth.noteOn(DRUM_CHANNEL, 45, velMidi); // Low Tom
                setTimeout(() => { if (spessaSynth) spessaSynth.noteOff(DRUM_CHANNEL, 45); }, 100);
            }
        }, timeDelaySeconds * 1000);
    },
    triggerCrash: (timeDelaySeconds: number = 0, velocity: number = 1) => {
        if (!spessaSynth) return;
        initSystemAudio();
        const velMidi = Math.floor(velocity * 127);
        setTimeout(() => {
            if (spessaSynth) {
                spessaSynth.noteOn(DRUM_CHANNEL, 49, velMidi); // Crash Cymbal 1
                setTimeout(() => { if (spessaSynth) spessaSynth.noteOff(DRUM_CHANNEL, 49); }, 100);
            }
        }, timeDelaySeconds * 1000);
    }
};
