import { PRNGManager } from '../../utils/PRNG';
import { StyleId } from '../config/StyleFlags';
import { RhythmCell } from '../types';
import { ENERGY } from '../config/EnergyThresholds';

export const PopRhythmCells: RhythmCell[] = [
    // Straight 8ths
    { durations: [0.5, 0.5], weight: 10, tags: ['straight', 'basic'] },
    { durations: [1.0], weight: 8, tags: ['straight', 'basic', 'long'] },
    
    // Syncopated (前八后十六, 附点等)
    { durations: [0.75, 0.25], weight: 7, tags: ['syncopated', 'dotted'] }, // Dotted 8th + 16th
    { durations: [0.25, 0.75], weight: 5, tags: ['syncopated', 'push'] },   // 16th + Dotted 8th
    { durations: [0.5, 0.25, 0.25], weight: 8, tags: ['straight', 'subdivided'] }, // 8th + two 16ths (前八后十六)
    { durations: [0.25, 0.25, 0.5], weight: 8, tags: ['straight', 'subdivided'] }, // Two 16ths + 8th (前十六后八)
    
    // 16th note runs
    { durations: [0.25, 0.25, 0.25, 0.25], weight: 6, tags: ['straight', 'fast'] },
    
    // Triplets
    { durations: [0.333, 0.333, 0.333], weight: 3, tags: ['triplet'] },
    
    // Rests (represented by negative durations or handled separately, but let's stick to positive for now and handle rests in generator)
];

export const FunkRhythmCells: RhythmCell[] = [
    { durations: [0.25, 0.25, 0.5], weight: 10, tags: ['syncopated', 'funk'] },
    { durations: [0.75, 0.25], weight: 8, tags: ['syncopated', 'funk'] },
    { durations: [0.25, 0.5, 0.25], weight: 9, tags: ['syncopated', 'funk'] }, // 16th, 8th, 16th (syncopated)
    { durations: [0.5, 0.25, 0.25], weight: 5, tags: ['straight', 'funk'] },
];

export const JazzRhythmCells: RhythmCell[] = [
    { durations: [0.666, 0.334], weight: 10, tags: ['swing', 'jazz'] }, // Swing 8ths
    { durations: [1.0], weight: 8, tags: ['straight', 'jazz'] },
    { durations: [0.333, 0.333, 0.333], weight: 6, tags: ['triplet', 'jazz'] },
    { durations: [0.5, 0.5], weight: 2, tags: ['straight', 'jazz'] }, // Less common in heavy swing
];

export const BossaNovaRhythmCells: RhythmCell[] = [
    // 🌟 Bossa Nova 专属节奏细胞 (Straight 8ths, Syncopated)
    { durations: [1.5, 0.5], weight: 10, tags: ['syncopated', 'bossa'] }, // 附点四分 + 八分 (经典切分)
    { durations: [0.5, 1.5], weight: 10, tags: ['syncopated', 'bossa'] }, // 八分 + 附点四分 (反向切分)
    { durations: [0.5, 0.5, 1.0], weight: 8, tags: ['straight', 'bossa'] }, // 两个八分 + 四分
    { durations: [1.0, 0.5, 0.5], weight: 8, tags: ['straight', 'bossa'] }, // 四分 + 两个八分
    { durations: [2.0], weight: 6, tags: ['long', 'bossa'] }, // 二分音符 (长音停留)
    { durations: [0.75, 0.25, 1.0], weight: 4, tags: ['syncopated', 'bossa'] }, // 偶尔的十六分音符切分
];

export const RnBRhythmCells: RhythmCell[] = [
    // 🌟 Phonetic Rhythm (语音化节奏): 连续短促的 16 分音符后接长音，模拟 R&B 的碎嘴和转音
    { durations: [0.25, 0.25, 0.25, 0.25, 1.0], weight: 10, tags: ['phonetic', 'rnb', 'burst'] },
    { durations: [0.25, 0.25, 0.5, 1.0], weight: 8, tags: ['phonetic', 'rnb'] },
    { durations: [0.25, 0.25, 0.25, 0.75], weight: 7, tags: ['phonetic', 'rnb', 'syncopated'] },
    { durations: [0.5, 0.25, 0.25, 1.0], weight: 6, tags: ['phonetic', 'rnb'] },
    { durations: [0.75, 0.25, 1.0], weight: 8, tags: ['syncopated', 'rnb'] },
    { durations: [0.25, 0.75, 1.0], weight: 6, tags: ['syncopated', 'rnb', 'push'] }
];

import { StyleRegistry } from '../config/styles/StyleRegistry';

export function getRandomRhythmCell(grooveTemplate: RhythmCell[] | undefined, energyLevel: number, isVocal: boolean = false): number[] {
    let cells = grooveTemplate || PopRhythmCells;

    // Filter by energy level (e.g., higher energy = more fast/subdivided cells)
    let filteredCells = cells;
    if (energyLevel < ENERGY.LOW_MAX || isVocal) {
        // Vocals should generally avoid very fast 16th note runs unless it's rap, but we assume melodic singing here
        filteredCells = cells.filter(c => !c.tags.includes('fast') && !(isVocal && c.durations.length > 2 && c.durations.every(d => d <= 0.25)));
        
        // Boost longer notes for vocals
        if (isVocal) {
            filteredCells = filteredCells.map(c => ({
                ...c,
                weight: c.tags.includes('long') || c.durations.includes(1.0) ? c.weight * 3 : c.weight
            }));
        }
    } else if (energyLevel > ENERGY.HIGH_MIN) {
        // Boost weight of fast/syncopated cells
        filteredCells = cells.map(c => ({
            ...c,
            weight: c.tags.includes('fast') || c.tags.includes('syncopated') ? c.weight * 2 : c.weight
        }));
    }

    // Weighted random selection
    const totalWeight = filteredCells.reduce((sum, cell) => sum + cell.weight, 0);
    let randomVal = PRNGManager.next() * totalWeight;
    for (const cell of filteredCells) {
        randomVal -= cell.weight;
        if (randomVal <= 0) {
            return cell.durations;
        }
    }
    return [1.0]; // Fallback
}
