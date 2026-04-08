import { StyleConfig } from '../../types';
import { Tonality } from '../../types';
import { StyleId } from '../StyleFlags';

const DefaultStyle: StyleConfig = {
    id: StyleId.Default,
    name: 'Default',
    global: {
        bpmRange: [80, 120],
        timeSignaturePool: [{ signature: [4, 4] as [number, number], weight: 1.0 }],
        tonalityPool: [
            { tonality: Tonality.Major, weight: 0.6 },
            { tonality: Tonality.Minor, weight: 0.4 },
        ],
    },
    harmony: {
        chorusPool: [['I', 'V', 'vi', 'IV']],
        versePool: [['I', 'IV', 'V', 'vi']],
        preChorusPool: [['ii', 'V', 'IV', 'I']],
    },
    harmonyRules: {
        maxDissonanceTolerance: 0.5,
        reharmProbability: 0.1,
        passingChords: ['SecondaryDominant'],
        voicingStyle: 'standard',
        allowTritoneSub: false,
        borrowedChords: [],
    },
    rhythm: {
        densityBase: [0.4, 0.6],
        syncopationWeight: 0.2,
        restProbability: 0.15,
        disruptionProbability: 0.05,
        humanize: 0.01,
        swingRatio: 0.5,
        strictGrid: false,
    },
    melody: {
        stepwiseRatio: 0.7,
        maxJumpInterval: 7,
        tensionTolerance: 0.5,
        mutationProbability: 0.3,
        mutationPool: ['inversion', 'retrograde'],
        leapResolutionThreshold: 5,
        breathingRoomProbability: 0.2,
        anchorProbability: 0.5,
        pentatonicPreference: 0.3,
        pentatonicShiftProbability: 0,
        chromaticPassingProbability: 0,
        inflectionProbability: 0.15,
    },
    contrast: {
        versePitchOffset: 0,
        verseDensityMultiplier: 1.0,
        chorusPitchOffset: 5,
    },
    orchestration: {
        melodyInstruments: ['Acoustic_Grand'],
        chordInstruments: ['String_Ensemble_1'],
        bassInstruments: ['Acoustic_Bass'],
        drumInstruments: ['Standard_DrumKit'],
        counterMelodyInstruments: [],
        texturePool: ['Block'],
        counterMelodyProbability: 0,
        vocalProbability: 0,
        allowTradingFours: false,
    },
    modulation: {
        probability: 0,
        targetSection: 'Chorus',
        intervalPool: [5, 7],
    },
    performance: {
        allowedPersonas: ['neutral'],
    },
};

export const StyleRegistry: Record<number, StyleConfig> = {
    [StyleId.Default]: DefaultStyle,
};

export function getStyleConfig(styleId: StyleId): StyleConfig {
    return StyleRegistry[styleId] || DefaultStyle;
}

export function getAllAvailableStyles(): StyleConfig[] {
    return Object.values(StyleRegistry);
}
