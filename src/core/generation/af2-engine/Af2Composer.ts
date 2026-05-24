// ============================================================
// Af2Composer — AF2 自有作曲家(用户 8 层架构 #4)
// ============================================================
//
// 替代 mg.realizeProgression — AF2 自家把 Arranger 输出的 abstractPath
// (Roman + type + rootOffset)实化为完整 ChordDef[](含 voicing / bassMidi /
// chordSymbol / effectiveFunc)。
//
// 与 mg.realizeProgression 的差异:
//   - **简化**:跳过 Divisi 2.0(tensionState / virtualExtensions)、mode
//     borrowing detection、bassline rules / walking patterns、cadential 64
//     intercept 等 mg 高级功能
//   - **保留**:music-theory.placeVoicingMidi 做 voice-leading + CHORD_TYPES
//     interval 查表 + spell pc 等基础能力
//   - **风险**:mg.generateArrangement 用 ChordDef 做 melody/bass/accomp 决策,
//     AF2 Composer 输出的 ChordDef 字段简化后,melody 行为可能微变(可接受 — AF2 ≠ MG bit-exact)
//
// 算法流(per chord step):
//   1. rootKeyIndex = (keyIndex + step.rootOffset) % 12
//   2. intervals = CHORD_TYPES[step.type]
//   3. voicingPcs = intervals.map(iv => (rootKeyIndex + iv) % 12)
//   4. bassMidi = root in BASS_RANGE [A1=33, G3=55]
//   5. voicing = placeVoicingMidi(voicingPcs, prevVoicing, bassMidi, ...)
//      → 自动 voice-leading + chord region [C3, A5] placement
//   6. chordSymbol = "C" / "Cmaj7" / "Dm9" 等(简易拼接)
//   7. effectiveFunc = harmonicFunctionFromRoman(roman)
// ============================================================

import { CHORD_TYPES, placeVoicingMidi, BASS_RANGE } from './music-theory';
import {
    KEYS, harmonicFunctionFromRoman, spellPcInKey, midiToNoteInKey, midiToNoteInChord,
} from '../mg-engine/musicEngine';
import type { ChordDef } from '../mg-engine/musicEngine';
import type { Af2AbstractStep } from './Af2Arranger';

export const Af2Composer = {
    /**
     * 把 Af2AbstractStep[] 实化为 ChordDef[](Composer 入口)。
     *
     * @param abstractPath  Arranger 输出的进行骨架
     * @param key           调号字符串(如 'C')
     * @param isMinorKey    调式 minor 否(默认 false = major)
     */
    compose(abstractPath: Af2AbstractStep[], key: string, isMinorKey: boolean = false): ChordDef[] {
        const keyIndex = Math.max(0, KEYS.indexOf(key));
        const out: ChordDef[] = [];
        let prevVoicing: number[] = [];

        for (const step of abstractPath) {
            // 1. rootKeyIndex(在调内 pc 0-11)
            const rootKeyIndex = ((keyIndex + step.rootOffset) % 12 + 12) % 12;

            // 2. CHORD_TYPES 查表(fallback to 'maj' triad)
            const intervals = CHORD_TYPES[step.type] || CHORD_TYPES['maj'];

            // 3. Voicing PCs(dedupe)
            const pcSet = new Set<number>();
            for (const iv of intervals) {
                pcSet.add(((rootKeyIndex + iv) % 12 + 12) % 12);
            }
            const voicingPcs = Array.from(pcSet);

            // 4. Bass MIDI:root pc clamp 到 BASS_RANGE
            let bassMidi = rootKeyIndex + 36; // C2 区间起步
            while (bassMidi < BASS_RANGE.LOW) bassMidi += 12;
            while (bassMidi > BASS_RANGE.HIGH) bassMidi -= 12;
            if (bassMidi < BASS_RANGE.LOW) bassMidi = BASS_RANGE.LOW;
            if (bassMidi > BASS_RANGE.HIGH) bassMidi = BASS_RANGE.HIGH;

            // 5. Voice-leading placement(music-theory helper)
            const voicing = placeVoicingMidi(
                voicingPcs, prevVoicing, bassMidi, step.type, rootKeyIndex,
            );

            // 6. Chord symbol display(简易:type === 'maj' 时省略后缀)
            const rootName = spellPcInKey(rootKeyIndex, keyIndex, isMinorKey);
            const chordSymbol = `${rootName}${step.type === 'maj' ? '' : step.type}`;

            // 7. Notes(display,chord-root-relative spelling 让 altered tensions 拼写正确)
            const notes = voicing.map(m =>
                midiToNoteInChord(m, rootKeyIndex, keyIndex, isMinorKey, step.type)
            );

            const duration = step.beats ?? 4;

            out.push({
                root: rootName,
                rootMidi: rootKeyIndex + 48,  // C3 octave(mg convention 默认 4 八度根音引用)
                type: step.type,
                roman: step.roman,
                bass: midiToNoteInKey(bassMidi, keyIndex, isMinorKey),
                bassMidi,
                notes,
                notesMidi: voicing.slice(),
                duration,
                effectiveFunc: harmonicFunctionFromRoman(step.roman),
                chordSymbol,
                // 跳过 tensionState / virtualExtensions / bassPattern / borrowedFrom
                // (mg.generateArrangement 这些字段可空 — 行为退化到默认)
            });

            prevVoicing = voicing;
        }
        return out;
    },
};
