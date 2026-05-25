// ============================================================
// ChordDef — AF2 chord 实化形状(原 mg-engine/musicEngine.ts copy 精简)
// ============================================================
//
// Af2Composer.compose 输出此类型,作为 Af2KernelDriver 内部 chord 中间表示。
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
    /** Phase 2(Impro-Visor HandManager 移植):钢琴 LH 簇 MIDI(可选)。
     *  当 HandPartitioner 启用时填;notesMidi 同步合并 LH+RH 并升序。
     *  Consumer 不消费此字段时,按 notesMidi 单簇处理(向后兼容)。 */
    lhMidi?: number[];
    /** Phase 2:钢琴 RH 簇 MIDI(可选)。配合 lhMidi 一起填。 */
    rhMidi?: number[];
}
