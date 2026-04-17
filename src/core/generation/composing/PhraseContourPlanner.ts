// PhraseContourPlanner — 三层张力曲线统一调度（P6b）
//
// 设计来源：
// - Luis 提案 #3：全局张力封套（避免 velocity/jitter/pitch 三维独立随机的"散沙"听感）
// - 拓展：三层叠加（song/section/phrase），让张力同时具有"段落感"和"乐句感"
//
// 数学结构：
//   tension(beat, phraseStart, phraseLen) =
//     0.5 × songLevel(beat)
//   + 0.3 × sectionLevel(beat)
//   + 0.2 × phraseLevel(beat, phraseStart, phraseLen)
//
// 用途：
//   - realizeMotif 内决定 velocity（base × (0.6 + 0.4 × tension)）
//   - realizeMotif 内决定 timing jitter（jitter × (1.1 - tension)，张力高 = 精准）
//   - AnchorBackbone 决定 anchor pitch 高度（高张力倾向高音区）
//
// 设计契约（见 .claude/rules/music_generation_pipeline_rule.md）：
//   - 纯函数，零 PRNG 消耗（D-1）
//   - 不读 GlobalContext（S-2）
//   - 不引入 Map/Set（P-1）
//   - 浮点比较用 epsilon（C-1, D-4）
//   - C 移植友好：sectionAnchors 用排序数组 + 线性扫描

import { SectionMetadata, SectionType } from '../types';

/**
 * sectionType → 基础张力值映射表（song-level 锚点）
 * 数值参考音乐流行编曲传统：Verse 静、PreChorus 上升、Chorus 爆发、Bridge 沉、Outro 收
 */
const SECTION_TYPE_TENSION: number[] = [];
SECTION_TYPE_TENSION[SectionType.Intro]       = 0.25;
SECTION_TYPE_TENSION[SectionType.Verse]       = 0.30;
SECTION_TYPE_TENSION[SectionType.PreChorus]   = 0.60;
SECTION_TYPE_TENSION[SectionType.Chorus]      = 0.90;
SECTION_TYPE_TENSION[SectionType.Bridge]      = 0.40;
SECTION_TYPE_TENSION[SectionType.Outro]       = 0.20;
SECTION_TYPE_TENSION[SectionType.Break]       = 0.30;
SECTION_TYPE_TENSION[SectionType.Breakdown]   = 0.20;
SECTION_TYPE_TENSION[SectionType.BuildUp]     = 0.75;
SECTION_TYPE_TENSION[SectionType.Drop]        = 0.95;
SECTION_TYPE_TENSION[SectionType.PreOutro]    = 0.35;
SECTION_TYPE_TENSION[SectionType.Solo_Bridge] = 0.55;

const EPSILON = 1e-6;

/**
 * Song-level 张力曲线锚点（按 section 起始拍排列）
 * max ~20 anchors per song
 */
interface SongTensionAnchor {
    beat: number;
    tension: number;
}

/**
 * TensionEnvelope — 三层张力查询接口
 * 由 PhraseContourPlanner.buildForSong() 构建一次，realizeMotif/AnchorBackbone 共享读取
 */
export interface TensionEnvelope {
    /** L1 全曲张力：sectionType 映射 + 线性插值 */
    songLevel(beat: number): number;
    /** L2 段内张力：根据 sectionType 返回曲线形态 */
    sectionLevel(beat: number): number;
    /** L3 乐句内张力：弱起→推进→收尾的固定形状 */
    phraseLevel(beat: number, phraseStart: number, phraseLen: number): number;
    /** 综合（0.5/0.3/0.2 加权） */
    at(beat: number, phraseStart: number, phraseLen: number): number;
}

export class PhraseContourPlanner {
    /**
     * 构建全曲的张力曲线封套
     * @param sections 全曲段落列表（已生成）
     */
    public static buildForSong(sections: SectionMetadata[]): TensionEnvelope {
        // ── L1: 收集 song-level 锚点 ─────────────────────────
        // max ~20 anchors（每个 section 一个 + 末锚）
        const songAnchors: SongTensionAnchor[] = [];
        for (let i = 0; i < sections.length; i++) {
            const sec = sections[i];
            const stype = sec.sectionType !== undefined ? sec.sectionType : SectionType.Verse;
            let base = SECTION_TYPE_TENSION[stype] !== undefined ? SECTION_TYPE_TENSION[stype] : 0.5;
            // Chorus_Epic 由 energyLevel >= 9 识别（StructureEngine 会标 energy 10）
            if (stype === SectionType.Chorus && sec.energyLevel >= 9) {
                base = Math.max(base, 1.0);
            }
            songAnchors.push({ beat: sec.startBeat, tension: base });
        }
        // 末锚：在最后一个 section 的 endBeat 处放一个相同张力
        if (sections.length > 0) {
            const last = sections[sections.length - 1];
            const lastStype = last.sectionType !== undefined ? last.sectionType : SectionType.Verse;
            const lastBase = SECTION_TYPE_TENSION[lastStype] !== undefined ? SECTION_TYPE_TENSION[lastStype] : 0.5;
            songAnchors.push({ beat: last.endBeat, tension: lastBase });
        }

        // 索引 sections 用于 sectionLevel 快速查找（线性扫描即可，max 20 sections）
        // 注意：sections 已按 startBeat 升序

        // ── songLevel: 在 songAnchors 上做线性插值 ───────────
        const songLevel = (beat: number): number => {
            if (songAnchors.length === 0) return 0.5;
            if (beat <= songAnchors[0].beat + EPSILON) return songAnchors[0].tension;
            if (beat >= songAnchors[songAnchors.length - 1].beat - EPSILON) {
                return songAnchors[songAnchors.length - 1].tension;
            }
            for (let i = 0; i < songAnchors.length - 1; i++) {
                const a = songAnchors[i];
                const b = songAnchors[i + 1];
                if (beat >= a.beat - EPSILON && beat < b.beat - EPSILON) {
                    if (Math.abs(b.beat - a.beat) < EPSILON) return a.tension;
                    const t = (beat - a.beat) / (b.beat - a.beat);
                    return a.tension + (b.tension - a.tension) * t;
                }
            }
            return songAnchors[songAnchors.length - 1].tension;
        };

        // ── sectionLevel: per section 形状函数 ───────────────
        // base = songLevel(section.startBeat)（即该 section 起始的 L1 值）
        // 形状：Verse 平稳 / Chorus 抛物线峰值偏前 / Bridge 下凹 / ...
        const sectionLevel = (beat: number): number => {
            // 找到 beat 落在哪个 section
            for (let i = 0; i < sections.length; i++) {
                const sec = sections[i];
                if (beat >= sec.startBeat - EPSILON && beat < sec.endBeat - EPSILON) {
                    const lengthBeats = sec.endBeat - sec.startBeat;
                    if (lengthBeats < EPSILON) return songLevel(sec.startBeat);
                    const progress = (beat - sec.startBeat) / lengthBeats;
                    const base = songLevel(sec.startBeat);
                    const stype = sec.sectionType !== undefined ? sec.sectionType : SectionType.Verse;

                    let multiplier = 1.0;
                    if (stype === SectionType.Verse) {
                        multiplier = 0.95 + 0.05 * Math.sin(Math.PI * progress); // 中点略高
                    } else if (stype === SectionType.Chorus) {
                        // 抛物线峰值偏前（progress^0.7 让峰值落在 ~0.4 而非 0.5）
                        multiplier = 0.85 + 0.35 * Math.sin(Math.PI * Math.pow(progress, 0.7));
                    } else if (stype === SectionType.PreChorus) {
                        multiplier = 0.7 + 0.3 * progress; // 上升
                    } else if (stype === SectionType.Bridge) {
                        multiplier = 1.0 - 0.3 * Math.sin(Math.PI * progress); // 下凹
                    } else if (stype === SectionType.Solo_Bridge) {
                        multiplier = 0.6 + 0.5 * progress; // 上升
                    } else if (stype === SectionType.Outro || stype === SectionType.PreOutro) {
                        multiplier = 1.0 - 0.5 * progress; // 下降
                    } else if (stype === SectionType.BuildUp) {
                        multiplier = 0.5 + 0.5 * (progress * progress); // 指数上升
                    } else if (stype === SectionType.Drop) {
                        multiplier = 1.0 - 0.2 * progress; // 冲击后微衰
                    }
                    return Math.max(0, Math.min(1, base * multiplier));
                }
            }
            return songLevel(beat);
        };

        // ── phraseLevel: per phrase 弱起→推进→收尾 ──────────
        const phraseLevel = (beat: number, phraseStart: number, phraseLen: number): number => {
            if (phraseLen < EPSILON) return 0.5;
            const p = (beat - phraseStart) / phraseLen;
            if (p < 0 - EPSILON) return 0.4;
            if (p > 1 + EPSILON) return 0.5;
            if (p < 0.25) {
                // 弱起：0.4 → 0.6
                return 0.4 + 0.8 * (p / 0.25);
            } else if (p < 0.75) {
                // 推进：0.7 → 0.9（中点峰值）
                return 0.7 + 0.2 * Math.sin(Math.PI * (p - 0.25) / 0.5);
            } else {
                // 收尾：0.6 → 0.5
                return 0.6 - 0.1 * ((p - 0.75) / 0.25);
            }
        };

        // ── at: 综合（0.5/0.3/0.2）─────────────────────────
        const at = (beat: number, phraseStart: number, phraseLen: number): number => {
            const l1 = songLevel(beat);
            const l2 = sectionLevel(beat);
            const l3 = phraseLevel(beat, phraseStart, phraseLen);
            const composite = 0.5 * l1 + 0.3 * l2 + 0.2 * l3;
            return Math.max(0, Math.min(1, composite));
        };

        return { songLevel, sectionLevel, phraseLevel, at };
    }
}
