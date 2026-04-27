import { PRNGManager } from '../../utils/PRNG';
import { StyleId } from '../config/StyleFlags';
import { MoodId } from '../config/MoodFlags';
import { getStyleConfig } from '../config/styles/StyleRegistry';
import { Stage1Output } from './types';
import { TrajectoryProfile } from '../types';

function inferTrajectoryProfile(styleId: StyleId, moodId: MoodId): TrajectoryProfile {
    let sync = 'Steady Eighths';
    let path = 'Lyrical Arch';

    switch (moodId) {
        case MoodId.Aggressive: sync = 'Fast Triplet Bursts'; break;
        case MoodId.Energetic: sync = 'Driving Sixteenths'; break;
        case MoodId.Chill: sync = 'Loose Backbeats'; break;
        case MoodId.Melancholic: sync = 'Sparse Halves'; break;
        case MoodId.Euphoric: sync = 'Anthemic Quarters'; break;
    }

    switch (styleId) {
        case StyleId.LofiChill: path = 'Wandering Triplets'; break;
        case StyleId.Synthwave: path = 'Rising Pulse'; break;
        case StyleId.ModernPop: path = 'Hooky Stepwise'; break;
    }

    return { sync, path };
}

interface WeightedMood {
    mood: MoodId;
    weight: number;
}

interface WeightedStyle {
    style: StyleId;
    weight: number;
}

const DEFAULT_STYLE_POOL: WeightedStyle[] = [
    { style: StyleId.ModernPop, weight: 0.4 },
    { style: StyleId.Synthwave, weight: 0.35 },
    { style: StyleId.LofiChill, weight: 0.25 },
];

const STYLE_MOOD_PREFERENCE: Record<number, WeightedMood[]> = {
    [StyleId.ModernPop]: [
        { mood: MoodId.Neutral, weight: 0.25 },
        { mood: MoodId.Energetic, weight: 0.25 },
        { mood: MoodId.Euphoric, weight: 0.25 },
        { mood: MoodId.Melancholic, weight: 0.15 },
        { mood: MoodId.Chill, weight: 0.10 },
    ],
    [StyleId.Synthwave]: [
        { mood: MoodId.Energetic, weight: 0.30 },
        { mood: MoodId.Melancholic, weight: 0.25 },
        { mood: MoodId.Neutral, weight: 0.25 },
        { mood: MoodId.Aggressive, weight: 0.15 },
        { mood: MoodId.Chill, weight: 0.05 },
    ],
    [StyleId.LofiChill]: [
        { mood: MoodId.Chill, weight: 0.45 },
        { mood: MoodId.Melancholic, weight: 0.30 },
        { mood: MoodId.Neutral, weight: 0.25 },
    ],
};

const NEUTRAL_MOOD_FALLBACK: WeightedMood[] = [
    { mood: MoodId.Neutral, weight: 1.0 },
];

function pickWeightedStyle(pool: WeightedStyle[], roll: number): StyleId {
    let total = 0;
    for (const entry of pool) total += entry.weight;
    const threshold = roll * total;
    let acc = 0;
    for (const entry of pool) {
        acc += entry.weight;
        if (threshold < acc) return entry.style;
    }
    return pool[pool.length - 1].style;
}

function pickWeightedMood(pool: WeightedMood[], roll: number): MoodId {
    let total = 0;
    for (const entry of pool) total += entry.weight;
    const threshold = roll * total;
    let acc = 0;
    for (const entry of pool) {
        acc += entry.weight;
        if (threshold < acc) return entry.mood;
    }
    return pool[pool.length - 1].mood;
}

export interface Stage1Options {
    allowedStyleIds?: StyleId[];
    forcedStyleId?: StyleId;
    forcedMoodId?: MoodId;
}

export function selectStyleAndMood(options: Stage1Options = {}): Stage1Output {
    let stylePool: WeightedStyle[] = DEFAULT_STYLE_POOL;
    if (options.allowedStyleIds && options.allowedStyleIds.length > 0) {
        const allowed = new Set<StyleId>(options.allowedStyleIds);
        stylePool = DEFAULT_STYLE_POOL.filter((e) => allowed.has(e.style));
        if (stylePool.length === 0) {
            stylePool = options.allowedStyleIds.map((s) => ({ style: s, weight: 1 }));
        }
    }

    const styleRoll = PRNGManager.next();
    const styleId = options.forcedStyleId !== undefined
        ? options.forcedStyleId
        : pickWeightedStyle(stylePool, styleRoll);

    const moodPool = STYLE_MOOD_PREFERENCE[styleId] ?? NEUTRAL_MOOD_FALLBACK;
    const moodRoll = PRNGManager.next();
    const moodId = options.forcedMoodId !== undefined
        ? options.forcedMoodId
        : pickWeightedMood(moodPool, moodRoll);

    const style = getStyleConfig(styleId);
    const trajectoryProfile = inferTrajectoryProfile(styleId, moodId);

    return { styleId, style, moodId, trajectoryProfile };
}
