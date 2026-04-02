import { PRNGManager } from '../../../utils/PRNG';
import { NoteData, GeneratedChord } from '../../types';
import { BaseIdiom } from './BaseIdiom';

export class SynthVoiceIdiom extends BaseIdiom {
    public apply(notes: NoteData[], instrumentName: string, chords: GeneratedChord[], idiomPreferences?: any): NoteData[] {
        if (notes.length === 0) return [];

        const sorted = [...notes].sort((a, b) => a.onset - b.onset);
        const result: NoteData[] = [];

        for (let i = 0; i < sorted.length; i++) {
            let current = { ...sorted[i] };
            const nextNote = i < sorted.length - 1 ? sorted[i + 1] : null;

            // 1. Legato 连音模式: 音符之间重叠 10%～15%
            if (nextNote && nextNote.onset > current.onset && nextNote.onset - current.onset <= 1.0) {
                const gap = nextNote.onset - current.onset;
                // Overlap by 10%~15% of the gap
                const overlap = gap * (0.1 + PRNGManager.next() * 0.05);
                current.duration = Math.max(current.duration, gap + overlap);
                
                // 2. Pitch Bend 滑音: 若两个相邻音符距离 <= 大三度 (4个半音)
                const pitchDiff = nextNote.pitch - current.pitch;
                const absDiff = Math.abs(pitchDiff);
                
                if (absDiff > 0 && absDiff <= 7) { // Allow up to perfect fifth for minimal bend
                    // 滑音时间占音符长度的 20%～30%
                    let bendIntensity = pitchDiff;
                    
                    // Intensity based on interval size
                    if (absDiff <= 2) {
                        // Small intervals (1-2 semitones): full bend
                        bendIntensity *= 1.0;
                    } else if (absDiff <= 4) {
                        // Medium intervals (3-4 semitones): moderate bend
                        bendIntensity *= 0.6;
                    } else {
                        // Large intervals (5-7 semitones): minimal bend
                        bendIntensity *= 0.2;
                    }
                    
                    // Upward bends should be gentle, downward bends slightly heavier
                    if (pitchDiff > 0) {
                        // 上滑音：柔和
                        bendIntensity *= 0.8;
                    } else {
                        // 下滑音：稍微重一点
                        bendIntensity *= 1.0;
                    }
                    
                    current.pitchBend = bendIntensity;
                    current.pitchBendDuration = current.duration * (0.2 + PRNGManager.next() * 0.1);
                }
            } else {
                // 3. 长音一律: 唱满长度，尾端自然渐弱 Release，不中途切断
                // 如果后面有比较长的空拍，让声音自然延续
                const gapToNext = nextNote ? (nextNote.onset - (current.onset + current.duration)) : 2.0;
                if (gapToNext > 0) {
                    // 延长音符，最多延长 0.5 拍，或者空拍的一半
                    const extension = Math.min(0.5, gapToNext * 0.5);
                    current.duration += extension;
                    // 尾端自然渐弱，渐弱时间为延长的部分加上原本音符的最后 0.2 拍
                    current.fadeOutDuration = extension + Math.min(0.2, current.duration * 0.2);
                } else {
                    current.duration *= 1.1;
                    current.fadeOutDuration = current.duration * 0.2;
                }
            }

            // Smooth velocities
            if (i > 0) {
                const prev = result[i - 1];
                const pitchDiff = Math.abs(current.pitch - prev.pitch);
                const gap = current.onset - (prev.onset + prev.duration);
                
                if (gap <= 0.1) {
                    const velocityDiff = current.velocity - prev.velocity;
                    const maxDiff = pitchDiff >= 7 ? 0.02 : 0.05;
                    if (Math.abs(velocityDiff) > maxDiff) {
                        current.velocity = prev.velocity + Math.sign(velocityDiff) * maxDiff;
                    }
                }
            }

            result.push(current);
        }

        return result;
    }

    protected getHumanizeParams(note: NoteData, index: number, chordSize: number, isHighFirst: boolean, isRightHand: boolean, idiomPreferences?: any) {
        return {
            strumDelay: 0,
            timingWobble: this.randomGaussian(0, 0.005), // Very tight timing
            velocityWobble: this.randomGaussian(0, 0.01), // Very stable
            velocityMultiplier: 1.0
        };
    }

    public humanize(notes: NoteData[], swingRatio: number, swingSubdivision: number, isRightHand: boolean = false, idiomPreferences?: any): NoteData[] {
        // Use base humanize but do NOT shorten durations like PianoIdiom does
        return super.humanize(notes, swingRatio, swingSubdivision, isRightHand, idiomPreferences);
    }
}
