import { globalPRNG } from '../../../utils/PRNG';
import { NoteData, GeneratedChord } from '../../types';
import { GlobalContext } from '../../GlobalContext';

export interface IInstrumentIdiom {
    apply(notes: NoteData[], instrumentName: string, chords: GeneratedChord[], idiomPreferences?: any): NoteData[];
    humanize(notes: NoteData[], swingRatio: number, swingSubdivision: number, isRightHand?: boolean, idiomPreferences?: any): NoteData[];
}

export abstract class BaseIdiom implements IInstrumentIdiom {
    abstract apply(notes: NoteData[], instrumentName: string, chords: GeneratedChord[], idiomPreferences?: any): NoteData[];

    // 采用高斯分布生成更自然的随机数
    protected randomGaussian(mean: number, stdDev: number): number {
        let u = 1 - globalPRNG.next(); 
        let v = globalPRNG.next();
        let z = Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
        return z * stdDev + mean;
    }

    // 通用的摇摆节奏计算
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
        
        return {
            swingDelay: swungOnset - onset,
            newDuration: swungEnd - swungOnset
        };
    }

    // 默认的人性化实现（可被子类重写）
    public humanize(notes: NoteData[], swingRatio: number, swingSubdivision: number, isRightHand: boolean = false, idiomPreferences?: any): NoteData[] {
        const sorted = [...notes].sort((a, b) => a.onset - b.onset);
        const result: NoteData[] = [];
        
        let currentOnset = -1;
        let chordNotes: NoteData[] = [];

        const processChord = () => {
            if (chordNotes.length === 0) return;
            
            chordNotes.sort((a, b) => a.pitch - b.pitch);
            const isHighFirst = globalPRNG.next() > 0.5;
            
            chordNotes.forEach((note, index) => {
                let { strumDelay, timingWobble, velocityWobble, velocityMultiplier } = this.getHumanizeParams(note, index, chordNotes.length, isHighFirst, isRightHand, idiomPreferences);
                
                // 暂时禁用 timingWobble，避免听起来不稳
                timingWobble = 0;

                const { swingDelay, newDuration } = this.applySwing(note.onset, note.duration, swingRatio, swingSubdivision);

                result.push({
                    pitch: note.pitch,
                    onset: Math.max(0, note.onset + strumDelay + timingWobble + swingDelay),
                    duration: newDuration,
                    velocity: Math.min(1.0, Math.max(0.1, note.velocity * velocityMultiplier + velocityWobble))
                });
            });
            chordNotes = [];
        };

        sorted.forEach(note => {
            if (Math.abs(note.onset - currentOnset) > 0.02) {
                processChord();
                currentOnset = note.onset;
            }
            chordNotes.push(note);
        });
        processChord();

        return result;
    }

    // 获取具体乐器的人性化参数（子类实现）
    protected abstract getHumanizeParams(note: NoteData, index: number, chordSize: number, isHighFirst: boolean, isRightHand: boolean, idiomPreferences?: any): {
        strumDelay: number;
        timingWobble: number;
        velocityWobble: number;
        velocityMultiplier: number;
    };
}