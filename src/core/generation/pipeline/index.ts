import { PRNGManager } from '../../utils/PRNG';
import { GenerationOptions } from '../types';
import { StyleId } from '../config/StyleFlags';
import { MoodId } from '../config/MoodFlags';
import { selectStyleAndMood, Stage1Options } from './Stage1_StyleAndMood';
import { resolveBasicParams, Stage2Options } from './Stage2_BasicParams';
import { generateHarmony } from './Stage3_HarmonicEngine';
import { planConductor } from './Stage4_ConductorPlanner';
import { layerInstruments } from './Stage5_InstrumentLayering';
import { PipelineResult } from './types';

export interface PipelineRunOptions {
    allowedStyleIds?: StyleId[];
    forcedStyleId?: StyleId;
    forcedMoodId?: MoodId;
    generation?: GenerationOptions;
}

// 五阶段管道统一入口
// PRNG 快照点（ACVE §5.1 新定义）：
//   stateB : selectStyleAndMood 入口
//   stateB2: resolveBasicParams 入口
//   stateC : planConductor 入口
//   stateD : layerInstruments 入口
export function runPipeline(options: PipelineRunOptions = {}): PipelineResult {
    PRNGManager.recordSnapshot('B');

    const stage1Opts: Stage1Options = {
        allowedStyleIds: options.allowedStyleIds,
        forcedStyleId: options.forcedStyleId ?? options.generation?.styleId,
        forcedMoodId: options.forcedMoodId ?? options.generation?.moodId,
    };
    const s1 = selectStyleAndMood(stage1Opts);

    const stage2Opts: Stage2Options = {
        forcedTimeSignature: options.generation?.detectedTimeSignature,
        forcedTonality: options.generation?.detectedTonality,
        forcedKeyOffset: options.generation?.userMotifRoot,
    };
    const s2 = resolveBasicParams(s1, stage2Opts);

    const s3 = generateHarmony(s2);

    PRNGManager.recordSnapshot('C');
    const s4 = planConductor(s3);

    PRNGManager.recordSnapshot('D');
    return layerInstruments(s4, options.generation);
}
