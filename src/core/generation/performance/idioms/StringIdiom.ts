import { globalPRNG } from '../../../utils/PRNG';
import { NoteData, GeneratedChord } from '../../types';
import { BaseIdiom } from './BaseIdiom';
import { GlobalContext } from '../../GlobalContext';

export class StringIdiom extends BaseIdiom {
    public apply(notes: NoteData[], instrumentName: string, chords: GeneratedChord[], idiomPreferences?: any): NoteData[] {
        const stringStyle = idiomPreferences?.stringStyle || 'pop';
        
        // 铁律 1: 同一声部，不要写超过 2 个音同时响
        // 我们需要按 onset 分组，保留最高和最低的两个音，或者只保留旋律音
        const groupedByOnset = new Map<number, NoteData[]>();
        for (const note of notes) {
            if (!groupedByOnset.has(note.onset)) {
                groupedByOnset.set(note.onset, []);
            }
            groupedByOnset.get(note.onset)!.push(note);
        }

        let filteredNotes: NoteData[] = [];
        for (const [onset, chordNotes] of groupedByOnset.entries()) {
            // Remove exact duplicates (same pitch at same onset)
            const uniquePitches = new Set<number>();
            const uniqueNotes: NoteData[] = [];
            for (const n of chordNotes) {
                if (!uniquePitches.has(n.pitch)) {
                    uniquePitches.add(n.pitch);
                    uniqueNotes.push(n);
                }
            }
            
            // Sort by pitch descending
            uniqueNotes.sort((a, b) => b.pitch - a.pitch);
            
            // Limit to max 2 notes (double stop)
            if (uniqueNotes.length > 2) {
                filteredNotes.push(uniqueNotes[0]); // Top note
                filteredNotes.push(uniqueNotes[uniqueNotes.length - 1]); // Bottom note
            } else {
                filteredNotes.push(...uniqueNotes);
            }
        }

        // Sort back by onset
        filteredNotes.sort((a, b) => a.onset - b.onset);

        const result: NoteData[] = [];
        let currentNote: NoteData | null = null;
        
        // 铁律 2 & 3: 换弓和弓长限制
        const MAX_BOW_LENGTH = 4.0; // 假设一弓最多拉 4 拍

        for (let i = 0; i < filteredNotes.length; i++) {
            let n = { ...filteredNotes[i] };
            
            // Style-specific filtering
            if (stringStyle === 'pop' || stringStyle === 'folk') {
                // 流行和民谣弦乐通常较舒缓，过滤掉极短的跳音
                if (n.duration < 0.25) continue;
            }

            // 处理长音换弓
            if (n.duration > MAX_BOW_LENGTH) {
                // 将超长音切分为两弓或多弓
                let remainingDuration = n.duration;
                let currentOnset = n.onset;
                while (remainingDuration > 0) {
                    const bowDur = Math.min(remainingDuration, MAX_BOW_LENGTH);
                    result.push({
                        ...n,
                        onset: currentOnset,
                        duration: bowDur * 0.95, // 留出一点换弓间隙
                        velocity: n.velocity * (remainingDuration === n.duration ? 1.0 : 0.8) // 换弓后的音稍微弱一点
                    });
                    currentOnset += bowDur;
                    remainingDuration -= bowDur;
                }
                continue;
            }

            if (currentNote) {
                // 同音高连弓处理 (Legato/Detache)
                if (currentNote.pitch === n.pitch && (n.onset - (currentNote.onset + currentNote.duration)) < 0.1) {
                    if (stringStyle === 'cinematic') {
                        // 电影配乐中同音高可能要求分弓 (Detache)，不合并，但缩短前一个音留出弓距
                        currentNote.duration *= 0.85;
                        result.push(currentNote);
                        currentNote = n;
                    } else {
                        // 流行/爵士中倾向于合并为长音 (连弓)
                        currentNote.duration = (n.onset + n.duration) - currentNote.onset;
                        currentNote.velocity = Math.min(1.0, currentNote.velocity * 1.05); // 弓压增加
                        continue;
                    }
                } else {
                    result.push(currentNote);
                    currentNote = n;
                }
            } else {
                currentNote = n;
            }
        }
        
        if (currentNote) {
            result.push(currentNote);
        }

        // 第二遍处理：应用连奏和力度曲线
        const finalNotes = result.map(n => {
            let overlapDur = n.duration;
            let adjustedVel = n.velocity;

            // 铁律 4: 力度绝对不能平
            // 添加微小的随机波动
            adjustedVel *= (1.0 + (globalPRNG.next() * 0.1 - 0.05));

            if (stringStyle === 'cinematic') {
                // 电影弦乐：长音更长且连绵，短音更短促有力 (Spiccato/Marcato)
                if (n.duration >= 1.0) {
                    overlapDur *= 1.1;
                    adjustedVel = Math.min(1.0, adjustedVel * 1.15);
                } else if (n.duration <= 0.5) {
                    overlapDur *= 0.8; // 更短促
                    adjustedVel = Math.min(1.0, adjustedVel * 1.2); // 更强的音头
                }
            } else if (stringStyle === 'jazz' || stringStyle === 'funk') {
                // 爵士/Funk：断奏多，力度起伏大
                if (n.duration < 1.0) {
                    overlapDur *= 0.7; // 偏断奏
                }
                adjustedVel *= (1.0 + (globalPRNG.next() * 0.2 - 0.1)); // 更大的力度波动
            } else {
                // Pop/Folk: 平稳的连奏
                overlapDur *= 1.05; // 稍微重叠
                if (n.duration >= 1.0) adjustedVel = Math.min(1.0, adjustedVel * 1.1); 
                if (n.duration < 0.5) adjustedVel *= 0.9; 
            }
            
            return { ...n, duration: overlapDur, velocity: Math.max(0.1, Math.min(1.0, adjustedVel)) };
        });

        // 🌟 Spessasynth 兼容性修复: 绝对禁止同音高重叠 (Same-pitch overlap prevention)
        // 如果同音高重叠，前一个音的 noteOff 会切断后一个音的播放
        for (let i = 0; i < finalNotes.length; i++) {
            for (let j = i + 1; j < finalNotes.length; j++) {
                if (finalNotes[i].pitch === finalNotes[j].pitch) {
                    if (finalNotes[i].onset + finalNotes[i].duration > finalNotes[j].onset) {
                        // 强制截断前一个音，留出 0.02 拍的间隙，最少保留 0.01 拍
                        finalNotes[i].duration = Math.max(0.01, finalNotes[j].onset - finalNotes[i].onset - 0.02);
                    }
                }
                // 如果 onset 差距过大，提前 break 优化性能
                if (finalNotes[j].onset - finalNotes[i].onset > 4.0) break;
            }
        }

        return finalNotes;
    }

    protected getHumanizeParams(note: NoteData, index: number, chordSize: number, isHighFirst: boolean, isRightHand: boolean, idiomPreferences?: any) {
        const stringStyle = idiomPreferences?.stringStyle || 'pop';
        
        // 弦乐群奏时，各声部进入会有微小的时间差
        let strumDelay = index * (globalPRNG.next() * 0.015 + 0.01); // 10-25ms
        
        // 铁律 5: 音头不能太硬、也不能太软
        // 弦乐的起音(Attack)较慢，整体时间感会稍微滞后一点点
        let timingWobble = this.randomGaussian(0.01, 0.02); // 整体偏晚 10ms，标准差 20ms
        
        if (stringStyle === 'cinematic' && note.duration < 0.5) {
            // 电影短弓 (Spiccato) 音头硬，时间更准
            timingWobble = this.randomGaussian(0, 0.005);
            strumDelay *= 0.5; // 群奏更整齐
        } else if (stringStyle === 'jazz') {
            // 爵士弦乐更慵懒，滞后更多
            timingWobble = this.randomGaussian(0.02, 0.03);
        }

        const beatsPerBar = GlobalContext.currentTimeSignature[0];
        const is68 = beatsPerBar === 6;
        const beatPos = note.onset % beatsPerBar;

        // 强弱拍层级 (Beat Hierarchy)
        let velocityMultiplier = 1.0;
        if (beatPos === 0) velocityMultiplier *= 1.1;       // 第一拍强拍，运弓更重
        else if (is68 && beatPos === 3) velocityMultiplier *= 1.05; // 6/8 次强拍
        else if (!is68 && beatPos === 2) velocityMultiplier *= 1.05;  // 4/4 第三拍次强拍
        else if (beatPos % 1 !== 0) {
            velocityMultiplier *= 0.85; // 反拍或切分音略弱
            if (stringStyle === 'funk') {
                velocityMultiplier *= 1.2; // Funk 强调反拍
            }
        }

        // 弦乐的力度波动相对平缓，因为是持续发声
        let velocityWobble = this.randomGaussian(0, 0.03);
        if (stringStyle === 'cinematic') {
            velocityWobble = this.randomGaussian(0, 0.05); // 电影动态更大
        }

        return { strumDelay, timingWobble, velocityWobble, velocityMultiplier };
    }
}