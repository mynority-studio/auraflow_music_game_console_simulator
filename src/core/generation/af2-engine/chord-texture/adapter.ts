// ============================================================
// adapter — GeneratedChord(AF2 IR)→ ChordDef(chord-texture 需要)
// ============================================================
//
// chord-texture family 接 ChordDef(rootMidi / type 字符串 / bassMidi /
// notesMidi)。AccompGen 拿到的是 GeneratedChord(quality enum / root pc /
// voicing)— 字段语义类似但需 adapter。
// ============================================================

import { ChordQuality } from '../../types';
import type { GeneratedChord } from '../../ir';
import type { ChordDef } from '../types/ChordDef';

/**
 * Reverse map ChordQuality enum → mg type string。
 * 与 Af2KernelDriver.MG_TYPE_TO_QUALITY 镜像反向(选首选)。
 */
const QUALITY_TO_MG_TYPE: Record<ChordQuality, string> = {
    [ChordQuality.Major]:          'maj',
    [ChordQuality.Minor]:          'min',
    [ChordQuality.Diminished]:     'dim',
    [ChordQuality.Augmented]:      'aug',
    [ChordQuality.Major7]:         'maj7',
    [ChordQuality.Minor7]:         'm7',
    [ChordQuality.Dominant7]:      '7',
    [ChordQuality.HalfDiminished]: 'm7b5',
    [ChordQuality.Diminished7]:    'dim7',
    [ChordQuality.Sus4]:           'sus4',
    [ChordQuality.Dominant7Sus4]:  '7sus4',
    [ChordQuality.Add9]:           'add9',
    [ChordQuality.Minor9]:         'm9',
    [ChordQuality.Major9]:         'maj9',
    [ChordQuality.Dominant9]:      '9',
    [ChordQuality.Minor11]:        'm11',
    [ChordQuality.Dominant13]:     '13',
    [ChordQuality.Major13]:        'maj13',
    [ChordQuality.Major7Sharp11]:  'maj7#11',
    [ChordQuality.Dom7Flat9]:      '7b9',
    [ChordQuality.Dom7Sharp9]:     '7#9',
    [ChordQuality.Dom7Sharp11]:    '7#11',
    [ChordQuality.Dom7Flat13]:     '7b13',
    [ChordQuality.Dom7Alt]:        '7alt',
    [ChordQuality.Dominant11]:     '11',
};

/**
 * GeneratedChord → ChordDef(供 chord-texture family 用)。
 *
 * 字段选择:
 *   rootMidi:从 voicing 推 root 的合理八度;voicing 空时用 root pc + 48(C3)
 *   bassMidi:voicing 最低音(Composer 输出已 sort)
 *   notesMidi:voicing 直接 slice
 *   type:QUALITY_TO_MG_TYPE 反向 map(family 用 chord.type 字符串选音程)
 *   roman/root/bass/notes:family 不消费,空字符 fallback
 */
export function generatedChordToChordDef(chord: GeneratedChord): ChordDef {
    const voicing = chord.voicing ?? [];
    // rootMidi:找 voicing 内 root pc 的最低八度;空 voicing → 默认 C3 (root + 48)
    let rootMidi: number;
    if (voicing.length > 0) {
        const candidatesByPc = voicing.filter(m => (((m % 12) + 12) % 12) === chord.root);
        rootMidi = candidatesByPc.length > 0 ? Math.min(...candidatesByPc) : chord.root + 48;
    } else {
        rootMidi = chord.root + 48;
    }
    const bassMidi = voicing.length > 0 ? Math.min(...voicing) : rootMidi;
    const type = QUALITY_TO_MG_TYPE[chord.quality] ?? 'maj';

    return {
        root: '',
        rootMidi,
        type,
        roman: chord.numeral,
        bass: '',
        bassMidi,
        notes: [],
        notesMidi: voicing.slice(),
        duration: chord.endBeat - chord.startBeat,
    };
}
