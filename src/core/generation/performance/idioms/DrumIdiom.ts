import { PRNGManager } from '../../../utils/PRNG';
import { NoteData, GeneratedChord, RuntimeIdiomPreferences } from '../../types';
import { InstrumentId } from '../../config/InstrumentFlags';
import { BaseIdiom } from './BaseIdiom';

export class DrumIdiom extends BaseIdiom {
    public apply(notes: NoteData[], instrumentId: InstrumentId, chords: GeneratedChord[], idiomPreferences?: RuntimeIdiomPreferences): NoteData[] {
        const drumStyle = idiomPreferences?.drumStyle || 'pop';
        const result: NoteData[] = [];
        if (notes.length === 0) return result;

        const KICK = 36, SNARE = 38, CHH = 42, OHH = 46;
        // safe: timeSignature is [number,number] injected by Orchestrator via idiomPrefsWithSections
        const beatsPerBar = idiomPreferences?.timeSignature?.[0] ?? 4;
        
        // 1. 收集现有的音符位置，避免在已有音符的位置添加幽灵音
        // P-1 合规：排序数组 + includes() 替代 Set<number>
        const existingOnsets: number[] = [];
        for (const n of notes) {
            if (!existingOnsets.includes(n.onset)) {
                existingOnsets.push(n.onset);
            }
        }

        // 2. 注入幽灵音 (Ghost Notes)
        // 幽灵音通常在军鼓上，位于 16 分音符的弱拍
        let ghostNoteProb = 0.1;
        if (drumStyle === 'funk' || drumStyle === 'lofi') ghostNoteProb = 0.4;
        else if (drumStyle === 'rock') ghostNoteProb = 0.2;

        const lastNoteOnset = Math.max(...notes.map(n => n.onset));
        
        for (let beat = 0; beat <= lastNoteOnset; beat += 0.25) {
            const beatPos = beat % beatsPerBar;
            
            // 避开正拍和 8 分音符反拍 (0, 0.5, 1.0...)，只在 16 分音符弱拍 (0.25, 0.75) 尝试添加
            if (Math.abs(beatPos % 0.5) >= 1e-6) {
                if (!existingOnsets.includes(beat) && PRNGManager.next() < ghostNoteProb) {
                    // 添加幽灵音
                    result.push({
                        pitch: SNARE,
                        onset: beat,
                        duration: 0.1,
                        velocity: 0.3 + PRNGManager.next() * 0.15 // 极低的力度 30-45
                    });
                }
            }
        }

        // 3. 踩镲开闭逻辑 (Open/Closed Hi-hat)
        // 在某些风格中，反拍的踩镲会变成开镲 (Open Hi-hat)
        let openHihatProb = 0.05;
        if (drumStyle === 'house' || drumStyle === 'electronic') openHihatProb = 0.6; // 动次打次，反拍开镲
        else if (drumStyle === 'funk') openHihatProb = 0.2;

        notes.forEach(note => {
            let current = { ...note };
            const beatPos = current.onset % beatsPerBar;

            if (current.pitch === CHH) {
                // 如果在反拍 (0.5)，有概率变成开镲
                if (Math.abs(beatPos % 1 - 0.5) < 1e-6 && PRNGManager.next() < openHihatProb) {
                    current.pitch = OHH;
                    current.velocity = Math.min(1.0, current.velocity * 1.2); // 开镲更响
                    current.duration = 0.4; // 开镲延音长一点
                }
            }
            
            result.push(current);
        });

        // 按时间排序
        result.sort((a, b) => a.onset - b.onset);

        return result;
    }

    public humanize(notes: NoteData[], swingRatio: number, swingSubdivision: number, isRightHand: boolean = false, idiomPreferences?: RuntimeIdiomPreferences): NoteData[] {
        const result: NoteData[] = [];
        const KICK = 36, SNARE = 38, CHH = 42, OHH = 46, TOM_HI = 50, TOM_MID = 47, TOM_LOW = 43;
        const CRASH = 49, RIDE = 51, CHINA = 52, RIDE_BELL = 53, SPLASH = 55, CRASH2 = 57;

        notes.forEach(note => {
            let newNote = { ...note };

            // 1. 摇摆节奏 (Swing)
            const { swingDelay, newDuration } = this.applySwing(newNote.onset, newNote.duration, swingRatio, swingSubdivision);
            newNote.onset += swingDelay;
            newNote.duration = newDuration;

            // 2. 微小时值偏移 (Humanized Timing)
            let timingOffset = 0;
            const drumStyle = idiomPreferences?.drumStyle || 'pop';
            
            if (drumStyle === 'lofi') {
                // Dilla Groove: 军鼓拖拽，踩镲随机，底鼓准时
                if (newNote.pitch === SNARE) {
                    timingOffset = 0.05; // 军鼓强制延迟约 15-30ms (以 120BPM 为例，一拍 500ms，0.05 拍 = 25ms)
                } else if (newNote.pitch === CHH || newNote.pitch === OHH) {
                    timingOffset = (PRNGManager.next() - 0.5) * 0.06; // 踩镲随机偏移
                }
            }
            newNote.onset += timingOffset;

            // 3. 真实力度起伏 (Humanized Velocity)
            let velFluctuation = (PRNGManager.next() - 0.5) * 0.1; // 默认 +/- 0.05 的微小起伏
            
            // 针对踩镲和 Ride 的左右手发力逻辑 (Hi-hat/Ride Right/Left hand simulation)
            if (newNote.pitch === CHH || newNote.pitch === RIDE || newNote.pitch === OHH) {
                // 假设正拍 (0, 0.5) 是右手，反拍 (0.25, 0.75) 是左手
                const beatFraction = (note.onset) % 0.5; // 使用原始 onset 判断
                const isRightHand = beatFraction < 0.1 || beatFraction > 0.4; 
                
                if (!isRightHand) {
                    // 左手打的次重音/幽灵音力度更轻 (模拟真实发力)
                    newNote.velocity *= 0.7; 
                }
                
                if (drumStyle === 'lofi') {
                    // Lo-Fi 踩镲力度极端随机化 (大幅波动)
                    velFluctuation = (PRNGManager.next() - 0.5) * 0.5;
                } else {
                    // 踩镲/Ride的力度起伏可以稍微大一点，模拟手腕的自然抖动
                    velFluctuation = (PRNGManager.next() - 0.5) * 0.15; 
                }
            } else if (newNote.pitch === SNARE || newNote.pitch === KICK || newNote.pitch === TOM_HI || newNote.pitch === TOM_MID || newNote.pitch === TOM_LOW) {
                // 区分主重音和幽灵音
                if (newNote.velocity < 0.5) {
                    // 幽灵音 (Ghost Notes)：加入微小随机起伏，模拟轻触鼓面的细腻感
                    velFluctuation = (PRNGManager.next() - 0.5) * 0.15;
                } else {
                    // 主重音：力度控制在 0.75-0.9 之间浮动 (如果原本 velocity 很高的话)
                    if (newNote.velocity >= 0.7) {
                        velFluctuation = (PRNGManager.next() - 0.5) * 0.1;
                        newNote.velocity = Math.max(0.75, Math.min(0.9, newNote.velocity + velFluctuation));
                        velFluctuation = 0; // 已经处理过了
                    }
                }
            } else if (newNote.pitch === CRASH || newNote.pitch === CRASH2 || newNote.pitch === CHINA || newNote.pitch === SPLASH) {
                // 镲片重击力度起伏
                velFluctuation = (PRNGManager.next() - 0.5) * 0.1;
            }

            newNote.velocity = Math.max(0.1, Math.min(1.0, newNote.velocity + velFluctuation));
            
            // 确保 onset 不为负数
            newNote.onset = Math.max(0, newNote.onset);
            // 4. Flams and Drags (Rudiments)
            // Only apply to Snare and Toms, and only if velocity is high enough
            if ((newNote.pitch === SNARE || newNote.pitch === TOM_HI || newNote.pitch === TOM_MID || newNote.pitch === TOM_LOW) && newNote.velocity > 0.7) {
                const rand = PRNGManager.next();
                if (rand < 0.05) {
                    // Flam: One grace note 30ms before
                    result.push({
                        ...newNote,
                        onset: Math.max(0, newNote.onset - 0.03),
                        velocity: newNote.velocity * 0.5,
                        duration: 0.05
                    });
                } else if (rand < 0.08) {
                    // Drag: Two grace notes 60ms and 30ms before
                    result.push({
                        ...newNote,
                        onset: Math.max(0, newNote.onset - 0.06),
                        velocity: newNote.velocity * 0.4,
                        duration: 0.05
                    });
                    result.push({
                        ...newNote,
                        onset: Math.max(0, newNote.onset - 0.03),
                        velocity: newNote.velocity * 0.5,
                        duration: 0.05
                    });
                }
            }

            result.push(newNote);
        });

        return result;
    }

    protected getHumanizeParams(note: NoteData, index: number, chordSize: number, isHighFirst: boolean, isRightHand: boolean, idiomPreferences?: RuntimeIdiomPreferences) {
        // 鼓不需要通用的和弦处理参数
        return { strumDelay: 0, timingWobble: 0, velocityWobble: 0, velocityMultiplier: 1.0 };
    }
}
