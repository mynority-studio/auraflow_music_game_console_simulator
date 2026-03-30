import { StyleConfig } from '../../types';
import { ModernPopStyle, ClassicJPopStyle, ModernJPopStyle, DarkPopStyle } from './PopStyles';
import { PopRockStyle, IndieRockStyle, PostRockStyle } from './RockStyles';
import { LofiHipHopStyle, ProgressiveHouseStyle, SynthwaveStyle } from './ElectronicStyles';
import { PowerBalladStyle, RussianFolkBalladStyle } from './BalladStyles';
import { GhibliOrchestralStyle } from './CinematicStyles';
import { NeoSoulStyle } from './RnBStyles';

export const StyleRegistry: Record<string, StyleConfig> = {
    [ModernPopStyle.id]: ModernPopStyle,
    [ClassicJPopStyle.id]: ClassicJPopStyle,
    [ModernJPopStyle.id]: ModernJPopStyle,
    [DarkPopStyle.id]: DarkPopStyle,
    [PopRockStyle.id]: PopRockStyle,
    [IndieRockStyle.id]: IndieRockStyle,
    [PostRockStyle.id]: PostRockStyle,
    [LofiHipHopStyle.id]: LofiHipHopStyle,
    [ProgressiveHouseStyle.id]: ProgressiveHouseStyle,
    [SynthwaveStyle.id]: SynthwaveStyle,
    [PowerBalladStyle.id]: PowerBalladStyle,
    [RussianFolkBalladStyle.id]: RussianFolkBalladStyle,
    [GhibliOrchestralStyle.id]: GhibliOrchestralStyle,
    [NeoSoulStyle.id]: NeoSoulStyle,
};

export const getAllAvailableStyles = () => {
    return Object.values(StyleRegistry).map(style => ({
        id: style.id,
        name: style.name
    }));
};

export const getStyleConfig = (id: string): StyleConfig => {
    const style = StyleRegistry[id];
    if (!style) throw new Error(`Style with ID ${id} not found.`);
    return style;
};
