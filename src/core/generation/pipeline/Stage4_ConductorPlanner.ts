import { EnsembleDrafter } from '../arrangement/EnsembleDrafter';
import { StyleId } from '../config/StyleFlags';
import { MoodId } from '../config/MoodFlags';
import {
    SectionType,
    SectionMetadata,
    ConductorPlan,
    ConductorSectionPlan,
    GlobalRhythmProfile,
    InstrumentRole,
    RhythmCenter,
} from '../types';
import { Stage3Output, Stage4Output } from './types';

function inferGlobalRhythm(styleId: StyleId, bpm: number): GlobalRhythmProfile {
    if (styleId === StyleId.LofiChill) return 'half-time';
    if (styleId === StyleId.Synthwave && bpm >= 110) return 'four-on-floor';
    if (bpm < 80) return 'ballad';
    return 'four-on-floor';
}

function pushUnique(arr: InstrumentRole[], item: InstrumentRole): void {
    for (let i = 0; i < arr.length; i++) if (arr[i] === item) return;
    arr.push(item);
}

function removeItem(arr: InstrumentRole[], item: InstrumentRole): void {
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] === item) { arr.splice(i, 1); return; }
    }
}

function planSection(
    section: SectionMetadata,
    styleId: StyleId,
    moodId: MoodId,
): ConductorSectionPlan {
    const secType = section.sectionType ?? SectionType.Verse;

    let focus: InstrumentRole = 'melody';
    const support: InstrumentRole[] = [];
    const silent: InstrumentRole[] = [];
    let rhythmCenter: RhythmCenter = 'downbeat';
    const counterpoint: Array<[InstrumentRole, InstrumentRole]> = [];
    const fillWindows: number[] = [];

    switch (secType) {
        case SectionType.Intro:
            focus = 'chord';
            pushUnique(support, 'bass');
            pushUnique(silent, 'drums');
            pushUnique(silent, 'counter');
            pushUnique(silent, 'secondary');
            rhythmCenter = 'downbeat';
            break;
        case SectionType.Verse:
            focus = 'melody';
            pushUnique(support, 'chord');
            pushUnique(support, 'bass');
            pushUnique(silent, 'counter');
            pushUnique(silent, 'secondary');
            rhythmCenter = 'downbeat';
            fillWindows.push(section.endBeat - 1);
            break;
        case SectionType.PreChorus:
            focus = 'melody';
            pushUnique(support, 'chord');
            pushUnique(support, 'bass');
            pushUnique(support, 'drums');
            pushUnique(silent, 'counter');
            rhythmCenter = 'syncopated';
            fillWindows.push(section.endBeat - 2);
            fillWindows.push(section.endBeat - 0.5);
            break;
        case SectionType.Chorus:
        case SectionType.Drop:
            focus = 'melody';
            pushUnique(support, 'chord');
            pushUnique(support, 'bass');
            pushUnique(support, 'drums');
            rhythmCenter = 'backbeat';
            counterpoint.push(['melody', 'counter']);
            fillWindows.push(section.endBeat - 1);
            break;
        case SectionType.Bridge:
        case SectionType.Solo_Bridge:
            focus = 'counter';
            pushUnique(support, 'chord');
            pushUnique(support, 'bass');
            pushUnique(silent, 'drums');
            rhythmCenter = 'syncopated';
            counterpoint.push(['counter', 'chord']);
            break;
        case SectionType.Break:
        case SectionType.Breakdown:
            focus = 'chord';
            pushUnique(support, 'bass');
            pushUnique(silent, 'drums');
            pushUnique(silent, 'counter');
            pushUnique(silent, 'secondary');
            rhythmCenter = 'downbeat';
            break;
        case SectionType.BuildUp:
            focus = 'chord';
            pushUnique(support, 'bass');
            pushUnique(support, 'drums');
            rhythmCenter = 'syncopated';
            fillWindows.push(section.endBeat - 1);
            fillWindows.push(section.endBeat - 0.5);
            break;
        case SectionType.Outro:
        case SectionType.PreOutro:
            focus = 'chord';
            pushUnique(support, 'bass');
            pushUnique(silent, 'drums');
            pushUnique(silent, 'counter');
            pushUnique(silent, 'secondary');
            rhythmCenter = 'downbeat';
            break;
        default:
            focus = 'melody';
            pushUnique(support, 'chord');
            pushUnique(support, 'bass');
            rhythmCenter = 'downbeat';
    }

    // 风格层微调
    if (styleId === StyleId.LofiChill) {
        if (secType !== SectionType.Break && secType !== SectionType.Breakdown) {
            pushUnique(silent, 'counter');
            removeItem(support, 'counter');
        }
        rhythmCenter = 'backbeat';
    } else if (styleId === StyleId.Synthwave) {
        if (secType === SectionType.Chorus || secType === SectionType.Drop) {
            rhythmCenter = 'backbeat';
        }
    }

    // 情绪层微调
    if (moodId === MoodId.Chill || moodId === MoodId.Melancholic) {
        removeItem(support, 'drums');
        pushUnique(silent, 'drums');
    } else if (moodId === MoodId.Aggressive || moodId === MoodId.Energetic) {
        if (secType === SectionType.Verse || secType === SectionType.PreChorus) {
            pushUnique(support, 'drums');
            removeItem(silent, 'drums');
        }
    }

    return {
        sectionName: section.name,
        startBeat: section.startBeat,
        endBeat: section.endBeat,
        focusInstrument: focus,
        supportInstruments: support,
        silentInstruments: silent,
        rhythmCenter,
        counterpointPairs: counterpoint,
        fillWindows,
    };
}

export function planConductor(stage3: Stage3Output): Stage4Output {
    const { style, styleId, moodId, sections, bpm } = stage3;
    const ensemble = EnsembleDrafter.draft(style);

    const globalRhythmProfile = inferGlobalRhythm(styleId, bpm);
    const planSections: ConductorSectionPlan[] = [];
    for (let i = 0; i < sections.length; i++) {
        planSections.push(planSection(sections[i], styleId, moodId));
    }

    const conductorPlan: ConductorPlan = {
        sections: planSections,
        globalRhythmProfile,
    };

    return { ...stage3, ensemble, conductorPlan };
}
