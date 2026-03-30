import { StyleConfig } from '../../types';
import { RussianFolkBalladStyle } from './RussianFolkBallad';
import { ModernPopStyle } from './ModernPop';
import { PowerBalladStyle } from './PowerBallad';
import { PopRockStyle } from './PopRock';
import { GhibliOrchestralStyle } from './GhibliOrchestral';

export const StyleRegistry: Record<string, StyleConfig> = {
    [ModernPopStyle.id]: ModernPopStyle,
    [PowerBalladStyle.id]: PowerBalladStyle,
    [PopRockStyle.id]: PopRockStyle,
    [RussianFolkBalladStyle.id]: RussianFolkBalladStyle,
    [GhibliOrchestralStyle.id]: GhibliOrchestralStyle,
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