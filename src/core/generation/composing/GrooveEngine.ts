import { PRNGManager } from '../../utils/PRNG';
import { NoteData } from '../types';

const EPSILON = 1e-6;

/** 将 n 加入数组（若已存在则跳过），保持唯一性 */
function addUnique(arr: number[], n: number): void {
    for (let i = 0; i < arr.length; i++) {
        if (Math.abs(arr[i] - n) < EPSILON) return;
    }
    arr.push(n);
}

export class GrooveEngine {
    private static GRID_STEP = 0.25; 

    public static generateRhythmFingerprint(
        density: number,
        syncopationProb: number,
        beatsPerBar: number,
        userMotif?: NoteData[]
    ): number[] {
        const loopLength = 2 * beatsPerBar;

        // 🌟 核心修复：如果用户提供了 Motif，提取其节奏指纹作为全曲律动基准
        if (userMotif && userMotif.length > 0) {
            const fingerprint: number[] = [];
            userMotif.forEach(n => {
                const offset = n.onset % loopLength;
                // 量化到 GRID_STEP
                const quantized = Math.round(offset / this.GRID_STEP) * this.GRID_STEP;
                addUnique(fingerprint, quantized);
            });

            // 确保强拍有锚点，避免律动散架
            addUnique(fingerprint, 0);

            let result = fingerprint.slice().sort((a, b) => a - b);
            
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
            
            // 🌟 修复：大幅降低 16分音符的权重，避免产生“小碎音”，但 Funk 等高切分曲风除外
            let baseWeight = 0;
            if (Number.isInteger(stepPos)) {
                baseWeight = 1.0; // 正拍 (0, 1, 2, 3)
            } else if (Math.abs(stepPos % 1 - 0.5) < EPSILON) {
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
        const fingerprint: number[] = [0]; // 第0拍永远有锚点
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
        
        // sort 后元素唯一（fingerprint 通过 addUnique 构建），tie 不会出现
        return fingerprint.slice().sort((a, b) => a - b);
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
            if (Number.isInteger(stepPos)) {
                weight *= 1.0;
            } else if (Math.abs(stepPos % 1 - 0.5) < EPSILON) {
                weight *= 0.8;
            } else {
                weight *= 0.1; // 极大地压制 16分音符
            }
            
            possibleSteps.push({ offset, weight });
        }
        
        // 引入随机性并按权重排序
        const inverseFingerprint: number[] = [0]; // 强拍锚点
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
        
        // sort 后元素唯一（inverseFingerprint[0]=0，后续通过 availableSteps 选取不重复的 offset）
        return inverseFingerprint.slice().sort((a, b) => a - b);
    }
}