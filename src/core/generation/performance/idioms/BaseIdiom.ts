/**
 * 演奏表情基类 — 提供通用 humanize、swing、高斯随机
 * Pitch Space: ABSOLUTE（在 applyOffset 之后调用）
 */
import { PRNGManager } from '../../../utils/PRNG';
import { NoteData, GeneratedChord } from '../../types';

export interface IInstrumentIdiom {
    apply(notes: NoteData[], instrumentName: string, chords: GeneratedChord[], idiomPreferences?: any): NoteData[];
    humanize(notes: NoteData[], swingRatio: number, swingSubdivision: number, isRightHand?: boolean, idiomPreferences?: any): NoteData[];
}

export abstract class BaseIdiom implements IInstrumentIdiom {
    abstract apply(notes: NoteData[], instrumentName: string, chords: GeneratedChord[], idiomPreferences?: any): NoteData[];

    protected randomGaussian(mean: number, stdDev: number): number {
        const u = 1 - PRNGManager.next();
        const v = PRNGManager.next();
        const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
        return z * stdDev + mean;
    }

    protected applySwing(onset: number, duration: number, swingRatio: number, swingSubdivision: number): { swingDelay: number, newDuration: number } {
        if (swingRatio <= 0.5) return { swingDelay: 0, newDuration: duration };

        const getSwungTime = (time: number) => {
            const subdivisionPos = time % (swingSubdivision * 2);
            const beatStart = time - subdivisionPos;
            if (subdivisionPos < swingSubdivision) {
                return beatStart + (subdivisionPos / swingSubdivision) * (swingRatio * swingSubdivision * 2);
            } else {
                const offBeatProgress = (subdivisionPos - swingSubdivision) / swingSubdivision;
                const swungOffBeatStart = swingRatio * swingSubdivision * 2;
                const remainingTime = (1.0 - swingRatio) * swingSubdivision * 2;
                return beatStart + swungOffBeatStart + offBeatProgress * remainingTime;
            }
        };

        const swungOnset = getSwungTime(onset);
        const swungEnd = getSwungTime(onset + duration);
        return { swingDelay: swungOnset - onset, newDuration: swungEnd - swungOnset };
    }

    public humanize(notes: NoteData[], swingRatio: number, swingSubdivision: number, isRightHand: boolean = false, idiomPreferences?: any): NoteData[] {
        const sorted = [...notes].sort((a, b) => a.onset - b.onset);
        const result: NoteData[] = [];
        let currentOnset = -1;
        let chordNotes: NoteData[] = [];

        const processChord = () => {
            if (chordNotes.length === 0) return;
            chordNotes.sort((a, b) => a.pitch - b.pitch);
            const isHighFirst = PRNGManager.next() > 0.5;

            for (let index = 0; index < chordNotes.length; index++) {
                const note = chordNotes[index];
                let { strumDelay, timingWobble, velocityWobble, velocityMultiplier } = this.getHumanizeParams(note, index, chordNotes.length, isHighFirst, isRightHand, idiomPreferences);

                const humanizeAmount = idiomPreferences?.humanizeAmount ?? 0.5;
                timingWobble = timingWobble * humanizeAmount * 0.5;
                velocityWobble = velocityWobble * humanizeAmount;

                const { swingDelay, newDuration } = this.applySwing(note.onset, note.duration, swingRatio, swingSubdivision);

                result.push({
                    pitch: note.pitch,
                    onset: Math.max(0, note.onset + strumDelay + timingWobble + swingDelay),
                    duration: newDuration,
                    velocity: Math.min(1.0, Math.max(0.1, note.velocity * velocityMultiplier + velocityWobble))
                });
            }
            chordNotes = [];
        };

        for (let i = 0; i < sorted.length; i++) {
            if (Math.abs(sorted[i].onset - currentOnset) > 0.02) {
                processChord();
                currentOnset = sorted[i].onset;
            }
            chordNotes.push(sorted[i]);
        }
        processChord();

        return result;
    }

    protected abstract getHumanizeParams(note: NoteData, index: number, chordSize: number, isHighFirst: boolean, isRightHand: boolean, idiomPreferences?: any): {
        strumDelay: number;
        timingWobble: number;
        velocityWobble: number;
        velocityMultiplier: number;
    };
}
