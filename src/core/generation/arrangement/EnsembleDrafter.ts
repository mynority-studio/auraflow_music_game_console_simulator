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
            { id: 'Voice_Oohs', tags: ['pop', 'rnb', 'chill', 'acoustic', 'ballad'] }
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
        
        // 🌟 全局强制取消掉vocal (Marimba)
        // if (PRNGManager.next() < 0.8) {
        //     melodySound = 'Marimba';
        // }

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
        // 任何风格都可以有不同的编制，让编曲更丰富
        const rand = PRNGManager.next();
        let bassSound: string | null = 'Electric_Bass_Finger';
        let drumSound: string | null = 'Standard_DrumKit';
        let counterMelodySound: string | null = null;

        const stringStyle = style.orchestration?.idiomPreferences?.stringStyle || 'pop';
        const isJazz = stringStyle === 'jazz';
        const isCinematic = stringStyle === 'cinematic';

        if (rand < 0.10 && !isCinematic) {
            // 🌟 Acoustic Duo (原声双重奏): 只有主奏 + 钢琴/吉他伴奏，无鼓无贝斯 (降低出现概率)
            bassSound = null;
            drumSound = null;
        } else if (rand < 0.20 && isJazz) {
            // 🌟 Jazz Trio (爵士三重奏): 主奏 + 钢琴 + 低音提琴，无鼓 (仅限Jazz风格)
            bassSound = 'Acoustic_Bass';
            drumSound = null;
        } else if (rand < 0.30 && isCinematic) {
            // 🌟 Chamber/Orchestral (室内乐/管弦): 弦乐主导，无鼓 (仅限Cinematic风格)
            chordSound = 'String_Ensemble_1';
            bassSound = 'Acoustic_Bass';
            drumSound = null;
            counterMelodySound = getInstrumentFromPool(padPool);
        } else if (rand < 0.40 && !isCinematic && !isJazz) {
            // 🌟 Rhythmic (律动型): 只有贝斯和鼓，无和弦乐器 (留白极多，降低概率，避免太干)
            // 修复：对于抒情歌等风格，不能完全没有和弦乐器，否则会变成只有贝斯和弦乐的空洞编曲
            const isAcousticBallad = stringStyle === 'ballad' || stringStyle === 'folk';
            if (!isAcousticBallad) {
                chordSound = null;
            }
            bassSound = 'Electric_Bass_Finger';
            drumSound = 'Standard_DrumKit';
        } else {
            // 🌟 Full Band (全乐队): 标准配置 (提高出现概率，保证整体性)
            bassSound = isJazz ? 'Acoustic_Bass' : 'Electric_Bass_Finger';
            
            drumSound = 'Standard_DrumKit';
            if (PRNGManager.next() < 0.4) {
                counterMelodySound = getInstrumentFromPool(padPool);
            }
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
            melodySound,
            secondaryMelodySound,
            chordSound,
            bassSound,
            drumSound,
            counterMelodySound
        };
    }
}
