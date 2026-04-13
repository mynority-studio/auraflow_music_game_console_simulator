/**
 * BassIdiom — Legato/staccato control, velocity layers, groove timing
 */
import { PRNGManager } from '../../../utils/PRNG';
import { NoteData, GeneratedChord } from '../../types';
import { BaseIdiom } from './BaseIdiom';

export class BassIdiom extends BaseIdiom {
    apply(notes: NoteData[], _instrumentName: string, chords: GeneratedChord[], idiomPreferences?: any): NoteData[] {
        const bassStyle: string = idiomPreferences?.bassStyle ?? 'pop';
        const isLofi = bassStyle === 'lofi' || bassStyle === 'folk';
        const isFunk = bassStyle === 'funk';
        const result: NoteData[] = [];

        for (let i = 0; i < notes.length; i++) {
            const n = notes[i];
            // Determine note role by checking against chord roots
            let isRoot = false;
            for (let c = 0; c < chords.length; c++) {
                if (n.onset >= chords[c].startBeat - 1e-6 && n.onset < chords[c].endBeat - 1e-6) {
                    if (n.pitch % 12 === chords[c].root % 12) isRoot = true;
                    break;
                }
            }
            const isGhost = n.velocity < 0.4;

            // Velocity shaping
            let vel = isRoot ? 0.65 + PRNGManager.next() * 0.15
                     : isGhost ? 0.35 + PRNGManager.next() * 0.15
                     : 0.55 + PRNGManager.next() * 0.13;
            if (isLofi) vel *= 0.85;
            if (isFunk) {
                const beatPos = n.onset % 1.0;
                vel *= beatPos < 0.1 ? 1.1 : 0.9; // strong downbeat contrast
            }
            vel = Math.min(1.0, Math.max(0.1, vel));

            // Legato vs staccato
            let dur = n.duration;
            if (bassStyle === 'staccato' || (isFunk && n.duration > 0.3)) {
                dur = Math.min(dur, 0.25 + PRNGManager.next() * 0.1);
            } else if (bassStyle === 'legato') {
                // Extend slightly toward next note
                if (i + 1 < notes.length) {
                    const gap = notes[i + 1].onset - n.onset;
                    dur = Math.min(dur, gap * 0.95);
                }
            }

            result.push({ pitch: n.pitch, onset: n.onset, duration: dur, velocity: vel });
        }
        return result;
    }

    protected getHumanizeParams(note: NoteData, _index: number, _chordSize: number, _isHighFirst: boolean, _isRightHand: boolean, idiomPreferences?: any): {
        strumDelay: number; timingWobble: number; velocityWobble: number; velocityMultiplier: number;
    } {
        const bassStyle: string = idiomPreferences?.bassStyle ?? 'pop';
        const isLofi = bassStyle === 'lofi' || bassStyle === 'folk';
        const beatPos = note.onset % 1.0;

        // Downbeat slightly early, offbeat slightly late
        let timing = beatPos < 0.1 ? -0.008 : beatPos > 0.4 ? 0.008 : 0;
        timing += this.randomGaussian(0, 0.008);
        if (isLofi) timing += 0.01; // extra lag

        return {
            strumDelay: 0,
            timingWobble: timing,
            velocityWobble: this.randomGaussian(0, 0.03),
            velocityMultiplier: 1.0
        };
    }
}
