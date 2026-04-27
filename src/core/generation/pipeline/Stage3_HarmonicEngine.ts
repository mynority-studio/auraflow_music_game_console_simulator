import { HarmonyEngine } from '../composing/HarmonyCore';
import { generateHarmonyViaPipeline } from '../harmony/HarmonyPipeline';
import { CadentialBridge, Stage2Output, Stage3Output } from './types';
import { injectCadentialBridges } from './CadentialBridger';

export function generateHarmony(stage2: Stage2Output): Stage3Output {
    const { style, sections, tonality, timeSignature, styleId } = stage2;

    const useViterbi = style.useViterbiHarmony === true;
    const baseChords = useViterbi
        ? generateHarmonyViaPipeline(sections, tonality, timeSignature)
        : HarmonyEngine.generateHarmonyTimeline(sections, style, timeSignature);

    const { chords, bridges } = injectCadentialBridges(baseChords, sections, styleId, tonality);

    return {
        ...stage2,
        chords,
        cadentialBridges: bridges,
    };
}
