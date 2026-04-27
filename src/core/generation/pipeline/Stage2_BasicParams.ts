import { PRNGManager } from '../../utils/PRNG';
import { MoodRegistry } from '../config/MoodFlags';
import { StructureEngine } from '../composing/StructureEngine';
import { Tonality } from '../types';
import { Stage1Output, Stage2Output } from './types';

const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export interface Stage2Options {
    forcedTimeSignature?: [number, number];
    forcedTonality?: Tonality;
    forcedKeyOffset?: number;
}

export function resolveBasicParams(
    stage1: Stage1Output,
    options: Stage2Options = {},
): Stage2Output {
    const { style, moodId } = stage1;
    const mood = MoodRegistry[moodId] ?? MoodRegistry[0];

    let timeSignature: [number, number];
    if (options.forcedTimeSignature) {
        timeSignature = options.forcedTimeSignature;
    } else {
        const pool = style.global.timeSignaturePool;
        const roll = PRNGManager.next();
        let total = 0;
        for (const e of pool) total += e.weight;
        const threshold = roll * total;
        let acc = 0;
        timeSignature = pool[0].signature;
        for (const e of pool) {
            acc += e.weight;
            if (threshold < acc) { timeSignature = e.signature; break; }
        }
    }

    let tonality: Tonality;
    if (options.forcedTonality !== undefined) {
        tonality = options.forcedTonality;
    } else {
        const pool = mood.tonalityBias ?? style.global.tonalityPool;
        const roll = PRNGManager.next();
        let total = 0;
        for (const e of pool) total += e.weight;
        const threshold = roll * total;
        let acc = 0;
        tonality = pool[0].tonality;
        for (const e of pool) {
            acc += e.weight;
            if (threshold < acc) { tonality = e.tonality; break; }
        }
    }

    const keyOffset = options.forcedKeyOffset !== undefined
        ? ((options.forcedKeyOffset % 12) + 12) % 12
        : Math.floor(PRNGManager.next() * 12);
    const keyName = KEY_NAMES[keyOffset];

    const [minBpm, maxBpm] = style.global.bpmRange;
    const baseBpm = Math.floor(PRNGManager.next() * (maxBpm - minBpm + 1)) + minBpm;
    const [lo, hi] = mood.bpmMultiplier;
    const mult = lo + PRNGManager.next() * (hi - lo);
    let bpm = Math.round(baseBpm * mult);
    if (bpm < 60) bpm = 60;
    if (bpm > 190) bpm = 190;

    const sections = StructureEngine.generateFullSongStructure(timeSignature, bpm, style, moodId);

    return {
        ...stage1,
        timeSignature,
        tonality,
        keyOffset,
        keyName,
        bpm,
        sections,
    };
}
