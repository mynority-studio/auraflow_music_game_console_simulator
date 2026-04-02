import { NoteData, GeneratedChord, RuntimeIdiomPreferences } from '../../types';
import { BaseIdiom } from './BaseIdiom';

export class WindIdiom extends BaseIdiom {
    public apply(notes: NoteData[], instrumentName: string, chords: GeneratedChord[], idiomPreferences?: RuntimeIdiomPreferences): NoteData[] {
        if (notes.length === 0) return [];

        // 1. Sort by onset, then by pitch (descending) so we can pick the highest note if there's a chord
        const sorted = [...notes].sort((a, b) => {
            if (Math.abs(a.onset - b.onset) < 0.01) {
                return b.pitch - a.pitch; // Highest pitch first
            }
            return a.onset - b.onset;
        });

        const monophonicNotes: NoteData[] = [];
        let currentNote: NoteData | null = null;

        // 2. Enforce Monophonic (No overlapping notes)
        for (const note of sorted) {
            if (!currentNote) {
                currentNote = { ...note };
                continue;
            }

            // If this note starts at the same time as the current note, ignore it (we already picked the highest pitch)
            if (Math.abs(note.onset - currentNote.onset) < 0.01) {
                continue;
            }

            // If the current note overlaps with the next note, cut it short
            // 大跨度音符的「音符长度」衔接紧密，间隙≤10ms（避免空拍）；禁用「音符重叠」
            // 这里我们设置 duration 刚好到下一个音符的 onset，或者留极小的缝隙
            if (currentNote.onset + currentNote.duration > note.onset) {
                // 假设 120 BPM, 1 beat = 0.5s. 10ms = 0.02 beats.
                const gapBeats = 0.02; 
                // 严格截断，确保不会超过下一个音符的 onset，最少保留 0.01 拍
                currentNote.duration = Math.max(0.01, note.onset - currentNote.onset - gapBeats);
            }

            monophonicNotes.push(currentNote);
            currentNote = { ...note };
        }

        if (currentNote) {
            monophonicNotes.push(currentNote);
        }

        // 3. Smooth velocities for legato phrases and large jumps (simulate continuous breath)
        for (let i = 1; i < monophonicNotes.length; i++) {
            const prev = monophonicNotes[i - 1];
            const curr = monophonicNotes[i];
            
            const gap = curr.onset - (prev.onset + prev.duration);
            const pitchDiff = Math.abs(curr.pitch - prev.pitch);
            
            // If it's a legato transition (gap <= 0.1 beats) or a large jump (>= 7 semitones)
            if (gap <= 0.1 || pitchDiff >= 7) {
                // Smooth the velocity to avoid sudden jumps in breath
                // 力度（Velocity）统一（±3 以内，即 3/127 ≈ 0.024），避免突然飙高 / 降低
                const velocityDiff = curr.velocity - prev.velocity;
                const maxDiff = pitchDiff >= 7 ? 0.024 : 0.05; // 大跳时力度更严格
                
                if (Math.abs(velocityDiff) > maxDiff) {
                    curr.velocity = prev.velocity + Math.sign(velocityDiff) * maxDiff;
                }
            }
        }

        return monophonicNotes;
    }

    protected getHumanizeParams(note: NoteData, index: number, chordSize: number, isHighFirst: boolean, isRightHand: boolean, idiomPreferences?: RuntimeIdiomPreferences) {
        // Wind instruments are monophonic, so chordSize should be 1.
        // We add a very slight timing wobble and velocity wobble.
        return {
            strumDelay: 0, // No strumming
            timingWobble: this.randomGaussian(0, 0.01), // Very tight timing
            velocityWobble: this.randomGaussian(0, 0.02), // Very stable breath
            velocityMultiplier: 1.0
        };
    }
}
