import { PRNGManager } from '../../../utils/PRNG';
import { NoteData } from '../../types';
import { PianoIdiomContext, PianoIdiom } from '../types';

/**
 * Syncopated Comping Idiom — 切分慵懒和弦伴奏
 *
 * 演奏特征：抢拍/反拍/拖拍三种律动模式、Rolled Chord 琶音错位、
 * 省音（只弹 3 个色彩音）、力度偏软。
 * 适用风格：Lo-Fi, Neo-Soul, Chill R&B, Jazz
 *
 * max ~50 notes per chord (C-4 compliance)
 */
export const SyncopatedCompingIdiom: PianoIdiom = {
    generate(ctx: PianoIdiomContext): NoteData[] {
        const notes: NoteData[] = [];
        const { chordTones, chordStart, chordEnd, humanize, syncopationWeight } = ctx;
        const chordLen = chordEnd - chordStart;

        // 省音：只弹前 3 个色彩音（省略根音交给 Bass，省略纯五度）
        // 如果和弦只有 3 个音就全弹，超过 3 个取 index 1,2,3（跳过根音 index 0）
        let voicing: number[];
        if (chordTones.length <= 3) {
            voicing = chordTones.slice(0, 3);
        } else {
            voicing = chordTones.slice(1, 4); // 跳过根音，取 3/5/7 或 3/7/9
        }

        // 律动状态机：决定和弦在哪些时间点弹
        const compRoll = PRNGManager.next();
        const playOnsets: number[] = [];

        if (compRoll < 0.3) {
            // 模式 A：抢拍 (Anticipation) — 提前 0.5 拍进入
            const onset = chordStart - 0.5;
            if (onset >= 0) playOnsets.push(onset);
            else playOnsets.push(chordStart); // 歌曲开头不能为负
        } else if (compRoll < 0.7) {
            // 模式 B：反拍 (Off-beat Comping) — 正拍留白，弹在 +0.5 和可能 +1.5
            playOnsets.push(chordStart + 0.5);
            if (PRNGManager.next() < syncopationWeight && chordLen >= 2) {
                playOnsets.push(chordStart + 1.5);
            }
        } else {
            // 模式 C：拖拍 (Laid-back) — 正拍但物理后拖
            const laidBack = PRNGManager.next() * 0.1 * humanize;
            playOnsets.push(chordStart + laidBack);
        }

        // 生成音符：Rolled Chord + 动态力度
        for (const onset of playOnsets) {
            if (onset >= chordEnd - 1e-6) continue;

            // Stab（短促顿音） vs Pad（长音）
            const isOffBeat = Math.abs(onset % 1 - 0.5) < 0.25;
            const isStab = isOffBeat && PRNGManager.next() < 0.5;
            const duration = isStab ? 0.5 : Math.max(0.5, (chordEnd - onset) * 0.8);

            // 整体力度偏软（0.35~0.55），温暖感
            const baseVel = 0.35 + PRNGManager.next() * 0.2;

            for (let i = 0; i < voicing.length; i++) {
                // Rolled Chord：每个音错开 0.02~0.04 拍 × humanize
                const fingerDelay = i * (0.02 + PRNGManager.next() * 0.02) * humanize;
                // 顶音（最高音）加重，突出色彩
                const vel = i === voicing.length - 1 ? baseVel + 0.1 : baseVel;

                notes.push({
                    pitch: voicing[i],
                    onset: onset + fingerDelay,
                    duration: duration,
                    velocity: Math.min(1.0, vel),
                });
            }
        }

        return notes;
    }
};
