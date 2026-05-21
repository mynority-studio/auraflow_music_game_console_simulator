// ============================================================
// SlotRouter — 6 槽位路由
// ============================================================
//
// 职责:
//   1. 把 SectionMapper 输出的 events(带 part 字段)按以下规则路由到 6 槽位:
//        part='melody' → MainInst
//        part='chord'  → Accomp
//        part='bass'   → Bass
//        Vocal / Atmosphere / Drums:**不接收 mg events**(mg 不生成这 3 个 part)
//        但 Atmosphere / Drums 槽位可由 Af2EngineFacade 接 PadGenerator /
//        DrumGenerator 自生成(Phase 2a)
//   2. 读 forcedBand,把 musician 卡装到对应槽位
//        Af2EngineFacade Step 5 据此分支 idiom(Piano/Bass/Pad/Drum)
//
// Phase 1 → Phase 2a 演进:
//   Phase 1 简化:不读 forcedBand,musician 全留 null
//                所有 part 直接路由(不依赖 musician 是否在场)
//                Af2EngineFacade 统一调 PianoIdiom
//   Phase 2a:读 forcedBand → musician 卡装载
//             Af2EngineFacade 按 instrumentFamily 分支 idiom
//             musician=null 时:
//               · Bass / MainInst / Accomp 槽位 → events 默认走 PianoIdiom
//                 (与 Phase 1 行为兼容)
//               · Atmosphere / Drums 槽位 → 不生成(无声)
//
// 与 mg 的关系(融合原则):
//   - 只做路由 + 槽位装配,不改 events 主字段
//   - 不做"reassign"(把 melody 强行喂给 Bass 槽位之类)
// ============================================================

import { BandRole } from '../types';
import type { Musician } from '../types';
import type { NoteData } from '../types';
import type { NoteDataWithPartAndSection } from './SectionMapper';

/**
 * Phase 1 的 part → BandRole 映射(硬编码,见 ARCHITECTURE.md §3.2 表)。
 *
 * 注意:mg 的 NoteEvent.part 类型推断自 musicEngine.ts 的 NoteEvent 接口。
 * 任何 mg 端 part 字段值的扩展(如新增 'drums')都需要在本表显式映射,否则丢弃。
 */
const PART_TO_SLOT: Record<string, BandRole> = {
    melody: BandRole.MainInst,
    chord:  BandRole.Accomp,
    bass:   BandRole.Bass,
};

/** AF2 Phase 2a 实际接的槽位(Vocal 仍 Phase 后期) */
export const AF2_ACTIVE_SLOTS: BandRole[] = [
    BandRole.MainInst,
    BandRole.Accomp,
    BandRole.Bass,
    BandRole.Atmosphere,
    BandRole.Drums,
];

/** 每槽位路由结果 */
export interface SlotRouteResult {
    /**
     * 槽位上的乐手卡(从 forcedBand 解析)。
     * - undefined / null → 槽位空,Af2EngineFacade 用默认行为
     *   (MainInst/Accomp/Bass 槽位空 → 走 PianoIdiom 直通;
     *    Atmosphere/Drums 槽位空 → 不生成)
     */
    musician: Musician | null;
    /** 该槽位收到的 NoteData[](剥掉 part / sectionIdx 标注,只剩主字段) */
    notes: NoteData[];
    /** 保留 sectionIdx 副本供 Realizer 段落感知(Phase 2a 暂不消费,留作扩展) */
    notesWithSection: NoteDataWithPartAndSection[];
}

/** SlotRouter 完整输出:6 槽位 map */
export type SlotRouterOutput = Record<BandRole, SlotRouteResult>;

/**
 * 解析 forcedBand → 6 槽位 Musician map
 * - id === null → 显式留空,musician=null
 * - id === undefined → 槽位未配置,musician=null(Af2EngineFacade 决定默认行为)
 * - id === string → 查 musicianRegistry,找到则用,找不到则 null(静默)
 */
function resolveSlotMusicians(
    forcedBand: Partial<Record<BandRole, string | null>> | undefined,
    musicianRegistry: (id: string) => Musician | undefined,
): Record<BandRole, Musician | null> {
    const result: Record<BandRole, Musician | null> = {
        [BandRole.Vocal]:      null,
        [BandRole.MainInst]:   null,
        [BandRole.Accomp]:     null,
        [BandRole.Bass]:       null,
        [BandRole.Drums]:      null,
        [BandRole.Atmosphere]: null,
    };
    if (!forcedBand) return result;

    for (const role of Object.values(BandRole)) {
        const id = forcedBand[role];
        if (id == null) continue;  // null 或 undefined → 留 null
        const musician = musicianRegistry(id);
        if (musician) {
            result[role] = musician;
        }
        // musician 不存在(id 拼错):静默落空,与 MG 模式行为一致
    }
    return result;
}

export const SlotRouter = {
    /**
     * 把 events 按 part 路由到 6 槽位,并装载 musician 卡。
     *
     * @param events  SectionMapper 输出(带 part + sectionIdx)
     * @param forcedBand  PipelineRunOptions.forcedBand(用户在 BandSelectionPanel 配置)
     * @param musicianRegistry  根据 id 查 Musician 的函数(从 idioms/MusicianRegistry 注入)
     */
    route(
        events: NoteDataWithPartAndSection[],
        forcedBand: Partial<Record<BandRole, string | null>> | undefined,
        musicianRegistry: (id: string) => Musician | undefined,
    ): SlotRouterOutput {
        const slotMusicians = resolveSlotMusicians(forcedBand, musicianRegistry);

        // 初始化 6 槽位 buckets
        const buckets: Record<BandRole, NoteDataWithPartAndSection[]> = {
            [BandRole.Vocal]:      [],
            [BandRole.MainInst]:   [],
            [BandRole.Accomp]:     [],
            [BandRole.Bass]:       [],
            [BandRole.Drums]:      [],
            [BandRole.Atmosphere]: [],
        };

        // 路由:按 part 落入对应槽位
        for (const ev of events) {
            const targetSlot = PART_TO_SLOT[ev.part];
            if (!targetSlot) continue;
            buckets[targetSlot].push(ev);
        }

        // 装配输出
        const result: SlotRouterOutput = {} as SlotRouterOutput;
        for (const role of Object.values(BandRole)) {
            const notesWithSection = buckets[role];
            result[role] = {
                musician: slotMusicians[role],
                // 剥掉 part / sectionIdx 字段,只留 NoteData 主字段
                notes: notesWithSection.map(({ part: _p, sectionIdx: _s, ...rest }) => rest),
                notesWithSection,
            };
        }
        return result;
    },
};
