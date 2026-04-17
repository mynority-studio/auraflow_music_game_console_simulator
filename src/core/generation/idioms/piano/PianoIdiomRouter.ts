// PianoIdiomRouter — 和弦织体风格路由（务实简化版）
//
// 核心原则：
//   - 不强绑 subgenre → 按 energy + syncopation + swing + sectionType 评分
//   - 复用现有 TextureMapper.generateChordTexture（成熟的 voicing + 织体生成）
//   - 路由层只做"选 texture 类型 + 调参数"，不重写和弦生成逻辑
//
// 后续迭代：替换为完整的 IPianoIdiom 接口 + BasePianoIdiom 基类 + 5 个实现
//
// 设计契约：
//   - 不消耗 PRNG（评分 + texture 选择全用确定性逻辑）
//   - 不依赖未实现的 HarmonyCore 方法

import { NoteData, GeneratedChord, SectionType, SectionMetadata } from '../../types';
import { TextureMapper } from '../../arrangement/TextureMapper';
import { ENERGY } from '../../config/EnergyThresholds';

/**
 * Piano 织体策略（与 TextureMapper.generateChordTexture 的 textureType 参数对应）
 */
interface PianoStrategy {
    texture: string;         // 传给 generateChordTexture 的 textureType
    velocityMult: number;    // 力度乘数（0.7 = 柔和, 1.2 = 强烈）
    durationMult: number;    // 时值乘数（0.5 = staccato, 1.5 = legato）
}

/**
 * 5 种 Piano 策略 profile（覆盖用户代码中的 Block/Arpeggiated/Rhythmic/Sparse/Virtuoso）
 */
const PIANO_STRATEGIES: { name: string, strategy: PianoStrategy, scoreFunc: (energy: number, sync: number, swing: number, secType: SectionType, subgenre: string) => number }[] = [
    {
        name: 'Block',
        strategy: { texture: 'Block', velocityMult: 1.0, durationMult: 1.0 },
        scoreFunc: (e, sync, swing, sec, sub) => {
            let s = 40;
            if (e >= 4 && e <= 7) s += 20;
            if (sync < 0.4) s += 15;
            if (sec === SectionType.Verse || sec === SectionType.Chorus) s += 10;
            if (sub === 'Pop' || sub === 'Latin') s += 10;
            return Math.min(100, s);
        },
    },
    {
        name: 'Arpeggio',
        strategy: { texture: 'Arpeggio', velocityMult: 0.85, durationMult: 0.9 },
        scoreFunc: (e, sync, swing, sec, sub) => {
            let s = 30;
            if (e >= 3 && e <= 6) s += 20;
            if (swing > 0.55) s += 15;
            if (sec === SectionType.Intro || sec === SectionType.Bridge) s += 15;
            if (sub === 'Lo-fi') s += 15;
            return Math.min(100, s);
        },
    },
    {
        name: 'Rhythmic',
        strategy: { texture: 'Rhythmic', velocityMult: 1.1, durationMult: 0.5 },
        scoreFunc: (e, sync, swing, sec, sub) => {
            let s = 25;
            if (sync > 0.5) s += 25;
            if (e >= 6 && e <= 9) s += 20;
            if (sub === 'Funk') s += 20;
            if (sec === SectionType.Chorus || sec === SectionType.Drop) s += 10;
            return Math.min(100, s);
        },
    },
    {
        name: 'Pad',
        strategy: { texture: 'Pad', velocityMult: 0.7, durationMult: 2.0 },
        scoreFunc: (e, sync, swing, sec, sub) => {
            let s = 30;
            if (e <= 3) s += 35;
            if (sec === SectionType.Intro || sec === SectionType.Outro || sec === SectionType.Break) s += 15;
            if (sec === SectionType.PreOutro) s += 10;
            return Math.min(100, s);
        },
    },
    {
        name: 'Pulsing',
        strategy: { texture: 'Pulsing', velocityMult: 1.0, durationMult: 0.8 },
        scoreFunc: (e, sync, swing, sec, sub) => {
            let s = 20;
            if (e >= 8) s += 30;
            if (sec === SectionType.BuildUp || sec === SectionType.Drop) s += 20;
            return Math.min(100, s);
        },
    },
];

export class PianoIdiomRouter {
    /**
     * 为和弦选择最佳 texture 策略
     * @returns 推荐的 textureType（传给 generateChordTexture）
     */
    public static pickTexture(
        energyLevel: number,
        syncopation: number,
        swing: number,
        sectionType: SectionType,
        subgenre: string,
        prevTexture: string | null = null,
    ): string {
        // 评分所有策略
        let bestScore = -1;
        let bestTexture = 'Block';
        let secondBestTexture = 'Block';
        let secondBestScore = -1;

        for (let i = 0; i < PIANO_STRATEGIES.length; i++) {
            const ps = PIANO_STRATEGIES[i];
            const score = ps.scoreFunc(energyLevel, syncopation, swing, sectionType, subgenre);
            if (score > bestScore) {
                secondBestScore = bestScore;
                secondBestTexture = bestTexture;
                bestScore = score;
                bestTexture = ps.strategy.texture;
            } else if (score > secondBestScore) {
                secondBestScore = score;
                secondBestTexture = ps.strategy.texture;
            }
        }

        // 切换保护：如果上一段 texture 仍在前两名且分差 < 15%，保持
        if (prevTexture !== null && prevTexture !== bestTexture) {
            if (prevTexture === secondBestTexture) {
                const diffPct = bestScore > 0 ? (bestScore - secondBestScore) / bestScore : 1;
                if (diffPct < 0.15) {
                    return prevTexture;
                }
            }
        }

        return bestTexture;
    }
}
