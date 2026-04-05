import { PRNGManager } from '../../utils/PRNG';
import { EnsembleDraft, StyleConfig } from '../types';
import { StyleId } from '../config/StyleFlags';

export class EnsembleDrafter {
    public static draft(style: StyleConfig): EnsembleDraft {
        // 1. 决定核心乐器
        // 🌟 按照用户标准选择音色
        const melodyPool = [
            { id: 'Acoustic_Grand', tags: ['all'] },
            { id: 'Electric_Piano_1', tags: ['lofi', 'pop', 'chill', 'jazz', 'rnb'] },
            { id: 'Lead_2_Sawtooth', tags: ['house', 'edm', 'pop', 'synthwave', 'electronic'] },
            { id: 'Violin', tags: ['cinematic', 'ghibli', 'post_rock', 'ballad', 'acoustic'] },
            { id: 'Flute', tags: ['cinematic', 'ghibli', 'acoustic', 'folk', 'chill'] },
            { id: 'Alto_Sax', tags: ['jazz', 'funk', 'rnb', 'pop', 'retro'] }
        ];

        const chordPool = [
            { id: 'Acoustic_Grand', tags: ['all'] },
            { id: 'Acoustic_Guitar_Steel', tags: ['folk', 'pop', 'acoustic', 'country'] },
            { id: 'Electric_Guitar_Clean', tags: ['pop', 'rock', 'indie', 'funk'] },
            { id: 'String_Ensemble_1', tags: ['cinematic', 'ballad', 'post_rock', 'ghibli'] },
            { id: 'Synth_Strings_1', tags: ['pop', 'edm', 'house', 'electronic', 'synthwave'] }
        ];

        const padPool = [
            { id: 'Pad_1_NewAge', tags: ['cinematic', 'ghibli', 'post_rock', 'chill', 'acoustic'] },
            { id: 'Pad_2_Warm', tags: ['pop', 'dark_pop', 'electronic', 'lofi', 'rnb'] },
            { id: 'Choir_Aahs', tags: ['cinematic', 'ghibli', 'post_rock', 'ballad'] },
            { id: 'Voice_Oohs', tags: ['pop', 'rnb', 'chill', 'acoustic', 'ballad'] },
            // 弦乐独奏/合奏 — 用作 counterMelody 铺底或旋律对话
            { id: 'Violin', tags: ['cinematic', 'ghibli', 'post_rock', 'ballad', 'acoustic'] },
            { id: 'Cello', tags: ['cinematic', 'ghibli', 'post_rock', 'ballad', 'acoustic'] },
            { id: 'String_Ensemble_1', tags: ['cinematic', 'ghibli', 'ballad', 'pop'] },
            { id: 'Contrabass', tags: ['jazz', 'cinematic', 'acoustic'] },
            { id: 'Viola', tags: ['cinematic', 'ghibli', 'acoustic'] }
        ];

        const styleName = StyleId[style.id] || "";
        const styleTags = styleName.toLowerCase().split('_');
        
        const getInstrumentFromPool = (pool: any[]) => {
            const matches = pool.filter(item => 
                item.tags.includes('all') || item.tags.some((tag: string) => styleTags.some(st => st.includes(tag) || tag.includes(st)))
            );
            const selectedPool = matches.length > 0 ? matches : pool;
            return selectedPool[Math.floor(PRNGManager.next() * selectedPool.length)].id;
        };

        let melodySound = getInstrumentFromPool(melodyPool);
        let vocalSound: string | undefined = undefined;
        
        const vocalProb = style.orchestration?.vocalProbability ?? 0.5;
        if (PRNGManager.next() < vocalProb) {
            vocalSound = PRNGManager.next() < 0.5 ? 'Flute' : 'Electric_Piano_1';
        }

        let secondaryMelodySound: string | null = null;
        
        // 只有 30% 的概率出现双主奏交替 (Duet)
        if (PRNGManager.next() < 0.3) {
            let attempts = 0;
            do {
                secondaryMelodySound = getInstrumentFromPool(melodyPool);
                attempts++;
            } while (secondaryMelodySound === melodySound && attempts < 5);
            if (secondaryMelodySound === melodySound) secondaryMelodySound = null;
        }
        
        let chordSound: string | null = getInstrumentFromPool(chordPool);
        
        // 2. 决定乐队编制 (Ensemble Template)
        // 🌟 Luis 的工程加码：由 Style 约束的“空缺率” (Null Slot)
        const allowDrumless = style.orchestration?.allowDrumless ?? false;
        const allowBassless = style.orchestration?.allowBassless ?? false;

        let bassSound: string | null = 'Electric_Bass_Finger';
        if (allowBassless && PRNGManager.next() < 0.2) {
            bassSound = null;
        } else if (style.orchestration?.bassInstruments && style.orchestration.bassInstruments.length > 0) {
            bassSound = style.orchestration.bassInstruments[Math.floor(PRNGManager.next() * style.orchestration.bassInstruments.length)];
        }

        let drumSound: string | null = 'Standard_DrumKit';
        if (allowDrumless && PRNGManager.next() < 0.2) {
            drumSound = null;
        } else if (style.orchestration?.drumInstruments && style.orchestration.drumInstruments.length > 0) {
            drumSound = style.orchestration.drumInstruments[Math.floor(PRNGManager.next() * style.orchestration.drumInstruments.length)];
        }

        let counterMelodySound: string | null = null;
        const counterMelodyStyle = 'sustained';

        // 🌟 决定副旋律 / 铺底 (Counter Melody / Pad)
        if (PRNGManager.next() < 0.6) {
            counterMelodySound = getInstrumentFromPool(padPool);
        }

        // 3. 结合曲风的配置进行覆盖或限制
        if (style.orchestration.bassInstruments && style.orchestration.bassInstruments.length > 0) {
            // 如果曲风指定了贝斯库，即使前面随机到了 null，也有可能被覆盖（这里我们尊重前面的 null，除非强制需要）
            if (bassSound) {
                bassSound = style.orchestration.bassInstruments[Math.floor(PRNGManager.next() * style.orchestration.bassInstruments.length)];
            }
        }

        const counterProb = style.orchestration.counterMelodyProbability !== undefined ? style.orchestration.counterMelodyProbability : (counterMelodySound ? 1.0 : 0.0);
        if (PRNGManager.next() < counterProb || melodySound === 'Solo_Vox') {
            if (!counterMelodySound) {
                counterMelodySound = getInstrumentFromPool(padPool);
            }
        } else {
            counterMelodySound = null;
        }

        // 结合曲风的 drumProbability 进一步限制
        const drumProb = style.orchestration.drumProbability !== undefined ? style.orchestration.drumProbability : 1.0;
        if (PRNGManager.next() > drumProb) {
            drumSound = null;
        } else if (!drumSound) {
            // 如果通过了概率测试但之前没分配鼓组，则分配默认鼓组
            drumSound = 'Standard_DrumKit';
        }

        if (style.orchestration.drumInstruments && style.orchestration.drumInstruments.length > 0 && drumSound) {
            drumSound = style.orchestration.drumInstruments[Math.floor(PRNGManager.next() * style.orchestration.drumInstruments.length)];
        }

        // 🌟 钢琴主奏的特殊绑定 (Piano Lead Binding)
        // 用户反馈：如果主奏是钢琴，单音旋律会显得呆板。
        // 解决方案：强制将伴奏和弦乐器也设置为同款钢琴，使其听起来像是一个完整的钢琴独奏/弹唱，增加配合和流动感。
        const isPianoLead = melodySound.includes('Grand') || melodySound.includes('Piano') || melodySound.includes('EP') || melodySound.includes('Keys');
        if (isPianoLead) {
            chordSound = melodySound;
        }

        return {
            vocalSound,
            melodySound,
            secondaryMelodySound,
            chordSound,
            bassSound,
            drumSound,
            counterMelodySound
        };
    }
}
