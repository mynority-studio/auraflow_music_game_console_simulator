/**
 * DrumIdiom — Ghost notes, hi-hat logic, Dilla groove, rudiments
 * MIDI: KICK=36, SNARE=38, CHH=42, OHH=46, TOM_LOW=45, TOM_MID=47, TOM_HI=48
 */
import { PRNGManager } from '../../../utils/PRNG';
import { NoteData, GeneratedChord } from '../../types';
import { BaseIdiom } from './BaseIdiom';

const KICK = 36;
const SNARE = 38;
const CHH = 42;
const OHH = 46;

export class DrumIdiom extends BaseIdiom {
    apply(notes: NoteData[], _instrumentName: string, _chords: GeneratedChord[], idiomPreferences?: any): NoteData[] {
        const drumStyle: string = idiomPreferences?.drumStyle ?? 'pop';
        const ghostProb = drumStyle === 'lofi' ? 0.35 : drumStyle === 'funk' ? 0.40 : drumStyle === 'rock' ? 0.15 : 0.20;
        const ohhProb = drumStyle === 'lofi' ? 0.25 : drumStyle === 'funk' ? 0.30 : drumStyle === 'house' ? 0.15 : 0.10;

        const result: NoteData[] = [];
        // Collect existing onsets for overlap check
        const existingOnsets: number[] = [];
        for (let i = 0; i < notes.length; i++) {
            existingOnsets.push(notes[i].onset);
        }

        for (let i = 0; i < notes.length; i++) {
            const n = notes[i];
            result.push({ pitch: n.pitch, onset: n.onset, duration: n.duration, velocity: n.velocity });

            // Ghost note injection on 16th weak beats near snare/kick
            if ((n.pitch === KICK || n.pitch === SNARE) && PRNGManager.next() < ghostProb) {
                const ghostOffset = (Math.floor(PRNGManager.next() * 3) + 1) * 0.25; // 0.25, 0.5, 0.75
                const ghostOnset = n.onset + ghostOffset;
                // Avoid overlap with existing notes
                let overlap = false;
                for (let j = 0; j < existingOnsets.length; j++) {
                    if (Math.abs(existingOnsets[j] - ghostOnset) < 0.12) { overlap = true; break; }
                }
                if (!overlap) {
                    result.push({ pitch: SNARE, onset: ghostOnset, duration: 0.1, velocity: 0.25 + PRNGManager.next() * 0.15 });
                }
            }

            // Open hi-hat on offbeats
            if (n.pitch === CHH && (n.onset % 1.0 > 0.4) && PRNGManager.next() < ohhProb) {
                result[result.length - 1].pitch = OHH;
                result[result.length - 1].duration = 0.4;
            }
        }
        return result;
    }

    humanize(notes: NoteData[], swingRatio: number, swingSubdivision: number, _isRightHand: boolean = false, idiomPreferences?: any): NoteData[] {
        const drumStyle: string = idiomPreferences?.drumStyle ?? 'pop';
        const result: NoteData[] = [];

        for (let i = 0; i < notes.length; i++) {
            const n = notes[i];
            let timingOffset = 0;
            let velMult = 1.0;

            // Dilla groove: snare slightly late
            if (n.pitch === SNARE) {
                timingOffset = drumStyle === 'lofi' ? 0.04 + PRNGManager.next() * 0.03 : PRNGManager.next() * 0.015;
            } else if (n.pitch === KICK) {
                timingOffset = this.randomGaussian(0, drumStyle === 'funk' ? 0.005 : 0.01);
            } else if (n.pitch === CHH || n.pitch === OHH) {
                // Left/right hand alternation
                const isLeft = i % 2 === 0;
                velMult = isLeft ? 0.92 : 1.0;
                timingOffset = drumStyle === 'lofi' ? PRNGManager.next() * 0.025 - 0.01 : this.randomGaussian(0, 0.008);
            }

            // Flam/drag rudiment (5% on snare/toms)
            if ((n.pitch === SNARE || (n.pitch >= 45 && n.pitch <= 48)) && PRNGManager.next() < 0.05) {
                result.push({ pitch: n.pitch, onset: Math.max(0, n.onset - 0.04), duration: 0.05, velocity: n.velocity * 0.45 });
            }

            const { swingDelay, newDuration } = this.applySwing(n.onset, n.duration, swingRatio, swingSubdivision);
            result.push({
                pitch: n.pitch,
                onset: Math.max(0, n.onset + timingOffset + swingDelay),
                duration: newDuration,
                velocity: Math.min(1.0, Math.max(0.1, n.velocity * velMult))
            });
        }
        return result;
    }

    protected getHumanizeParams(_note: NoteData, _index: number, _chordSize: number, _isHighFirst: boolean, _isRightHand: boolean): {
        strumDelay: number; timingWobble: number; velocityWobble: number; velocityMultiplier: number;
    } {
        return { strumDelay: 0, timingWobble: 0, velocityWobble: 0, velocityMultiplier: 1.0 };
    }
}
