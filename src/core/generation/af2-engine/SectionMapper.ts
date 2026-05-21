// ============================================================
// SectionMapper — 按段落给 mg events 打 sectionIdx 标(只读)
// ============================================================
//
// 职责:
//   遍历 MgKernelInvoker 输出的 events,根据每个 event 的 onset 落入哪个
//   SectionMetadata 的 [startBeat, endBeat) 范围,标注 sectionIdx。
//
// 硬约束(融合原则):
//   - **绝对禁止改 events 主字段**(pitch / onset / duration / velocity / part)
//   - 只能附加新字段(sectionIdx)
//   - 段落标注与 mg 生成结果无逻辑耦合:某 event 落在 AF 的 "Chorus" 段不会
//     让 mg 改变它,只是给 UI 显示用
//
// 边界处理:
//   - event.onset < sections[0].startBeat(理论不会发生,sections 应从 0 起) → sectionIdx = 0
//   - event.onset >= sections[last].endBeat(超出末尾,可能因 mg 末尾 tail) → sectionIdx = last
// ============================================================

import type { SectionMetadata } from '../types';
import type { NoteDataWithPart } from './MgKernelInvoker';

/** events 经过 SectionMapper 后携带的额外字段 */
export interface NoteDataWithPartAndSection extends NoteDataWithPart {
    sectionIdx: number;
}

export const SectionMapper = {
    /**
     * 把 events 按 onset 落入哪个段落标 sectionIdx。
     * sections 必须按 startBeat 升序且无 gap(SectionPlanner 输出已满足此约束)。
     */
    assignSections(
        events: NoteDataWithPart[],
        sections: SectionMetadata[],
    ): NoteDataWithPartAndSection[] {
        if (sections.length === 0) {
            throw new Error('SectionMapper: sections 不能为空');
        }
        const lastIdx = sections.length - 1;

        return events.map(ev => {
            let idx = lastIdx;
            for (let i = 0; i < sections.length; i++) {
                if (ev.onset < sections[i].endBeat) {
                    idx = i;
                    break;
                }
            }
            // 不修改原 ev,返回新对象(防御性 — 避免下游误改造成 mg 输出污染)
            return { ...ev, sectionIdx: idx };
        });
    },
};
