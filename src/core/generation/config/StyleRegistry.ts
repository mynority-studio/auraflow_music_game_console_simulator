import { StyleConfig } from '../types';
import { StyleId, DefaultStyleConfig, DarkSynthPopStyleConfig } from './StyleFlags';

export const StyleRegistry: Record<StyleId, StyleConfig> = {
    [StyleId.Default]: DefaultStyleConfig,
    [StyleId.DarkSynthPop]: DarkSynthPopStyleConfig
};
