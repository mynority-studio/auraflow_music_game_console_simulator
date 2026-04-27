import { StyleId } from '../config/StyleFlags';
import { MoodId } from '../config/MoodFlags';
import {
    Tonality,
    GeneratedChord,
    SectionMetadata,
    EnsembleDraft,
    GeneratedTrack,
    MusicContext,
    StyleConfig,
    GenerationOptions,
    ConductorPlan,
    CadentialBridge,
    TrajectoryProfile,
} from '../types';

export type {
    ConductorPlan,
    CadentialBridge,
    InstrumentRole,
    RhythmCenter,
    GlobalRhythmProfile,
    ConductorSectionPlan,
    TrajectoryProfile,
} from '../types';

export interface Stage1Output {
    styleId: StyleId;
    style: StyleConfig;
    moodId: MoodId;
    trajectoryProfile: TrajectoryProfile;
}

export interface Stage2Output extends Stage1Output {
    timeSignature: [number, number];
    tonality: Tonality;
    keyOffset: number;
    keyName: string;
    bpm: number;
    sections: SectionMetadata[];
}

export interface Stage3Output extends Stage2Output {
    chords: GeneratedChord[];
    cadentialBridges: CadentialBridge[];
}

export interface Stage4Output extends Stage3Output {
    ensemble: EnsembleDraft;
    conductorPlan: ConductorPlan;
}

export interface PipelineResult {
    track: GeneratedTrack;
    context: MusicContext;
}

export interface PipelineInput {
    options?: GenerationOptions;
}
