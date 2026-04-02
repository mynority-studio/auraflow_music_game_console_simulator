import { StyleConfig } from '../../types';
import { StyleId } from '../StyleFlags';
import { ModernPopStyle, ClassicJPopStyle, ModernJPopStyle } from './PopStyles';
import { PopRockStyle } from './RockStyles';
import { EurodanceStyle, TranceStyle, SynthwaveStyle } from './ElectronicStyles';
import { PowerBalladStyle, RussianFolkBalladStyle } from './BalladStyles';
import { GhibliOrchestralStyle } from './CinematicStyles';
import { LofiHipHopStyle } from './LofiStyles';
import { DarkPopStyle } from './DarkPop';
import { IndieRockStyle } from './IndieRock';
import { PostRockStyle } from './PostRock';
import { ProgressiveHouseStyle } from './ProgressiveHouse';
import { LofiHipHopStyle as LofiHipHopStandaloneStyle } from './LofiHipHop';
import { NeoSoulStyle } from './RnBStyles';

// Note: Not all StyleId values have configs (e.g. SmoothJazz, BossaNova are used
// only for conditional logic in StructureEngine/Orchestrator). Use getStyleConfig()
// which throws on missing entries.
export const StyleRegistry: Record<number, StyleConfig> = {
    [StyleId.ModernPop]: ModernPopStyle,
    [StyleId.ClassicJPop]: ClassicJPopStyle,
    [StyleId.ModernJPop]: ModernJPopStyle,
    [StyleId.DarkPop]: DarkPopStyle,
    [StyleId.PopRock]: PopRockStyle,
    [StyleId.IndieRock]: IndieRockStyle,
    [StyleId.PostRock]: PostRockStyle,
    [StyleId.Eurodance]: EurodanceStyle,
    [StyleId.Trance]: TranceStyle,
    [StyleId.Synthwave]: SynthwaveStyle,
    [StyleId.PowerBallad]: PowerBalladStyle,
    [StyleId.RussianFolkBallad]: RussianFolkBalladStyle,
    [StyleId.GhibliOrchestral]: GhibliOrchestralStyle,
    [StyleId.ProgressiveHouse]: ProgressiveHouseStyle,
    [StyleId.LofiHipHop]: LofiHipHopStandaloneStyle,
    [StyleId.NeoSoul]: NeoSoulStyle,
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
