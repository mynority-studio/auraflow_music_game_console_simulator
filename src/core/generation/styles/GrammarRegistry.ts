import { StyleGrammar } from './StyleGrammar';
import { PopGrammar } from './PopGrammar';
import { RnBGrammar } from './RnBGrammar';
import { EDMGrammar } from './EDMGrammar';
import { RockGrammar } from './RockGrammar';
import { JazzGrammar } from './JazzGrammar';
import { FolkGrammar } from './FolkGrammar';
import { StyleId } from '../config/StyleFlags';
import { StyleRegistry } from '../config/styles/StyleRegistry';

export function getStyleGrammar(styleId: StyleId): StyleGrammar {
    const style = StyleRegistry[styleId];
    const stringStyle = style?.orchestration?.idiomPreferences?.stringStyle || 'pop';
    
    if (stringStyle === 'neosoul' || stringStyle === 'jazz' || stringStyle === 'bossa') {
        return JazzGrammar;
    }
    
    if (stringStyle === 'electronic' || stringStyle === 'edm' || stringStyle === 'eurodance' || stringStyle === 'synthwave' || stringStyle === 'trance') {
        return EDMGrammar;
    }
    
    if (stringStyle === 'rock') {
        return RockGrammar;
    }
    
    if (stringStyle === 'folk' || stringStyle === 'reggae') {
        return FolkGrammar;
    }
    
    if (stringStyle === 'funk') {
        return RnBGrammar;
    }
    
    // 默认回退到 PopGrammar
    return PopGrammar;
}
