// ============================================================
// BassIdiom — AF2 电贝斯 idiom(Phase 2a)
// ============================================================
//
// 决策(PHASE2A.md §10):
//   - Q3 B:GM 34 Electric Bass Finger(尊重 frank_bass.defaultSound 字段)
//   - Q4 A:独立 bass 通道(2026-05-21 Channel 重构后简称为 ch3 bass channel)
//
// 职责(Phase 2a 简化):
//   纯直通 mg.bass 音符 — 不改 pitch / onset / duration / velocity。
//   唯一与 PianoIdiom 的差异 = 音色(GM 34)+ 通道(bass ch3)。
//
// 物理约束:
//   - 音域 E1-G4(MIDI 28-67)— 电贝斯标准 4 弦音域
//   - 单声部(mg.bass 已经是单声部)
//   - eligibleSlots: [Bass](不可放 MainInst / Accomp / Drums / Atmosphere / Vocal)
//
// Phase 2b+ 可扩展(本文件预留接口):
//   - articulation(slide / hammer-on / pull-off / mute)
//   - persona 消费(syncopationAssault → fill 密度 / walkPatternId)
// ============================================================

import type { NoteData } from '../../types';
import { BandRole } from '../../types';
// C.5:MusicianPlanInput 协议 + per-section role gate
import type { MusicianPlanInput } from '../Conductor';
import { getMyRolesInSection, findSectionIdxForBeat } from '../Conductor';

/** 电贝斯物理参数 */
export const BASS_INSTRUMENT_SPEC = {
    /** GM 34 Electric Bass Finger(Q3 B 决策) */
    gmProgram: 34,
    /** 物理音域(MIDI):E1-G4 */
    rangeLo: 28,
    rangeHi: 67,
    eligibleSlots: [BandRole.Bass] as const,
} as const;

export const BassIdiom = {
    /**
     * C.5:plan bass role(Bass 槽 + Conductor 给本 musician 分 'bass' role 的 sections)。
     *
     * 流程:input.notes.bass 是 mg bass 原料 → per-section role gate → 直通(电
     * 贝斯不做音区调整,mg 输出已是合理 bass 范围)。
     *
     * Phase D+ 可加:articulation(slide / hammer-on / pull-off / mute)/
     * persona 消费(walkPatternId)
     */
    plan(input: MusicianPlanInput): NoteData[] {
        const raw = input.notes?.bass ?? [];
        if (raw.length === 0) return [];
        const out: NoteData[] = [];
        for (const n of raw) {
            const sectionIdx = findSectionIdxForBeat(n.onset, input.score.sections);
            if (sectionIdx < 0) continue;
            const myRoles = getMyRolesInSection(input, sectionIdx);
            if (!myRoles.includes('bass')) continue;
            out.push({ ...n });
        }
        return out;
    },

    getGmProgram(): number {
        return BASS_INSTRUMENT_SPEC.gmProgram;
    },
};
