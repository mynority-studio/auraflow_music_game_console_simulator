/**
 * PianoIdiom — Smart pedal, strum delay, jazz/cinematic velocity caps, beat hierarchy
 */
import { PRNGManager } from '../../../utils/PRNG';
import { NoteData, GeneratedChord } from '../../types';
import { BaseIdiom } from './BaseIdiom';

export class PianoIdiom extends BaseIdiom {
    apply(notes: NoteData[], _instrumentName: string, chords: GeneratedChord[], idiomPreferences?: any): NoteData[] {
        const pianoStyle: string = idiomPreferences?.pianoStyle ?? 'pop';
        const velCap = pianoStyle === 'jazz' ? 0.85 : pianoStyle === 'cinematic' ? 0.65 : 0.75;
        const result: NoteData[] = [];

        for (let i = 0; i < notes.length; i++) {
            const n = notes[i];
            let dur = n.duration;
            let vel = Math.min(n.velocity, velCap);

            // Smart pedal: extend non-fast notes to chord boundary
            if (dur > 0.3) {
                for (let c = 0; c < chords.length; c++) {
                    if (n.onset >= chords[c].startBeat - 1e-6 && n.onset < chords[c].endBeat - 1e-6) {
                        const chordEnd = chords[c].endBeat;
                        const maxDur = chordEnd - n.onset;
                        if (maxDur > dur) dur = maxDur * 0.95; // slight release before chord change
                        break;
                    }
                }
            }

            // Legato overlap for consecutive notes
            if (i + 1 < notes.length) {
                const gap = notes[i + 1].onset - n.onset;
                if (gap > 0 && gap < dur) {
                    dur = gap + 0.05; // slight overlap
                }
            }

            result.push({ pitch: n.pitch, onset: n.onset, duration: dur, velocity: vel });
        }
        return result;
    }

    protected getHumanizeParams(note: NoteData, index: number, chordSize: number, isHighFirst: boolean, isRightHand: boolean, idiomPreferences?: any): {
        strumDelay: number; timingWobble: number; velocityWobble: number; velocityMultiplier: number;
    } {
        const pianoStyle: string = idiomPreferences?.pianoStyle ?? 'pop';
        const isJazz = pianoStyle === 'jazz';

        // Strum delay: 10-20ms per finger in chord
        const strumPerFinger = 0.012 + PRNGManager.next() * 0.008; // 0.012-0.020 beats
        const order = isHighFirst ? (chordSize - 1 - index) : index;
        const strumDelay = order * strumPerFinger;

        // Timing wobble
        let timingWobble = this.randomGaussian(0, 0.01);
        if (isJazz) timingWobble += 0.015 + PRNGManager.next() * 0.01; // jazz: overall late

        // Beat hierarchy velocity
        const beatPos = note.onset % 1.0;
        let velMult = 1.0;
        if (beatPos < 0.05) velMult = 1.08;        // beat 1 accent
        else if (Math.abs(beatPos - 0.5) < 0.05) velMult = 1.02; // beat 3 slight accent
        else if (beatPos > 0.2 && beatPos < 0.4) velMult = 0.92; // offbeat softer
        if (isJazz && beatPos > 0.4) velMult *= 1.06; // jazz offbeat emphasis

        // Right hand top note accent
        if (isRightHand && index === chordSize - 1) velMult *= 1.05;

        return {
            strumDelay,
            timingWobble,
            velocityWobble: this.randomGaussian(0, 0.025),
            velocityMultiplier: velMult
        };
    }
}
