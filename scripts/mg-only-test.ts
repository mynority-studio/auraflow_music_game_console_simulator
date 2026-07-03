// Test: only import mg's musicEngine + check STYLE_DICTIONARY via separate import
import {
    Engine as MgEngine,
    Random as MgRandom,
} from '../../melodygenerative/src/lib/musicEngine';

import { STYLE_DICTIONARY } from '../../melodygenerative/src/lib/styleDictionary';

console.log('mg STYLE_DICTIONARY keys:', Object.keys(STYLE_DICTIONARY));
console.log('STYLE_DICTIONARY.POP existence:', !!STYLE_DICTIONARY.POP);
console.log('STYLE_DICTIONARY.POP.fillScales existence:', !!STYLE_DICTIONARY.POP?.fillScales);
console.log('---');

const cfg: any = { seed: '42::harmony', style: 'POP', key: 'C', mode: 'Major', emotion: 'auto' };
const eng = new MgEngine(new MgRandom(cfg.seed));
const chords = eng.generateProgressions(cfg);
console.log('chords:', chords.length);
const events = eng.generateArrangement(chords, cfg).events;
console.log('events:', events.length);
