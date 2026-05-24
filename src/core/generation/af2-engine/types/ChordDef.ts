// ============================================================
// ChordDef — AF2 chord 实化形状(原 mg-engine/musicEngine.ts copy 精简)
// ============================================================
//
// Af2Composer.compose 输出此类型,作为 MgKernelInvoker 内部 chord 中间表示。
// 进一步 chordDefToGeneratedChord 转换为 GeneratedChord(IR)给下游 musicians 用。
//
// 2026-05-24:从 mg-engine 内化到 af2-engine。
// ============================================================

export interface ChordDef {
    root: string;       // e.g., 'C', 'F#'
    rootMidi: number;   // MIDI root for scale calculations
    type: string;       // e.g., 'maj7', 'm9', 'dom7'
    roman: string;      // e.g., 'Imaj7', 'V7/vi'
    bass: string;       // e.g., 'C', 'E'
    bassMidi: number;
    notes: string[];    // Display projection(chord-root-relative spelling)
    notesMidi: number[];// Authoritative voicing MIDI(audio renderer reads此)
    duration: number;   // in beats
    /** TSD 函数(Divisi 2.0 可填,简化版可不填) */
    effectiveFunc?: 'T' | 'S' | 'D';
    /** UI 显示用(如 "Cmaj7" / "Dm9") */
    chordSymbol?: string;
}
