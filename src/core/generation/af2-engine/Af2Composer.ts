// ============================================================
// Af2Composer — AF2 作曲家(2026-05-26 起改用 ImproCore wide-piano-voicing)
// ============================================================
//
// 把 Af2AbstractStep[] 实化为 ChordDef[](含 voicing / bassMidi / chordSymbol /
// effectiveFunc),供下游 Idiom plan() 消费。
//
// 2026-05-26 合并 AF2+ImproCore Step 6.3:
//   - 删 placeVoicingMidi / assembleVoicing / partitionHands / mergeHands /
//     DynamicHarmonyDecorator / VoicingSmoother(plugins/composer/ 删)
//   - 改用 adapter.buildWidePianoVoicingsForAf2 batch precompute → wide.attackMidi
//     替代 voicing。LH/RH 拆解从 wide voicing 的 notes 字段拿(role 标记)
//
// PRNG 消耗:wide-piano-voicing 内部 fork sub-stream(via adapter),
// Composer 本层 zero PRNG(rng 参数留作 future plugin 调用兜底)。
//
// 空间约定:**全 RELATIVE**(K-2)。chord.voicing / bassMidi 不含 keyOffset,
// AbsoluteTransposer 后续加。
// ============================================================

import {
    KEYS, harmonicFunctionFromRoman, spellPcInKey, midiToNoteInKey, midiToNoteInChord,
} from './music-theory';
import { Tonality } from '../types';
import type { Random } from './utils/Random';
import type { ChordDef } from './types/ChordDef';
import type { Af2AbstractStep } from './Af2Arranger';
import type { SubStyle } from './SubStyleTextures';
import {
    buildWidePianoVoicingsForAf2,
    type WideVoicingChordSpec,
} from './adapters/improcore-adapter';

const BASS_LOW = 33;   // A1
const BASS_HIGH = 55;  // G3

export const Af2Composer = {
    /**
     * 把 Af2AbstractStep[] 实化为 ChordDef[](Composer 入口)。
     *
     * @param abstractPath  Arranger 输出的进行骨架
     * @param key           调号字符串(如 'C')— 仅用于 chord spell(display 名)
     * @param isMinorKey    调式 minor 否(默认 false = major)
     * @param rng           predef PRNG(当前未消费,保留作 future plugin 兜底)
     * @param subStyle      sub-style 标识(当前未消费,留待 wide voicing 升级)
     */
    compose(
        abstractPath: Af2AbstractStep[],
        key: string,
        isMinorKey: boolean = false,
        rng?: Random,
        subStyle?: SubStyle,
    ): ChordDef[] {
        void rng;
        void subStyle;
        const keyIndex = Math.max(0, KEYS.indexOf(key));
        const tonality = isMinorKey ? Tonality.Minor : Tonality.Major;

        // Step 1:abstractPath → wide voicing chord spec(RELATIVE 空间)
        const specs: WideVoicingChordSpec[] = abstractPath.map(step => ({
            rootPcRelative: ((step.rootOffset % 12) + 12) % 12,
            type: step.type,
            roman: step.roman,
            effectiveFunc: step.effectiveFunc,
            duration: step.beats ?? 4,
        }));

        // Step 2:batch precompute wide voicings(含 inner motion / drop2 / muddy check)
        const wideVoicings = buildWidePianoVoicingsForAf2(specs, tonality);

        // Step 3:per chord 装 ChordDef
        const out: ChordDef[] = [];
        for (let i = 0; i < abstractPath.length; i++) {
            const step = abstractPath[i]!;
            const wide = wideVoicings[i]!;
            const rootPcRelative = ((step.rootOffset % 12) + 12) % 12;
            // Spell 用 keyIndex(让 'F major' 的 ii chord display 'Gm' 而非 'C#m')
            const rootKeyIndexAbs = ((keyIndex + step.rootOffset) % 12 + 12) % 12;

            // Bass MIDI:RELATIVE root clamp 到 BASS_RANGE(A1=33 ~ G3=55)
            let bassMidi = rootPcRelative + 36;  // C2 octave 起点
            while (bassMidi < BASS_LOW) bassMidi += 12;
            while (bassMidi > BASS_HIGH) bassMidi -= 12;
            if (bassMidi < BASS_LOW) bassMidi = BASS_LOW;
            if (bassMidi > BASS_HIGH) bassMidi = BASS_HIGH;

            // Voicing:wide.attackMidi(RELATIVE MIDI 升序)
            const voicing = wide.attackMidi.slice();

            // LH/RH 拆 — wide.notes 含 role 标记(bass/inner/outer),按 MIDI < 60 分 LH
            const lhMidi: number[] = [];
            const rhMidi: number[] = [];
            for (const m of voicing) {
                if (m < 60) lhMidi.push(m);
                else rhMidi.push(m);
            }

            // Chord display
            const rootName = spellPcInKey(rootKeyIndexAbs, keyIndex, isMinorKey);
            const chordSymbol = `${rootName}${step.type === 'maj' ? '' : step.type}`;
            const notes = voicing.map(m =>
                midiToNoteInChord(m, rootKeyIndexAbs, keyIndex, isMinorKey, step.type)
            );

            const duration = step.beats ?? 4;

            out.push({
                root: rootName,
                rootMidi: rootKeyIndexAbs + 48,  // C3 octave(K-2 不含 keyOffset,Composer 内部表达)
                type: step.type,
                roman: step.roman,
                bass: midiToNoteInKey(bassMidi, keyIndex, isMinorKey),
                bassMidi,
                notes,
                notesMidi: voicing,
                duration,
                effectiveFunc: step.effectiveFunc ?? harmonicFunctionFromRoman(step.roman),
                chordSymbol,
                lhMidi,
                rhMidi,
            });
        }

        return out;
    },
};
