import { StyleConfig, GenerationError } from '../../types';
import { StyleId } from '../StyleFlags';
import { ModernPopStyle, ClassicJPopStyle, ModernJPopStyle } from './PopStyles';
import { PopRockStyle } from './RockStyles';
import { EurodanceStyle, TranceStyle, SynthwaveStyle } from './ElectronicStyles';
import { PowerBalladStyle, RussianFolkBalladStyle } from './BalladStyles';
import { GhibliOrchestralStyle } from './CinematicStyles';
import { LofiHipHopStyle } from './LofiStyles';

/** 数组直接寻址表：index = StyleId 数值，空洞为 undefined */
const STYLE_TABLE_SIZE = 17; // max(StyleId) + 1 = 16 + 1
export const StyleRegistry: (StyleConfig | undefined)[] = new Array(STYLE_TABLE_SIZE);
StyleRegistry[StyleId.ModernPop] = ModernPopStyle;
StyleRegistry[StyleId.ClassicJPop] = ClassicJPopStyle;
StyleRegistry[StyleId.ModernJPop] = ModernJPopStyle;
StyleRegistry[StyleId.PopRock] = PopRockStyle;
StyleRegistry[StyleId.Eurodance] = EurodanceStyle;
StyleRegistry[StyleId.Trance] = TranceStyle;
StyleRegistry[StyleId.Synthwave] = SynthwaveStyle;
StyleRegistry[StyleId.PowerBallad] = PowerBalladStyle;
StyleRegistry[StyleId.RussianFolkBallad] = RussianFolkBalladStyle;
StyleRegistry[StyleId.GhibliOrchestral] = GhibliOrchestralStyle;
StyleRegistry[StyleId.Lofi] = LofiHipHopStyle;

export const getAllAvailableStyles = () => {
    const result: { id: StyleId; name: string }[] = [];
    for (let i = 0; i < StyleRegistry.length; i++) {
        const style = StyleRegistry[i];
        if (style) result.push({ id: style.id, name: style.name });
    }
    return result;
};

export const getStyleConfig = (id: StyleId): StyleConfig => {
    const style = StyleRegistry[id];
    if (!style) throw new GenerationError(`Style with ID ${id} not found.`, { styleId: id });
    return style;
};
