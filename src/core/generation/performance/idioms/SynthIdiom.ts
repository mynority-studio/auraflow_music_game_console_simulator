import { PRNGManager } from '../../../utils/PRNG';
import { NoteData, GeneratedChord, IdiomPreferences } from '../../types';
import { BaseIdiom } from './BaseIdiom';
import { GlobalContext } from '../../GlobalContext';

export class SynthIdiom extends BaseIdiom {
    public apply(notes: NoteData[], instrumentName: string, chords: GeneratedChord[], idiomPreferences?: IdiomPreferences): NoteData[] {
        if (notes.length === 0) return [];

        const synthStyle = idiomPreferences?.synthStyle || 'pad'; // 'pad', 'lead', 'arp'
        const energy = GlobalContext.getCurrentEnergyLevel();
        
        let result = [...notes].sort((a, b) => a.onset - b.onset);

        if (synthStyle === 'arp') {
            // ==========================================
            // 🎹 核心技法 1：琶音器 (Arpeggiator)
            // ==========================================
            // 将长和弦转换为琶音
            const arpResult: NoteData[] = [];
            const groupedByOnset = new Map<number, NoteData[]>();
            for (const note of result) {
                if (!groupedByOnset.has(note.onset)) {
                    groupedByOnset.set(note.onset, []);
                }
                groupedByOnset.get(note.onset)!.push(note);
            }

            const onsets = Array.from(groupedByOnset.keys()).sort((a, b) => a - b);
            const arpPattern = idiomPreferences?.arpPattern || 'up'; // 'up', 'down', 'updown', 'random'
            const arpRate = idiomPreferences?.arpRate || 0.25; // 16th notes by default

            for (let i = 0; i < onsets.length; i++) {
                const onset = onsets[i];
                const chordNotes = groupedByOnset.get(onset)!.sort((a, b) => a.pitch - b.pitch);
                
                if (chordNotes.length >= 2) {
                    const duration = chordNotes[0].duration;
                    const numSteps = Math.floor(duration / arpRate);
                    
                    for (let step = 0; step < numSteps; step++) {
                        let noteIndex = 0;
                        if (arpPattern === 'up') {
                            noteIndex = step % chordNotes.length;
                        } else if (arpPattern === 'down') {
                            noteIndex = (chordNotes.length - 1) - (step % chordNotes.length);
                        } else if (arpPattern === 'updown') {
                            const cycle = (chordNotes.length - 1) * 2;
                            const pos = step % cycle;
                            noteIndex = pos < chordNotes.length ? pos : cycle - pos;
                        } else if (arpPattern === 'random') {
                            noteIndex = Math.floor(PRNGManager.next() * chordNotes.length);
                        }
                        
                        const sourceNote = chordNotes[noteIndex];
                        arpResult.push({
                            pitch: sourceNote.pitch,
                            onset: onset + step * arpRate,
                            duration: arpRate * 0.8, // Gate time 80%
                            velocity: sourceNote.velocity * (0.8 + PRNGManager.next() * 0.2) // Slight velocity variation
                        });
                    }
                } else {
                    arpResult.push(...chordNotes);
                }
            }
            result = arpResult;
            
        } else if (synthStyle === 'lead') {
            // ==========================================
            // 🎹 核心技法 2：Lead 滑音与颤音 (Glide & Vibrato)
            // ==========================================
            for (let i = 0; i < result.length; i++) {
                let current = result[i];
                const nextNote = i < result.length - 1 ? result[i + 1] : null;

                // Glide (Portamento)
                if (nextNote && nextNote.onset > current.onset && nextNote.onset - current.onset <= 0.5) {
                    const pitchDiff = nextNote.pitch - current.pitch;
                    if (Math.abs(pitchDiff) <= 12 && Math.abs(pitchDiff) > 0) {
                        // Apply pitch bend to the next note to simulate glide from current note
                        nextNote.pitchBend = -pitchDiff; // Start from previous pitch
                        nextNote.pitchBendDuration = Math.min(0.15, nextNote.duration * 0.5); // Glide time
                    }
                }
                
                // Legato overlap
                if (nextNote && nextNote.onset - (current.onset + current.duration) < 0.1) {
                    current.duration = nextNote.onset - current.onset + 0.05; // Slight overlap
                }
            }
        } else if (synthStyle === 'pad') {
            // ==========================================
            // 🎹 核心技法 3：Pad 铺底 (Swell & Release)
            // ==========================================
            for (let i = 0; i < result.length; i++) {
                let current = result[i];
                
                // Pads usually have long attack and release
                // We simulate this by adjusting velocity and duration
                current.velocity = Math.min(0.7, current.velocity * 0.8); // Softer
                
                const nextNote = i < result.length - 1 ? result[i + 1] : null;
                const gapToNext = nextNote ? (nextNote.onset - (current.onset + current.duration)) : 4.0;
                
                if (gapToNext > 0) {
                    // Extend duration to simulate long release
                    const extension = Math.min(1.0, gapToNext * 0.8);
                    current.duration += extension;
                    current.fadeOutDuration = extension;
                } else {
                    // Overlap with next chord
                    current.duration += 0.5;
                    current.fadeOutDuration = 0.5;
                }
            }
        } else if (synthStyle === 'pluck') {
            // ==========================================
            // 🎹 🌟 P2: 核心技法 4：Pluck 短促拨弦 (Staccato & Delay)
            // ==========================================
            const pluckResult: NoteData[] = [];
            for (let i = 0; i < result.length; i++) {
                let current = result[i];
                
                // Pluck is very short and punchy
                current.duration = Math.min(0.15, current.duration);
                current.velocity = Math.min(1.0, current.velocity * 1.2); // Punchy attack
                
                pluckResult.push(current);
                
                // Simulate a built-in delay effect (Echo)
                if (energy > 4 && PRNGManager.next() < 0.5) {
                    pluckResult.push({
                        pitch: current.pitch,
                        onset: current.onset + 0.375, // Dotted 8th delay
                        duration: 0.1,
                        velocity: current.velocity * 0.4 // Quieter echo
                    });
                }
            }
            result = pluckResult;
        }

        return result.sort((a, b) => a.onset - b.onset);
    }

    protected getHumanizeParams(note: NoteData, index: number, chordSize: number, isHighFirst: boolean, isRightHand: boolean, idiomPreferences?: IdiomPreferences) {
        const synthStyle = idiomPreferences?.synthStyle || 'pad';
        
        if (synthStyle === 'arp') {
            return {
                strumDelay: 0,
                timingWobble: this.randomGaussian(0, 0.005), // Arps are usually quantized/tight
                velocityWobble: this.randomGaussian(0, 0.05),
                velocityMultiplier: 1.0
            };
        } else if (synthStyle === 'lead') {
            return {
                strumDelay: 0,
                timingWobble: this.randomGaussian(0, 0.02), // Leads can have some human feel
                velocityWobble: this.randomGaussian(0, 0.1),
                velocityMultiplier: 1.0
            };
        } else {
            // Pad
            return {
                strumDelay: 0.02, // Slight roll for pads
                timingWobble: this.randomGaussian(0, 0.01),
                velocityWobble: this.randomGaussian(0, 0.05),
                velocityMultiplier: 1.0
            };
        }
    }
}
