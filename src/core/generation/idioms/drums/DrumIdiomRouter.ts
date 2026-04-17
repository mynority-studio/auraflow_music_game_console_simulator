// DrumIdiomRouter — 评分选择 + 华彩借调鼓组路由器
//
// 模型：
//   Level 2 (Section): 按 energy/sync/swing/sectionType 评分选"主 Idiom"
//   Level 3 (PhraseGroup): Bridge/PreChorus/Solo_Bridge 末段有概率"借调"第二高分 Idiom
//
// 顺滑保护：
//   - 借调 Idiom 首拍 = crash（"声明"新打法）
//   - 借调 Idiom 末拍 = fill（"告别"）
//   - 回归主 Idiom 首拍 = 重 kick + crash（"re-anchor"）
//
// 切换保护：
//   - 同 section 内锁定主 Idiom（评分只在 section 入口算一次）
//   - 相邻 section 允许切换
//   - 两个 idiom 分数差 < 10% → 优先保持上一个 section 的 idiom

import { NoteData, SectionMetadata, SectionType } from '../../types';
import { IDrumIdiom, DrumIdiomContext, GM_DRUMS } from './IDrumIdiom';
import { PRNGManager } from '../../../utils/PRNG';

// 🌟 所有已注册的 Idiom（由 register 时填入）
import { SteadyDrumIdiom } from './SteadyDrumIdiom';
import { SyncopatedDrumIdiom } from './SyncopatedDrumIdiom';
import { HighEnergyDrumIdiom } from './HighEnergyDrumIdiom';
import { SparseDrumIdiom } from './SparseDrumIdiom';
import { AcousticSwingDrumIdiom } from './AcousticSwingDrumIdiom';
import { CinematicDrumIdiom } from './CinematicDrumIdiom';

const ALL_IDIOMS: IDrumIdiom[] = [
    new SteadyDrumIdiom(),
    new SyncopatedDrumIdiom(),
    new HighEnergyDrumIdiom(),
    new SparseDrumIdiom(),
    new AcousticSwingDrumIdiom(),
    new CinematicDrumIdiom(),
];

// 华彩借调概率
const FLOURISH_PROB = 0.30;
// 华彩借调最小时长（拍）
const MIN_FLOURISH_BEATS = 8; // 2 小节

export class DrumIdiomRouter {
    /**
     * 为整个 section 生成鼓组 NoteData[]
     * 包含评分选择 + 华彩借调 + 顺滑过渡
     *
     * @param ctx           当前 section 的完整上下文
     * @param prevIdiomName 上一个 section 用的 idiom 名（用于切换保护）
     * @returns { notes, idiomName } — 生成的鼓 + 实际使用的主 idiom 名
     */
    public static generate(
        ctx: DrumIdiomContext,
        prevIdiomName: string | null = null,
    ): { notes: NoteData[], idiomName: string } {
        // ── 1. 评分所有 Idiom ──────────────────────────
        const scored: { idiom: IDrumIdiom, score: number }[] = [];
        for (let i = 0; i < ALL_IDIOMS.length; i++) {
            scored.push({ idiom: ALL_IDIOMS[i], score: ALL_IDIOMS[i].score(ctx) });
        }
        // 按分数降序排序（确定性：同分按 name 字典序）
        scored.sort((a, b) => {
            if (Math.abs(a.score - b.score) > 0.1) return b.score - a.score;
            return a.idiom.name < b.idiom.name ? -1 : 1;
        });

        // ── 2. 选主 Idiom（切换保护）─────────────────────
        let primaryIdiom = scored[0].idiom;
        const primaryScore = scored[0].score;
        const secondaryIdiom = scored.length > 1 ? scored[1].idiom : null;
        const secondaryScore = scored.length > 1 ? scored[1].score : 0;

        // 如果上一 section 的 idiom 仍在前两名且分数差 < 10%，保持不切
        if (prevIdiomName !== null && primaryIdiom.name !== prevIdiomName) {
            if (secondaryIdiom && secondaryIdiom.name === prevIdiomName) {
                const diffPct = (primaryScore - secondaryScore) / primaryScore;
                if (diffPct < 0.10) {
                    primaryIdiom = secondaryIdiom; // 保持上一个 idiom（减少不必要切换）
                }
            }
        }

        // ── 3. 华彩借调判定 ─────────────────────────────
        // 触发条件：Bridge / PreChorus / Solo_Bridge 段 + 有第二高分 idiom + PRNG 概率
        const isFlorishEligible =
            ctx.sectionType === SectionType.Bridge ||
            ctx.sectionType === SectionType.PreChorus ||
            ctx.sectionType === SectionType.Solo_Bridge ||
            (ctx.sectionType === SectionType.Chorus && ctx.energyLevel >= 9); // Chorus_Epic

        let flourishIdiom: IDrumIdiom | null = null;
        let flourishStartBeat = ctx.endBeat; // 默认不触发

        if (isFlorishEligible && secondaryIdiom && secondaryIdiom.name !== primaryIdiom.name) {
            const sectionLen = ctx.endBeat - ctx.startBeat;
            if (sectionLen >= MIN_FLOURISH_BEATS * 2) {
                // PRNG 决定是否华彩
                if (PRNGManager.next() < FLOURISH_PROB) {
                    flourishIdiom = secondaryIdiom;
                    // 华彩从段落最后 1/4 开始（至少 MIN_FLOURISH_BEATS 拍）
                    flourishStartBeat = ctx.endBeat - Math.max(MIN_FLOURISH_BEATS, sectionLen * 0.25);
                }
            }
        }
        // 消耗 1 次 PRNG 保持序列对齐（如果不 eligible 也消耗）
        if (!isFlorishEligible || !secondaryIdiom || secondaryIdiom.name === primaryIdiom.name) {
            PRNGManager.next(); // 占位消耗
        }

        // ── 4. 生成 ────────────────────────────────────
        const notes: NoteData[] = [];

        if (flourishIdiom && flourishStartBeat < ctx.endBeat - 1e-6) {
            // 主 Idiom 生成前段
            const mainCtx = { ...ctx, endBeat: flourishStartBeat };
            const mainNotes = primaryIdiom.generate(mainCtx);
            for (let i = 0; i < mainNotes.length; i++) notes.push(mainNotes[i]);

            // 过渡：主 Idiom 最后一拍加 fill（"告别"）
            const fillBeat = flourishStartBeat - 1;
            if (fillBeat >= ctx.startBeat) {
                notes.push({ pitch: GM_DRUMS.TOM_HI, onset: fillBeat, duration: 0.2, velocity: 0.7 });
                notes.push({ pitch: GM_DRUMS.TOM_MID, onset: fillBeat + 0.25, duration: 0.2, velocity: 0.75 });
                notes.push({ pitch: GM_DRUMS.TOM_LOW, onset: fillBeat + 0.5, duration: 0.2, velocity: 0.8 });
                notes.push({ pitch: GM_DRUMS.SNARE, onset: fillBeat + 0.75, duration: 0.2, velocity: 0.85 });
            }

            // 华彩 Idiom 首拍 crash（"声明"）
            notes.push({ pitch: GM_DRUMS.CRASH, onset: flourishStartBeat, duration: 1.5, velocity: 0.9 });

            // 华彩 Idiom 生成后段
            const flourishCtx = { ...ctx, startBeat: flourishStartBeat };
            const flourishNotes = flourishIdiom.generate(flourishCtx);
            for (let i = 0; i < flourishNotes.length; i++) notes.push(flourishNotes[i]);

            console.log(`[DrumRouter] sec=${ctx.sectionName} main=${primaryIdiom.name}(${primaryScore.toFixed(0)}) → flourish=${flourishIdiom.name}(${secondaryScore.toFixed(0)}) @${flourishStartBeat.toFixed(0)}`);
        } else {
            // 纯主 Idiom 生成全段
            const mainNotes = primaryIdiom.generate(ctx);
            for (let i = 0; i < mainNotes.length; i++) notes.push(mainNotes[i]);
        }

        // ── 5. 段落首拍 crash（re-anchor，如果 idiom 从上段切换过来）
        if (prevIdiomName !== null && prevIdiomName !== primaryIdiom.name && ctx.energyLevel >= 4) {
            // 加重 kick + crash 声明"新打法开始了"
            notes.push({ pitch: GM_DRUMS.CRASH, onset: ctx.startBeat, duration: 1.5, velocity: 0.85 });
            notes.push({ pitch: GM_DRUMS.KICK, onset: ctx.startBeat, duration: 0.3, velocity: 0.95 });
        }

        return { notes, idiomName: primaryIdiom.name };
    }
}
