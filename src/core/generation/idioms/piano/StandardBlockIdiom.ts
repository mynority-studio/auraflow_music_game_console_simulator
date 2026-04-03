import { PRNGManager } from '../../../utils/PRNG';
import { NoteData } from '../../types';
import { PianoIdiomContext, PianoIdiom } from '../types';

/**
 * Standard Block Idiom — 标准和弦织体（Block / Arpeggio / Pad）
 *
 * 从 TextureMapper.generateChordTexture 提取的原始逻辑。
 * max ~100 notes per chord (C-4 compliance)
 */
export const StandardBlockIdiom: PianoIdiom = {
    generate(ctx: PianoIdiomContext): NoteData[] {
        const { chordTones, chordStart, chordEnd, energyLevel, textureType, isSparseSection, isSectionEnd } = ctx;
        const chordLen = chordEnd - chordStart;
        const baseVelocity = 0.4 + energyLevel * 0.04;
        const notes: NoteData[] = [];

        const texLower = textureType.toLowerCase();
        const isArpeggio = texLower === 'arpeggio' || texLower === 'broken';
        const isPad = texLower === 'pad' || texLower === 'sustained';

        if (isArpeggio) {
            const step = energyLevel >= 6 ? 0.25 : 0.5;
            let beat = chordStart;
            let idx = 0;
            while (beat < chordEnd - 1e-6) {
                const toneIdx = idx % chordTones.length;
                const vel = Math.min(1.0, baseVelocity + (PRNGManager.next() * 0.06 - 0.03));
                notes.push({ pitch: chordTones[toneIdx], onset: beat, duration: step, velocity: vel });
                beat += step;
                idx++;
            }
        } else if (isPad) {
            for (let i = 0; i < chordTones.length; i++) {
                notes.push({
                    pitch: chordTones[i],
                    onset: chordStart,
                    duration: Math.max(chordLen - 0.0625, 0.5),
                    velocity: Math.min(1.0, baseVelocity * 0.8 + PRNGManager.next() * 0.02),
                });
            }
        } else {
            // Block chord
            const step = energyLevel <= 3 ? 2.0 : (energyLevel <= 6 ? 1.0 : 0.5);
            let beat = chordStart;
            while (beat < chordEnd - 1e-6) {
                const remaining = chordEnd - beat;
                const dur = Math.min(step, remaining);
                const vel = Math.min(1.0, baseVelocity + (PRNGManager.next() * 0.06 - 0.03));
                for (let i = 0; i < chordTones.length; i++) {
                    notes.push({ pitch: chordTones[i], onset: beat, duration: dur, velocity: vel });
                }
                beat += step;
            }
        }

        // Sparse section end: ring out
        if (isSparseSection && isSectionEnd && notes.length > 0) {
            const lastOnset = notes[notes.length - 1].onset;
            notes.forEach(n => {
                if (Math.abs(n.onset - lastOnset) < 1e-6) {
                    n.duration = Math.max(n.duration, chordLen);
                }
            });
        }

        return notes;
    }
};
