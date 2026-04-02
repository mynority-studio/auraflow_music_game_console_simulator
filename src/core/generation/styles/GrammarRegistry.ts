import { StyleGrammar } from './StyleGrammar';
import { PopGrammar } from './PopGrammar';
import { RnBGrammar } from './RnBGrammar';
import { EDMGrammar } from './EDMGrammar';
import { RockGrammar } from './RockGrammar';
import { JazzGrammar } from './JazzGrammar';
import { FolkGrammar } from './FolkGrammar';
import { StyleConfig } from '../types';
import { StyleId } from '../config/StyleFlags';

export function getStyleGrammar(style: StyleConfig | null | undefined): StyleGrammar {
    if (!style) return PopGrammar;

    switch (style.id) {
        case StyleId.Eurodance:
        case StyleId.Trance:
        case StyleId.Synthwave:
            return EDMGrammar;
        case StyleId.PopRock:
            return RockGrammar;
        case StyleId.RussianFolkBallad:
            return FolkGrammar;
        // Add more cases as needed
        default:
            return PopGrammar;
    }
}
