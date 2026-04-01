import { StyleConfig } from '../../types';
import { StyleId } from '../StyleFlags';
import { ModernPopStyle, ClassicJPopStyle, ModernJPopStyle } from './PopStyles';
import { PopRockStyle } from './RockStyles';
import { EurodanceStyle, TranceStyle, SynthwaveStyle } from './ElectronicStyles';
import { PowerBalladStyle, RussianFolkBalladStyle } from './BalladStyles';
import { GhibliOrchestralStyle } from './CinematicStyles';
import { LofiHipHopStyle } from './LofiStyles';

export const StyleRegistry: Record<StyleId, StyleConfig> = {
    [StyleId.ModernPop]: ModernPopStyle,
    [StyleId.ClassicJPop]: ClassicJPopStyle,
    [StyleId.ModernJPop]: ModernJPopStyle,
    [StyleId.PopRock]: PopRockStyle,
    [StyleId.Eurodance]: EurodanceStyle,
    [StyleId.Trance]: TranceStyle,
    [StyleId.Synthwave]: SynthwaveStyle,
    [StyleId.PowerBallad]: PowerBalladStyle,
    [StyleId.RussianFolkBallad]: RussianFolkBalladStyle,
    [StyleId.GhibliOrchestral]: GhibliOrchestralStyle,
    [StyleId.Lofi]: LofiHipHopStyle,
};

export const getAllAvailableStyles = () => {
    return Object.values(StyleRegistry).map(style => ({
        id: style.id,
        name: style.name
    }));
};

export const getStyleConfig = (id: StyleId): StyleConfig => {
    const style = StyleRegistry[id];
    if (!style) throw new Error(`Style with ID ${id} not found.`);
    return style;
};
