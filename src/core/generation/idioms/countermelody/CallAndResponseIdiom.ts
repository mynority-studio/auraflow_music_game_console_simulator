// CallAndResponseIdiom — 呼应填空副旋律
// 在主旋律休止间隙填补 1-3 个和弦音
// Pitch Space: RELATIVE

import { NoteData } from '../../types';
import { ICounterMelodyIdiom, CounterMelodyContext } from './ICounterMelodyIdiom';
import { HarmonyCore } from '../../composing/HarmonyCore';
import { PRNGManager } from '../../../utils/PRNG';

export class CallAndResponseIdiom implements ICounterMelodyIdiom {
    readonly name = 'CallAndResponse';

    generate(ctx: CounterMelodyContext): NoteData[] {
        const notes: NoteData[] = [];
        const { chord, melodyNotes, tonality, energyLevel } = ctx;

        const chordTones = HarmonyCore.getChordTones(chord, 72);
        const scalePcs = HarmonyCore.getSafeScalePitches(chord, tonality);
        if (chordTones.length === 0) return notes;

        // 找主旋律的休止间隙（gap ≥ 1 拍）
        const sortedMelody: NoteData[] = [];
        for (let i = 0; i < melodyNotes.length; i++) {
            const m = melodyNotes[i];
            if (m.onset >= chord.startBeat - 1e-6 && m.onset < chord.endBeat - 1e-6) {
                sortedMelody.push(m);
            }
        }
        sortedMelody.sort((a, b) => a.onset - b.onset);

        const MIN_GAP = 1.0;
        const FILL_BREATH = 0.25;

        let lastPitch = chordTones[0];

        for (let i = 0; i < sortedMelody.length - 1; i++) {
            const cur = sortedMelody[i];
            const next = sortedMelody[i + 1];
            const gapStart = cur.onset + cur.duration;
            const gapEnd = next.onset;
            const gapLen = gapEnd - gapStart;

            if (gapLen < MIN_GAP - 1e-6) continue;

            const fillStart = Math.max(gapStart + FILL_BREATH, chord.startBeat);
            const fillEnd = Math.min(gapEnd - FILL_BREATH, chord.endBeat, fillStart + 2.0);
            const fillLen = fillEnd - fillStart;
            if (fillLen < 0.5 - 1e-6) continue;

            // 1-3 个填充音
            const noteCount = fillLen >= 1.5 ? 3 : (fillLen >= 1.0 ? 2 : 1);
            const stepDur = fillLen / noteCount;

            // 方向：与前一个主旋律音的关系（旋律上行 → 副旋律下行 = contrary motion）
            const melodyDirection = (next.pitch > cur.pitch) ? -1 : 1;

            for (let n = 0; n < noteCount; n++) {
                const onset = fillStart + n * stepDur;

                // 选 pitch：在 chord tones 中级进
                let pitch: number;
                if (n === 0) {
                    // 首音：chord tone 距 lastPitch 最近
                    pitch = chordTones[0];
                    let bestDist = 999;
                    for (let ct = 0; ct < chordTones.length; ct++) {
                        let p = chordTones[ct];
                        while (Math.abs(p - lastPitch) > 6) p += (p < lastPitch ? 12 : -12);
                        if (Math.abs(p - lastPitch) < bestDist) {
                            bestDist = Math.abs(p - lastPitch);
                            pitch = p;
                        }
                    }
                } else {
                    // 后续音：向 melodyDirection 级进
                    pitch = HarmonyCore.shiftDiatonic(lastPitch, scalePcs, melodyDirection);
                }

                // 音域 clamp
                while (pitch < 60) pitch += 12;
                while (pitch > 84) pitch -= 12;

                notes.push({
                    pitch,
                    onset,
                    duration: stepDur * 0.85,
                    velocity: 0.55 + energyLevel * 0.02,
                });
                lastPitch = pitch;
            }
        }

        // chord 区间开头如果主旋律静默 ≥ 1 拍，也填一个 pad
        if (sortedMelody.length === 0 || (sortedMelody[0].onset - chord.startBeat) >= 1.0) {
            const padPitch = chordTones.length > 1 ? chordTones[1] : chordTones[0];
            let p = padPitch;
            while (p < 60) p += 12;
            while (p > 84) p -= 12;
            const padEnd = sortedMelody.length > 0 ? Math.min(sortedMelody[0].onset - 0.25, chord.endBeat) : chord.endBeat;
            const padDur = Math.min(2.0, padEnd - chord.startBeat);
            if (padDur > 0.5) {
                notes.push({
                    pitch: p,
                    onset: chord.startBeat,
                    duration: padDur,
                    velocity: 0.45,
                });
            }
        }

        return notes;
    }
}
