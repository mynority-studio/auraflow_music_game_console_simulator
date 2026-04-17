// ParallelHarmonyIdiom — 三度/六度并行副旋律
// Pitch Space: RELATIVE

import { NoteData, Tonality } from '../../types';
import { ICounterMelodyIdiom, CounterMelodyContext } from './ICounterMelodyIdiom';
import { HarmonyCore } from '../../composing/HarmonyCore';
import { PRNGManager } from '../../../utils/PRNG';

export class ParallelHarmonyIdiom implements ICounterMelodyIdiom {
    readonly name = 'ParallelHarmony';

    generate(ctx: CounterMelodyContext): NoteData[] {
        const notes: NoteData[] = [];
        const { chord, melodyNotes, tonality } = ctx;

        const scalePcs = HarmonyCore.getSafeScalePitches(chord, tonality);
        const chordTones = HarmonyCore.getChordTones(chord, 72);

        // 找当前 chord 区间内的主旋律音
        const localMelody: NoteData[] = [];
        for (let i = 0; i < melodyNotes.length; i++) {
            const m = melodyNotes[i];
            if (m.onset >= chord.startBeat - 1e-6 && m.onset < chord.endBeat - 1e-6) {
                localMelody.push(m);
            }
        }

        for (let mi = 0; mi < localMelody.length; mi++) {
            const mNote = localMelody[mi];

            // 三度或六度下方（调内级进）
            const interval = PRNGManager.next() > 0.5 ? 3 : 5; // 3 scale steps ≈ 3rd, 5 ≈ 6th
            const mPc = mNote.pitch % 12;

            // 找 mPc 在 scalePcs 中的位置
            let scaleIndex = -1;
            let minDiff = 99;
            for (let si = 0; si < scalePcs.length; si++) {
                const diff = Math.min(Math.abs(scalePcs[si] - mPc), 12 - Math.abs(scalePcs[si] - mPc));
                if (diff < minDiff) {
                    minDiff = diff;
                    scaleIndex = si;
                }
            }
            if (scaleIndex === -1) continue;

            const targetScaleIndex = ((scaleIndex - interval) % scalePcs.length + scalePcs.length * 2) % scalePcs.length;
            const targetPc = scalePcs[targetScaleIndex];
            let diff2 = targetPc - mPc;
            if (diff2 > 0) diff2 -= 12; // 确保往下
            let targetPitch = mNote.pitch + diff2;

            // 尝试 snap 到 chord tone（50% 概率）
            if (PRNGManager.next() > 0.5) {
                let nearestCtDiff = -12;
                for (let ct = 0; ct < chordTones.length; ct++) {
                    const ctDiff = (chordTones[ct] % 12) - mPc;
                    const adjusted = ctDiff > 0 ? ctDiff - 12 : ctDiff;
                    if (adjusted < 0 && adjusted > nearestCtDiff) {
                        nearestCtDiff = adjusted;
                    }
                }
                if (nearestCtDiff > -12) {
                    targetPitch = mNote.pitch + nearestCtDiff;
                }
            }

            // 音域 clamp
            while (targetPitch < 55) targetPitch += 12;
            while (targetPitch > 84) targetPitch -= 12;

            notes.push({
                pitch: targetPitch,
                onset: mNote.onset,
                duration: mNote.duration,
                velocity: mNote.velocity * 0.75,
            });
        }

        return notes;
    }
}
