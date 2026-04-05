import { StyleConfig } from '../types';
import { StyleId, DefaultStyleConfig } from './StyleFlags';

export const StyleRegistry: Record<StyleId, StyleConfig> = {
    [StyleId.Default]: DefaultStyleConfig
};
