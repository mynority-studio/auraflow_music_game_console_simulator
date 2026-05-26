// ============================================================
// BassIdiom — AF2 电贝斯 idiom(2026-05-26 Step 7.1 起改用 ImproCore bass-pattern)
// ============================================================
//
// 单路径 ImproCore bass-pattern(.sty bassPatterns 驱动):
//   per chord 调 planBassImproCore adapter,style 由 UI ImproStyleStore 选。
//   pattern token DSL(B/S/C/A/1-12/= 等)由 ImproCore applyBassPattern 解释,
//   AF2 framework(Conductor / Dispatcher / Reconciler)零变化。
//
// 删的旧路径(2026-05-26 合并 AF2+ImproCore 前):
//   - renderAf2Walking + WALK_PATTERNS + SWING_RATIO_BY_PATTERN
//   - mg pass-through(input.notes.bass)— mg-engine 早已删
//
// 物理约束:
//   - 音域 E1-G4(MIDI 28-67)= UI 显示用
//   - 生成限制 BASS_LOW_MIDI 33 / BASS_HIGH_MIDI 55(A1-G3,在 adapter 内)
//   - eligibleSlots: [Bass]
// ============================================================

import type { NoteData } from '../../types';
import { BandRole } from '../../types';
import type { MusicianPlanInput } from '../Conductor';
import { getMyRolesInSection, findSectionIdxForBeat } from '../Conductor';
import { planBassImproCore } from '../adapters/improcore-adapter';

/** 电贝斯物理参数(rangeLo/rangeHi = 物理音域描述,UI / BandSelectionPanel 用)*/
export const BASS_INSTRUMENT_SPEC = {
    gmProgram: 34,           // GM 34 Electric Bass Finger
    rangeLo: 28,             // E1(物理下限)
    rangeHi: 67,             // G4(物理上限)
    eligibleSlots: [BandRole.Bass] as const,
} as const;

export const BassIdiom = {
    /**
     * Plan bass role — 单路径调 ImproCore bass-pattern adapter。
     * Per-section role gate:Conductor 让本 musician 在某 section 'bass' role
     * 未分配 → 该 section bass note 全 skip。
     */
    plan(input: MusicianPlanInput): NoteData[] {
        const raw = planBassImproCore(input);
        // Per-section role gate(Conductor 让我这段 silent for bass)
        const out: NoteData[] = [];
        for (const n of raw) {
            const sectionIdx = findSectionIdxForBeat(n.onset, input.score.sections);
            if (sectionIdx < 0) continue;
            const myRoles = getMyRolesInSection(input, sectionIdx);
            if (!myRoles.includes('bass')) continue;
            out.push(n);
        }
        return out;
    },

    getGmProgram(): number {
        return BASS_INSTRUMENT_SPEC.gmProgram;
    },
};
