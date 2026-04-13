/**
 * SynthIdiom — Pad (soft+fade), Lead (pitch bend+legato), Pluck (short+echo), Arp (tight)
 */
import { PRNGManager } from '../../../utils/PRNG';
import { NoteData, GeneratedChord } from '../../types';
import { BaseIdiom } from './BaseIdiom';

export class SynthIdiom extends BaseIdiom {
    apply(notes: NoteData[], _instrumentName: string, _chords: GeneratedChord[], idiomPreferences?: any): NoteData[] {
        const synthStyle: string = idiomPreferences?.synthStyle ?? 'pad';
        const result: NoteData[] = [];

        for (let i = 0; i < notes.length; i++) {
            const n = notes[i];
            let pitch = n.pitch;
            let dur = n.duration;
            let vel = n.velocity;
            let fadeOut: number | undefined;
            let pitchBend: number | undefined;
            let pitchBendDuration: number | undefined;

            if (synthStyle === 'pad') {
                // Pad: softer, extended with fade
                vel = Math.min(vel, 0.70);
                dur *= 1.15;
                fadeOut = dur * 0.3;
            } else if (synthStyle === 'lead') {
                // Lead: pitch bend for close intervals, legato overlap
                if (i + 1 < notes.length) {
                    const interval = Math.abs(notes[i + 1].pitch - pitch);
                    if (interval <= 2 && interval > 0) {
                        pitchBend = (notes[i + 1].pitch - pitch) * 0.5;
                        pitchBendDuration = dur * 0.3;
                    }
                    const gap = notes[i + 1].onset - n.onset;
                    if (gap > 0) dur = gap + 0.03; // legato overlap
                }
            } else if (synthStyle === 'pluck') {
                // Pluck: short, punchy
                dur = Math.min(dur, 0.15);
                vel = Math.min(1.0, vel * 1.15);

                // Dotted-8th echo (0.75 beats later, softer)
                if (PRNGManager.next() < 0.35) {
                    const echoOnset = n.onset + 0.75;
                    result.push({ pitch, onset: echoOnset, duration: 0.12, velocity: vel * 0.45 });
                }
            }
            // arp: no special apply processing, handled in humanize

            const out: NoteData = { pitch, onset: n.onset, duration: Math.max(0.05, dur), velocity: Math.min(1.0, Math.max(0.1, vel)) };
            if (fadeOut !== undefined) out.fadeOutDuration = fadeOut;
            if (pitchBend !== undefined) {
                out.pitchBend = pitchBend;
                out.pitchBendDuration = pitchBendDuration;
            }
            result.push(out);
        }
        return result;
    }

    protected getHumanizeParams(note: NoteData, index: number, chordSize: number, _isHighFirst: boolean, _isRightHand: boolean, idiomPreferences?: any): {
        strumDelay: number; timingWobble: number; velocityWobble: number; velocityMultiplier: number;
    } {
        const synthStyle: string = idiomPreferences?.synthStyle ?? 'pad';

        if (synthStyle === 'arp') {
            // Arp: very tight, almost quantized
            return {
                strumDelay: 0,
                timingWobble: this.randomGaussian(0, 0.003),
                velocityWobble: this.randomGaussian(0, 0.01),
                velocityMultiplier: 1.0
            };
        }
        if (synthStyle === 'lead') {
            // Lead: some human feel
            return {
                strumDelay: 0,
                timingWobble: this.randomGaussian(0, 0.012),
                velocityWobble: this.randomGaussian(0, 0.025),
                velocityMultiplier: 1.0
            };
        }
        if (synthStyle === 'pluck') {
            return {
                strumDelay: 0,
                timingWobble: this.randomGaussian(0, 0.006),
                velocityWobble: this.randomGaussian(0, 0.015),
                velocityMultiplier: 1.0
            };
        }
        // Pad: slight roll for chord voicings
        const stagger = index * (0.008 + PRNGManager.next() * 0.008);
        return {
            strumDelay: stagger,
            timingWobble: this.randomGaussian(0, 0.015),
            velocityWobble: this.randomGaussian(0, 0.02),
            velocityMultiplier: 1.0
        };
    }
}
