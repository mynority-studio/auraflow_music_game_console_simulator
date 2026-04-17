import { PRNGManager } from '../../utils/PRNG';
import { StyleConfig } from '../types';
import { sortAndDedupNumbers } from '../utils/Dedup';
import { isOnDownbeat, isOnOffbeat } from '../utils/BeatMath';

export class GrooveEngine {
    private static GRID_STEP = 0.25;
    // PR #8 §4.2: 连续非正拍音符上限(8 分反拍 + 16 分切分),超出后强制回正拍
    private static MAX_CONSECUTIVE_OFFBEAT = 2;

    /**
     * 切分音收敛 cap — 连续 >2 个非 downbeat 音符时丢弃后续,直到遇到下一个正拍。
     * 后处理,不消耗 PRNG,ACVE 兼容。
     */
    private static capSyncopation(sortedFingerprint: number[]): number[] {
        const result: number[] = [];
        let consecutiveOff = 0;
        for (let i = 0; i < sortedFingerprint.length; i++) {
            const offset = sortedFingerprint[i];
            if (isOnDownbeat(offset)) {
                consecutiveOff = 0;
                result.push(offset);
            } else {
                consecutiveOff++;
                if (consecutiveOff <= this.MAX_CONSECUTIVE_OFFBEAT) {
                    result.push(offset);
                }
            }
        }
        return result;
    }

    public static generateRhythmFingerprint(
        density: number,
        syncopationProb: number,
        beatsPerBar: number, 
        userMotif?: any[]
    ): number[] {
        const loopLength = 2 * beatsPerBar; 
        
        // 🌟 核心修复：如果用户提供了 Motif，提取其节奏指纹作为全曲律动基准
        if (userMotif && userMotif.length > 0) {
            // C 可移植：用数组累积 + 末尾排序去重，取代 Set
            const rawOffsets: number[] = [0]; // 强拍锚点，避免律动散架
            for (let i = 0; i < userMotif.length; i++) {
                const offset = userMotif[i].onset % loopLength;
                const quantized = Math.round(offset / this.GRID_STEP) * this.GRID_STEP;
                rawOffsets.push(quantized);
            }

            let result = sortAndDedupNumbers(rawOffsets);
            
            // 根据 density 动态删减音符 (例如在 Verse 中让律动更稀疏)
            if (density < 0.5 && result.length > 2) {
                const targetCount = Math.max(2, Math.floor(result.length * (density * 2)));
                // 保留 0 拍，随机移除其他拍子
                while (result.length > targetCount) {
                    const removeIdx = 1 + Math.floor(PRNGManager.next() * (result.length - 1));
                    result.splice(removeIdx, 1);
                }
            }
            return result;
        }

        let targetDensity = Math.min(density, 0.9); 
        
        const totalSteps = loopLength / this.GRID_STEP; 
        const targetNotesCount = Math.max(2, Math.floor(totalSteps * targetDensity)); // 确保最少有两个律动点
        
        let possibleSteps: { offset: number, weight: number }[] = [];
        for (let i = 1; i < totalSteps; i++) {
            const stepPos = (i * this.GRID_STEP) % beatsPerBar; 
            
            // 🌟 修复：大幅降低 16分音符的权重，避免产生"小碎音"，但 Funk 等高切分曲风除外
            let baseWeight = 0;
            if (isOnDownbeat(stepPos)) {
                baseWeight = 1.0; // 正拍 (0, 1, 2, 3)
            } else if (isOnOffbeat(stepPos)) {
                baseWeight = 0.6 + syncopationProb * 0.4; // 8分音符反拍 (0.5, 1.5...)
            } else {
                if (syncopationProb >= 0.7) {
                    baseWeight = 0.4 + syncopationProb * 0.3; // 允许 16分音符
                } else {
                    baseWeight = 0.05 + syncopationProb * 0.1; // 16分音符，极低权重
                }
            }
            
            possibleSteps.push({ offset: i * this.GRID_STEP, weight: baseWeight });
        }
        
        // 引入随机性并按权重排序，确保音符分布在整个乐句中，而不是集中在开头
        let fingerprint: number[] = [0]; // 第0拍永远有锚点
        let availableSteps = [...possibleSteps];
        for (let i = 0; i < targetNotesCount - 1 && availableSteps.length > 0; i++) {
            let totalWeight = availableSteps.reduce((sum, step) => sum + step.weight, 0);
            let randomVal = PRNGManager.next() * totalWeight;
            let selectedIdx = 0;
            for (let j = 0; j < availableSteps.length; j++) {
                randomVal -= availableSteps[j].weight;
                if (randomVal <= 0) {
                    selectedIdx = j;
                    break;
                }
            }
            fingerprint.push(availableSteps[selectedIdx].offset);
            availableSteps.splice(selectedIdx, 1);
        }

        return this.capSyncopation(sortAndDedupNumbers(fingerprint));
    }

    /**
     * 🌟 F-Groove1: PhraseGroup 级律动变体
     * 在 base 指纹基础上做 1-2 个 step 的概率扰动（增/删一个 hit），
     * 让每个大乐句的节奏不完全相同，但保留段落"family resemblance"。
     *
     * @param baseGroove   段落级基础指纹
     * @param beatsPerBar  拍号分子
     * @param phraseIdx    PhraseGroup 索引（不同 phrase 引入不同扰动方向）
     * @returns 变体指纹（保留 [0] 强拍锚点）
     */
    public static varyGrooveForPhrase(
        baseGroove: number[],
        beatsPerBar: number,
        phraseIdx: number,
    ): number[] {
        if (baseGroove.length === 0) return baseGroove;
        const result: number[] = [];
        for (let i = 0; i < baseGroove.length; i++) result.push(baseGroove[i]);

        const loopLength = 2 * beatsPerBar;
        const totalSteps = loopLength / this.GRID_STEP;

        // 第一个 phrase 不扰动（保持 base 锚点感），后续 phrase 每个做 1-2 次扰动
        if (phraseIdx === 0) return result;

        // 扰动次数：偶数 phrase 1 次，奇数 2 次（节奏感波动）
        const mutateCount = (phraseIdx % 2 === 0) ? 1 : 2;
        for (let m = 0; m < mutateCount; m++) {
            const action = PRNGManager.next();
            if (action < 0.5 && result.length > 2) {
                // 删一个 hit（不删 [0] 强拍锚点）
                const removeIdx = 1 + Math.floor(PRNGManager.next() * (result.length - 1));
                result.splice(removeIdx, 1);
            } else {
                // 加一个 hit（在 base 没有的 step 上，优先加在 8 分反拍）
                const candidates: number[] = [];
                for (let s = 1; s < totalSteps; s++) {
                    const offset = s * this.GRID_STEP;
                    if (result.indexOf(offset) === -1) {
                        candidates.push(offset);
                    }
                }
                if (candidates.length > 0) {
                    const addIdx = Math.floor(PRNGManager.next() * candidates.length);
                    result.push(candidates[addIdx]);
                    result.sort((a, b) => a - b);
                }
            }
        }
        return this.capSyncopation(result);
    }

    // ⚖️ 旋律与伴奏的互补对抗 (Inverse Density)
    public static generateInverseGroove(baseGroove: number[], beatsPerBar: number, density: number = 0.5): number[] {
        const loopLength = 2 * beatsPerBar;
        const totalSteps = loopLength / this.GRID_STEP;
        const baseDensity = baseGroove.length / totalSteps;
        
        // 如果伴奏极密 (density > 0.5)，旋律强制变疏 (长音为主)
        // 如果伴奏极疏 (density < 0.3)，旋律强制变密 (填缝)
        // 保证旋律密度在 0.2 到 0.8 之间
        let targetDensity = Math.max(0.2, Math.min(0.8, 1.0 - baseDensity));
        
        // 🌟 修复：应用风格的密度乘数，防止在舒缓曲风中生成过于密集的旋律骨架
        targetDensity = Math.min(0.8, targetDensity * (density * 2));
        
        const targetNotesCount = Math.max(2, Math.floor(totalSteps * targetDensity));
        
        let possibleSteps: { offset: number, weight: number }[] = [];
        for (let i = 1; i < totalSteps; i++) {
            const offset = i * this.GRID_STEP;
            const stepPos = offset % beatsPerBar;
            
            // 互补对抗核心：如果伴奏在这个点发声了，旋律尽量避开；如果伴奏没发声，旋律尽量填补
            const isBaseHit = baseGroove.includes(offset);
            let weight = isBaseHit ? 0.1 : 0.9; 
            
            // 🌟 修复：加上节拍权重，防止在 inverse 时大量选中 16分音符
            if (isOnDownbeat(stepPos)) {
                weight *= 1.0;
            } else if (isOnOffbeat(stepPos)) {
                weight *= 0.8;
            } else {
                weight *= 0.1; // 极大地压制 16分音符
            }
            
            possibleSteps.push({ offset, weight });
        }
        
        // 引入随机性并按权重排序
        let inverseFingerprint: number[] = [0]; // 强拍锚点
        let availableSteps = [...possibleSteps];
        for (let i = 0; i < targetNotesCount - 1 && availableSteps.length > 0; i++) {
            let totalWeight = availableSteps.reduce((sum, step) => sum + step.weight, 0);
            let randomVal = PRNGManager.next() * totalWeight;
            let selectedIdx = 0;
            for (let j = 0; j < availableSteps.length; j++) {
                randomVal -= availableSteps[j].weight;
                if (randomVal <= 0) {
                    selectedIdx = j;
                    break;
                }
            }
            inverseFingerprint.push(availableSteps[selectedIdx].offset);
            availableSteps.splice(selectedIdx, 1);
        }

        return this.capSyncopation(sortAndDedupNumbers(inverseFingerprint));
    }
}