// ============================================================
// PianoIdiom — AF2 钢琴乐器 idiom(Phase 1:直通)
// ============================================================
//
// 在用户的三层架构里,本文件属于**"世界规则库" 之 "乐器 baseidiom"**子层
//(AF2 私有版本,Phase N 删 AF/MG 后可考虑提升到顶层 src/core/generation/instruments/)。
//
// Phase 1 职责(钢琴特例):
//   直通 — mg 输出的钢琴音符不做任何二次加工。NoteData 主字段全保留,
//   GM program = 0(Grand Piano),让音色与 MG 模式 bit-exact 一致。
//
// 为什么钢琴是直通:
//   mg 的算法本身就是为钢琴写的(chord/bass 落 piano LH,melody 落 piano RH)。
//   AF2 的目标是"忠实 mg" — 钢琴渲染没有"加 articulation"的空间,加了反而偏离。
//
// 未来其他乐器的样板:
//   Phase 2+ 萨克斯 / 小提琴 / 等 idiom 会加 articulation(萨克斯起音滑音 +
//   breath noise / 小提琴 portamento 等),**但永远禁止改 pitch/onset/duration/velocity**。
//   articulation 字段需要在 NoteData 上新增可选字段(Phase 2 评估)。
//
// 物理声明(供 BandSelectionPanel 校验槽位):
//   - 音域:21-108(标准 88 键)
//   - 可放槽位:MainInst / Accomp / Bass(钢琴能独奏可主奏可伴奏可做低音)
//   - 不能放:Drums / Vocal(物理性质不同)
// ============================================================

import type { NoteData } from '../../types';
import { BandRole } from '../../types';

/** 钢琴物理参数(Phase 1 仅文档,Phase 2+ BandSelectionPanel 消费) */
export const PIANO_INSTRUMENT_SPEC = {
    /** GM program number(Grand Piano) */
    gmProgram: 0,
    /** 物理音域(MIDI) */
    rangeLo: 21,
    rangeHi: 108,
    /** 可放置的乐队槽位 */
    eligibleSlots: [BandRole.MainInst, BandRole.Accomp, BandRole.Bass] as const,
} as const;

export const PianoIdiom = {
    /**
     * 钢琴渲染 — Phase 1 直通。
     *
     * 不改 pitch / onset / duration / velocity。返回 NoteData[] 的浅拷贝
     * (防御性,避免下游 mutate 污染 mg 原输出)。
     */
    realize(notes: NoteData[]): NoteData[] {
        return notes.map(n => ({ ...n }));
    },

    /**
     * 取 GM program number(供 MusicContext.gmProgramOverrides 装配)。
     */
    getGmProgram(): number {
        return PIANO_INSTRUMENT_SPEC.gmProgram;
    },
};
