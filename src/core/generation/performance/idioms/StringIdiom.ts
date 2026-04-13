/**
 * StringIdiom — Bow length limits, legato merge/detache, section stagger, overlap prevention
 */
import { PRNGManager } from '../../../utils/PRNG';
import { NoteData, GeneratedChord } from '../../types';
import { BaseIdiom } from './BaseIdiom';

const MAX_BOW_BEATS = 4.0;

export class StringIdiom extends BaseIdiom {
    apply(notes: NoteData[], _instrumentName: string, _chords: GeneratedChord[], idiomPreferences?: any): NoteData[] {
        const stringStyle: string = idiomPreferences?.stringStyle ?? 'pop';
        const isCinematic = stringStyle === 'cinematic';
        const result: NoteData[] = [];

        for (let i = 0; i < notes.length; i++) {
            const n = notes[i];
            let dur = n.duration;
            let vel = n.velocity + this.randomGaussian(0, 0.015); // micro-fluctuation
            vel = Math.min(1.0, Math.max(0.1, vel));

            // Max bow length: split long notes
            if (dur > MAX_BOW_BEATS) {
                let remaining = dur;
                let onset = n.onset;
                while (remaining > MAX_BOW_BEATS + 1e-6) {
                    const segDur = MAX_BOW_BEATS * 0.95; // slight gap for bow change
                    result.push({ pitch: n.pitch, onset, duration: segDur, velocity: vel });
                    onset += MAX_BOW_BEATS;
                    remaining -= MAX_BOW_BEATS;
                }
                result.push({ pitch: n.pitch, onset, duration: remaining * 0.95, velocity: vel });
                continue;
            }

            // Same-pitch consecutive: legato merge (pop/jazz) or detache (cinematic)
            if (i + 1 < notes.length && notes[i + 1].pitch === n.pitch) {
                const gap = notes[i + 1].onset - n.onset;
                if (isCinematic) {
                    dur = Math.min(dur, gap - 0.05); // detache: clear separation
                } else {
                    dur = gap + 0.02; // legato merge: slight overlap
                }
            }

            // Same-pitch overlap prevention with previous
            if (result.length > 0) {
                const prev = result[result.length - 1];
                if (prev.pitch === n.pitch) {
                    const prevEnd = prev.onset + prev.duration;
                    if (prevEnd > n.onset - 0.02) {
                        prev.duration = n.onset - prev.onset - 0.02;
                        if (prev.duration < 0.05) prev.duration = 0.05;
                    }
                }
            }

            result.push({ pitch: n.pitch, onset: n.onset, duration: Math.max(0.05, dur), velocity: vel });
        }
        return result;
    }

    protected getHumanizeParams(note: NoteData, index: number, chordSize: number, _isHighFirst: boolean, _isRightHand: boolean, idiomPreferences?: any): {
        strumDelay: number; timingWobble: number; velocityWobble: number; velocityMultiplier: number;
    } {
        const stringStyle: string = idiomPreferences?.stringStyle ?? 'pop';
        const isCinematic = stringStyle === 'cinematic';

        // Section entry stagger: 10-25ms per voice
        const stagger = index * (0.012 + PRNGManager.next() * 0.013);

        // Strings are slightly late (slow attack)
        const lateBias = isCinematic ? 0.005 : 0.015;
        const timingWobble = this.randomGaussian(lateBias, isCinematic ? 0.006 : 0.012);

        // Beat hierarchy
        const beatPos = note.onset % 1.0;
        let velMult = 1.0;
        if (beatPos < 0.05) velMult = 1.05;
        else if (beatPos > 0.4 && beatPos < 0.6) velMult = 0.95;

        return {
            strumDelay: stagger,
            timingWobble,
            velocityWobble: this.randomGaussian(0, 0.02),
            velocityMultiplier: velMult
        };
    }
}
