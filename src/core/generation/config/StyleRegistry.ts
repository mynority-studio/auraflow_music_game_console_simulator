import { StyleConfig } from '../types';
import { StyleId, DefaultStyleConfig, PowerBalladStyleConfig, RussianFolkBalladStyleConfig } from './StyleFlags';

export const StyleRegistry: Record<StyleId, StyleConfig> = {
    [StyleId.Default]: DefaultStyleConfig,
    [StyleId.PowerBallad]: PowerBalladStyleConfig,
    [StyleId.RussianFolkBallad]: RussianFolkBalladStyleConfig
};
