import { PRNGManager } from '../../utils/PRNG';
import { EnsembleDraft, GenerationParams } from '../types';
import { InstrumentId, isPianoFamily } from '../config/InstrumentFlags';

export class EnsembleDrafter {
    public static draft(params: GenerationParams): EnsembleDraft {
        // 1. 决定核心乐器
        const melodyPool = [
            { id: InstrumentId.Acoustic_Grand, tags: ['all'] },
            { id: InstrumentId.Electric_Piano_1, tags: ['lofi', 'pop', 'chill', 'jazz', 'rnb'] },
            { id: InstrumentId.Lead_2_Sawtooth, tags: ['house', 'edm', 'pop', 'synthwave', 'electronic'] },
            { id: InstrumentId.Violin, tags: ['cinematic', 'ghibli', 'post_rock', 'ballad', 'acoustic'] },
            { id: InstrumentId.Flute, tags: ['cinematic', 'ghibli', 'acoustic', 'folk', 'chill'] },
            { id: InstrumentId.Alto_Sax, tags: ['jazz', 'funk', 'rnb', 'pop', 'retro'] }
        ];

        const chordPool = [
            { id: InstrumentId.Acoustic_Grand, tags: ['all'] },
            { id: InstrumentId.Acoustic_Guitar_Steel, tags: ['folk', 'pop', 'acoustic', 'country'] },
            { id: InstrumentId.Electric_Guitar_Clean, tags: ['pop', 'rock', 'indie', 'funk'] },
            { id: InstrumentId.String_Ensemble, tags: ['cinematic', 'ballad', 'post_rock', 'ghibli'] },
            { id: InstrumentId.Synth_Strings_1, tags: ['pop', 'edm', 'house', 'electronic', 'synthwave'] }
        ];

        const padPool = [
            { id: InstrumentId.Pad_1_NewAge, tags: ['cinematic', 'ghibli', 'post_rock', 'chill', 'acoustic'] },
            { id: InstrumentId.Pad_2_Warm, tags: ['pop', 'dark_pop', 'electronic', 'lofi', 'rnb'] },
            { id: InstrumentId.Choir_Aahs, tags: ['cinematic', 'ghibli', 'post_rock', 'ballad'] },
            { id: InstrumentId.Voice_Oohs, tags: ['pop', 'rnb', 'chill', 'acoustic', 'ballad'] }
        ];

        // Simple random picker from full pool (style tag matching removed)
        const pick = (pool: {id: InstrumentId; tags: string[]}[]) => pool[Math.floor(PRNGManager.next() * pool.length)].id;

        let melodySound = pick(melodyPool);

        let secondaryMelodySound: InstrumentId | undefined = undefined;

        // 只有 30% 的概率出现双主奏交替 (Duet)
        if (PRNGManager.next() < 0.3) {
            let attempts = 0;
            let candidate = pick(melodyPool);
            while (candidate === melodySound && attempts < 5) {
                candidate = pick(melodyPool);
                attempts++;
            }
            if (candidate !== melodySound) secondaryMelodySound = candidate;
        }

        let chordSound: InstrumentId | null = pick(chordPool);

        // 2. 决定乐队编制 (Ensemble Template)
        const rand = PRNGManager.next();
        let bassSound: InstrumentId | null = InstrumentId.Electric_Bass_Finger;
        let drumSound: InstrumentId | null = InstrumentId.Standard_DrumKit;
        let counterMelodySound: InstrumentId | null = null;

        if (rand < 0.10) {
            // Acoustic Duo
            bassSound = null;
            drumSound = null;
        } else if (rand < 0.20) {
            // Jazz Trio
            bassSound = InstrumentId.Acoustic_Bass;
            drumSound = null;
        } else if (rand < 0.40) {
            // Rhythmic
            bassSound = InstrumentId.Electric_Bass_Finger;
            drumSound = InstrumentId.Standard_DrumKit;
        } else {
            // Full Band
            bassSound = InstrumentId.Electric_Bass_Finger;
            drumSound = InstrumentId.Standard_DrumKit;
            if (PRNGManager.next() < 0.4) {
                counterMelodySound = pick(padPool);
            }
        }

        // 3. 结合配置进行覆盖或限制
        if (params.orchestration.bassInstruments && params.orchestration.bassInstruments.length > 0) {
            if (bassSound !== null) {
                bassSound = params.orchestration.bassInstruments[Math.floor(PRNGManager.next() * params.orchestration.bassInstruments.length)];
            }
        }

        const counterProb = params.orchestration.counterMelodyProbability !== undefined ? params.orchestration.counterMelodyProbability : (counterMelodySound !== null ? 1.0 : 0.0);
        if (PRNGManager.next() < counterProb || melodySound === InstrumentId.Solo_Vox) {
            if (counterMelodySound === null) {
                counterMelodySound = pick(padPool);
            }
        } else {
            counterMelodySound = null;
        }

        // 结合配置的 drumProbability 进一步限制
        const drumProb = params.orchestration.drumProbability !== undefined ? params.orchestration.drumProbability : 1.0;
        if (PRNGManager.next() > drumProb) {
            drumSound = null;
        } else if (drumSound === null) {
            drumSound = InstrumentId.Standard_DrumKit;
        }

        if (params.orchestration.drumInstruments && params.orchestration.drumInstruments.length > 0 && drumSound !== null) {
            drumSound = params.orchestration.drumInstruments[Math.floor(PRNGManager.next() * params.orchestration.drumInstruments.length)];
        }

        // T-1 合规：使用 InstrumentFamily 枚举替换字符串子串匹配 (.includes('Grand') 等)
        if (isPianoFamily(melodySound)) {
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
