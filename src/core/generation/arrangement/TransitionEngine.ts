import { PRNGManager } from '../../utils/PRNG';
// ==========================================
// 📄 文件路径: /src/core/generation/arrangement/TransitionEngine.ts
// 🎬 V2.3 边界导演引擎 (加入 Drum Fills, The Drop, Cymbal Swells)
// ==========================================
import { NoteData, SectionMetadata, SectionType } from '../types';

import { StyleId } from '../config/StyleFlags';
import { StyleConfig } from '../types';

export class TransitionEngine {
    private static muteRegion(notes: NoteData[], startBeat: number, endBeat: number) {
        for (let i = notes.length - 1; i >= 0; i--) {
            const note = notes[i];
            if (note.onset >= startBeat && note.onset < endBeat) notes.splice(i, 1);
            else if (note.onset < startBeat && note.onset + note.duration > startBeat) note.duration = startBeat - note.onset; 
        }
    }

    // 🌟 1. Drum Fills (多种类型的鼓加花)
    private static injectDrumFill(drums: NoteData[], startBeat: number, endBeat: number, energyDelta: number, currentEnergy: number, style: StyleConfig) {
        this.muteRegion(drums, startBeat, endBeat);
        const KICK = 36, SNARE = 38, CRASH = 49, TOM_HI = 50, TOM_MID = 47, TOM_LOW = 43, HIHAT_CLOSED = 42, HIHAT_OPEN = 46;
        
        const fillLength = endBeat - startBeat;
        const fillStyle = style.orchestration?.fillStyle || 'standard';
        const isAcousticBallad = fillStyle === 'micro';

        // 🌟 能量感知：低能量段落或能量下降时，使用极简加花 (Micro-Fill / Drop Fill)
        if (currentEnergy <= 4 || energyDelta < 0 || isAcousticBallad) {
            // 切分微加花 (Syncopated Micro-Fill)
            // 抒情歌即使能量高，也倾向于使用微加花
            const fillStart = endBeat - (isAcousticBallad ? 1.0 : 0.5);
            
            if (PRNGManager.next() > 0.5) {
                // 简单的底鼓+开镲
                drums.push({ pitch: KICK, onset: fillStart, duration: 0.1, velocity: 0.7 });
                drums.push({ pitch: HIHAT_OPEN, onset: fillStart, duration: 0.1, velocity: 0.6 });
            } else {
                // 军鼓轻敲或边击 (Cross Stick)
                const snareVel = isAcousticBallad ? 0.4 : 0.6;
                drums.push({ pitch: SNARE, onset: fillStart, duration: 0.1, velocity: snareVel });
                if (PRNGManager.next() > 0.5) {
                    drums.push({ pitch: SNARE, onset: fillStart + 0.25, duration: 0.1, velocity: snareVel * 0.6 }); // Ghost note
                }
            }
            return;
        }

        let fillType = PRNGManager.next();
        if (energyDelta >= 3) {
            fillType = PRNGManager.next() > 0.5 ? 0.6 : 0.1;
        }

        if (fillType < 0.25) {
            // Type A: 线性加花 (Linear Fill - RLKK or similar) - 绝不重叠
            // 适合 Funk, Pop, R&B
            const patterns = [
                [SNARE, SNARE, KICK, KICK], // RLKK
                [KICK, SNARE, KICK, SNARE], // K S K S
                [SNARE, KICK, KICK, SNARE], // S K K S
                [TOM_HI, TOM_MID, KICK, KICK], // T T K K
                [SNARE, TOM_HI, TOM_MID, TOM_LOW], // Classic Snare to Tom Roll
                [SNARE, SNARE, TOM_HI, TOM_MID], // S S T1 T2
                [SNARE, KICK, TOM_HI, KICK] // S K T1 K
            ];
            const pattern = patterns[Math.floor(PRNGManager.next() * patterns.length)];
            let pIdx = 0;
            
            // 决定加花的密度 (16分音符或8分音符)
            let step = 0.5;
            if (energyDelta >= 3 || currentEnergy > 7) step = 0.25;
            if (energyDelta >= 5 && fillLength <= 1.0) step = 0.125;
            
            for (let beat = startBeat; beat < endBeat; beat += step) {
                const pitch = pattern[pIdx % pattern.length];
                const isAccent = pIdx % 4 === 0 || pIdx % 4 === 2;
                
                // 动态力度：极大拉开重音和弱音的差距
                let vel = pitch === KICK ? 0.9 : (isAccent ? 0.95 : 0.35);
                vel += (PRNGManager.next() - 0.5) * 0.1; // Humanize
                
                drums.push({ pitch, onset: beat, duration: 0.1, velocity: Math.max(0.1, Math.min(1.0, vel)) });
                pIdx++;
            }
        } else if (fillType < 0.5) {
            // Type B: 幽灵音与重音移位 (Ghost Notes & Accent Displacement)
            // 适合 Groove 较强的曲风，混合 Snare 和 Toms
            for (let beat = startBeat; beat < endBeat; beat += 0.25) {
                const beatInFill = beat - startBeat;
                
                // 重音移位逻辑：随机决定重音位置，打破常规的强拍
                const isAccent = PRNGManager.next() > 0.7 || (Math.abs(beatInFill % 1 - 0.75) < 1e-6);
                
                // 🌟 极大地拉开重音和弱音的力度差距，突出双跳和移位感
                const vel = isAccent ? (0.9 + PRNGManager.next() * 0.1) : (0.2 + PRNGManager.next() * 0.15); 
                
                // 🌟 动态分配鼓组：重音多在 Snare 或 High Tom，弱音（幽灵音）多在 Snare 边缘或 Mid/Low Tom
                let pitch;
                if (isAccent) {
                    pitch = PRNGManager.next() > 0.4 ? SNARE : TOM_HI;
                } else {
                    const rand = PRNGManager.next();
                    if (rand > 0.6) pitch = SNARE; // Ghost snare
                    else if (rand > 0.3) pitch = TOM_MID;
                    else pitch = TOM_LOW;
                }
                
                drums.push({ pitch, onset: beat, duration: 0.1, velocity: vel });
                
                // 偶尔在重音处加入底鼓支撑
                if (isAccent && PRNGManager.next() > 0.5) {
                    drums.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.9 });
                }
            }
        } else if (fillType < 0.75) {
            // Type C: 节奏型组合加花 (Rhythmic Groupings - e.g., 前八后十六)
            // 允许一拍内分配到不同的鼓上
            for (let beat = startBeat; beat < endBeat; beat += 1.0) {
                const patternType = PRNGManager.next();
                
                if (patternType < 0.33) {
                    // 前八后十六 (1 Eighth + 2 Sixteenths)
                    // 分配：Snare -> Tom1 -> Tom2
                    drums.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: 0.9 });
                    drums.push({ pitch: TOM_HI, onset: beat + 0.5, duration: 0.1, velocity: 0.6 });
                    drums.push({ pitch: TOM_MID, onset: beat + 0.75, duration: 0.1, velocity: 0.7 });
                } else if (patternType < 0.66) {
                    // 前十六后八 (2 Sixteenths + 1 Eighth)
                    // 分配：Tom1 -> Tom2 -> Snare
                    drums.push({ pitch: TOM_HI, onset: beat, duration: 0.1, velocity: 0.7 });
                    drums.push({ pitch: TOM_MID, onset: beat + 0.25, duration: 0.1, velocity: 0.6 });
                    drums.push({ pitch: SNARE, onset: beat + 0.5, duration: 0.1, velocity: 0.95 });
                } else {
                    // 四个十六分音符 (4 Sixteenths Roll)
                    // 分配：Snare -> Snare -> Tom1 -> Tom2
                    drums.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: 0.9 });
                    drums.push({ pitch: SNARE, onset: beat + 0.25, duration: 0.1, velocity: 0.4 }); // Ghost
                    drums.push({ pitch: TOM_HI, onset: beat + 0.5, duration: 0.1, velocity: 0.7 });
                    drums.push({ pitch: TOM_MID, onset: beat + 0.75, duration: 0.1, velocity: 0.8 });
                }
                
                // 每拍正拍加个底鼓支撑
                if (PRNGManager.next() > 0.3) {
                    drums.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.85 });
                }
            }
        } else {
            // Type D: 切分留白加花 (Syncopated Space Fill)
            // 适合现代流行，留出空间感
            const hits = [0, 0.25, 0.75, 1.25, 1.5, 1.75]; // 预设的切分打击点 (相对于 startBeat)
            
            for (let beat = startBeat; beat < endBeat; beat += 0.25) {
                const beatInFill = beat - startBeat;
                
                // 检查当前拍子是否在预设的打击点中，并且根据概率决定是否真的打击
                if (hits.includes(beatInFill % 2) && PRNGManager.next() > 0.3) {
                    const isTom = PRNGManager.next() > 0.4;
                    const pitch = isTom ? (PRNGManager.next() > 0.5 ? TOM_HI : TOM_MID) : SNARE;
                    const vel = 0.7 + PRNGManager.next() * 0.2;
                    
                    drums.push({ pitch, onset: beat, duration: 0.1, velocity: vel });
                    
                    // 强拍或切分点加底鼓
                    if (Math.abs(beatInFill % 1) < 1e-6 || Math.abs(beatInFill % 1 - 0.75) < 1e-6) {
                        drums.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 0.9 });
                    }
                }
            }
        }
    }

    // 🌟 2. The "Drop" (情绪悬空)
    private static injectDrop(lh: NoteData[], rh: NoteData[], drums: NoteData[], boundaryBeat: number, dropLength: number = 1.0) {
        const dropStart = boundaryBeat - dropLength;
        
        // 强制所有乐器休止
        this.muteRegion(lh, dropStart, boundaryBeat);
        this.muteRegion(rh, dropStart, boundaryBeat);
        this.muteRegion(drums, dropStart, boundaryBeat);
        
        // 可以在 Drop 的瞬间加一个重击，然后彻底安静
        const KICK = 36, CRASH = 49, CHINA = 52, CRASH2 = 57;
        const crashPitch = PRNGManager.next() > 0.7 ? CHINA : (PRNGManager.next() > 0.5 ? CRASH2 : CRASH);
        drums.push({ pitch: KICK, onset: dropStart, duration: 0.1, velocity: 1.0 }); // Kick
        drums.push({ pitch: crashPitch, onset: dropStart, duration: 1.0, velocity: 0.8 }); // Crash/China
    }

    // 🌟 3. Build-up (Snare Roll + Cymbal Swell)
    private static injectBuildUp(drums: NoteData[], boundaryBeat: number, length: number = 2.0) {
        const startBeat = boundaryBeat - length;
        const CRASH = 49;
        const SNARE = 38;
        const KICK = 36;
        
        for (let beat = startBeat; beat < boundaryBeat; beat += 0.25) {
            const progress = (beat - startBeat) / length;
            // Exponential crescendo
            const vel = Math.pow(progress, 2) * 0.7 + 0.3; 
            
            // Snare roll (16th notes, becoming 32nd notes at the very end)
            const isEnd = beat >= boundaryBeat - 0.5;
            const step = isEnd ? 0.125 : 0.25;
            
            for (let subBeat = beat; subBeat < beat + 0.25; subBeat += step) {
                drums.push({ pitch: SNARE, onset: subBeat, duration: 0.1, velocity: vel });
                // Add kick on 8th notes
                if (Math.abs(subBeat % 0.5) < 1e-6) {
                    drums.push({ pitch: KICK, onset: subBeat, duration: 0.1, velocity: vel });
                }
            }
            
            // Cymbal swell (rapid 32nd notes)
            for (let subBeat = beat; subBeat < beat + 0.25; subBeat += 0.125) {
                drums.push({ pitch: CRASH, onset: subBeat, duration: 0.1, velocity: vel * 0.8 });
            }
        }
    }

    // 🌟 4. Epic Build-up (EDM 专属，长达 4-8 小节的推歌)
    private static injectEpicBuildUp(drums: NoteData[], startBeat: number, boundaryBeat: number) {
        const length = boundaryBeat - startBeat;
        const CRASH = 49;
        const SNARE = 38;
        const KICK = 36;
        
        for (let beat = startBeat; beat < boundaryBeat; beat += 0.25) {
            const progress = (beat - startBeat) / length;
            // 能量指数级递增
            const vel = Math.pow(progress, 1.5) * 0.6 + 0.4; 
            
            // 决定当前拍子的打击密度 (四分 -> 八分 -> 十六分 -> 三十二分)
            let step = 1.0;
            if (progress > 0.85) step = 0.125; // 最后 15%：32分音符狂轰滥炸
            else if (progress > 0.6) step = 0.25; // 60%-85%：16分音符
            else if (progress > 0.3) step = 0.5; // 30%-60%：8分音符
            
            // 只有在当前 beat 匹配 step 时才打
            if (beat % step === 0) {
                for (let subBeat = beat; subBeat < beat + 0.25; subBeat += step) {
                    // 越往后，军鼓和底鼓一起砸
                    drums.push({ pitch: SNARE, onset: subBeat, duration: 0.1, velocity: vel });
                    if (progress > 0.5) {
                        drums.push({ pitch: KICK, onset: subBeat, duration: 0.1, velocity: vel * 0.9 });
                    }
                }
            }
        }
    }

    /**
     * 🌟 乐器进场前的“弱起助跑 (Bass Slide / Glissando)”
     */
    // 🌟 5. Sub Drop (低频下潜)
    private static injectSubDrop(lh: NoteData[], boundaryBeat: number) {
        // 在能量骤降的瞬间（如 Drop 或 Breakdown），加入一个极低的 Bass 扫频
        const dropStart = boundaryBeat;
        lh.push({
            pitch: 24, // C1
            onset: dropStart,
            duration: 4.0, // 持续 4 拍
            velocity: 1.0,
            pitchBend: -12, // 向下弯音一个八度
            pitchBendDuration: 4.0
        });
    }

    // 🌟 6. Reverse Cymbal (反向镲片 / Riser)
    private static injectReverseCymbal(drums: NoteData[], boundaryBeat: number, length: number = 2.0) {
        // 使用特殊的 pitch (119) 标记 Reverse Cymbal
        const startBeat = boundaryBeat - length;
        drums.push({
            pitch: 119, // 特殊标记：Reverse Cymbal
            onset: startBeat,
            duration: length,
            velocity: 0.9
        });
    }

    private static injectBassSlide(lh: NoteData[], boundaryBeat: number) {
        // Find the target pitch in the next section
        const targetNote = lh.find(n => n.onset >= boundaryBeat);
        const targetPitch = targetNote ? targetNote.pitch : 36; // Default to C2 if not found

        const slideStart = boundaryBeat - 0.5;
        this.muteRegion(lh, slideStart, boundaryBeat); // 腾出空间

        // Chromatic slide from 3 semitones below or above
        const direction = PRNGManager.next() > 0.5 ? 1 : -1;
        const startPitch = targetPitch - (3 * direction);

        // 16th note triplets for a fast slide effect
        for (let i = 0; i < 3; i++) {
            lh.push({
                pitch: startPitch + (i * direction),
                onset: slideStart + (i * 0.166), 
                duration: 0.166,
                velocity: 0.6 + (i * 0.15) // crescendo
            });
        }
    }

    public static applyBoundaries(
        sections: SectionMetadata[], lh: NoteData[], rh: NoteData[], drums: NoteData[], beatsPerBar: number, style: StyleConfig
    ) {
        const CRASH = 49, CHINA = 52, SPLASH = 55, CRASH2 = 57;

        sections.forEach((sec, idx) => {
            const currentEnergy = sec.energyLevel;
            let nextEnergy = (idx < sections.length - 1) ? sections[idx + 1].energyLevel : 4;
            
            const delta = nextEnergy - currentEnergy;
            const boundaryBeat = sec.endBeat;
            const lastBarStart = boundaryBeat - beatsPerBar;

            if (sec.type === SectionType.BuildUp && nextEnergy >= 8) {
                // EDM 专属超长 BuildUp
                this.injectEpicBuildUp(drums, sec.startBeat, boundaryBeat);
                // 强制 Drop 前悬空 1 拍
                this.injectDrop(lh, rh, drums, boundaryBeat, 1.0);
                // 🌟 P2: 添加 Reverse Cymbal (Riser)
                this.injectReverseCymbal(drums, boundaryBeat, 4.0);
            } else if (delta > 0 && nextEnergy >= 6) {
                // 进入高潮段落
                const crashPitch = PRNGManager.next() > 0.8 ? CHINA : (PRNGManager.next() > 0.5 ? CRASH2 : CRASH);
                drums.push({ pitch: crashPitch, onset: boundaryBeat, duration: 1.0, velocity: 0.9 });
                
                if (currentEnergy <= 5) {
                    this.injectBassSlide(lh, boundaryBeat);
                }

                // 🌟 随机选择一种高级过渡特效
                const transitionRoll = PRNGManager.next();
                if (transitionRoll < 0.3) {
                    // 25% 概率：The Drop (情绪悬空 1 拍)
                    this.injectDrop(lh, rh, drums, boundaryBeat, 1.0);
                } else if (transitionRoll < 0.5) {
                    // 25% 概率：Massive Build-up (Snare Roll + Cymbal Swell)
                    this.injectBuildUp(drums, boundaryBeat, 2.0);
                } else if (transitionRoll < 0.65) {
                    // 15% 概率：Reverse Cymbal (Riser)
                    this.injectReverseCymbal(drums, boundaryBeat, 2.0);
                } else {
                    // 35% 概率：完整的 Drum Fill (1 小节)
                    this.injectDrumFill(drums, lastBarStart, boundaryBeat, delta, currentEnergy, style);
                }
            } else if (delta >= 3) {
                // 中等能量跃升
                if (PRNGManager.next() < 0.5) {
                    this.injectDrumFill(drums, boundaryBeat - 2.0, boundaryBeat, delta, currentEnergy, style);
                } else {
                    this.injectDrop(lh, rh, drums, boundaryBeat, 0.5); // 半拍的 Drop
                }
                // 偶尔加个 Splash
                if (PRNGManager.next() > 0.5) {
                    drums.push({ pitch: SPLASH, onset: boundaryBeat, duration: 0.5, velocity: 0.7 });
                }
            } else if (delta <= -3) {
                // 能量骤降 (进入 Breakdown 或 Outro)
                const dropStart = boundaryBeat - 2.0;
                this.muteRegion(lh, dropStart, boundaryBeat);
                this.muteRegion(rh, dropStart, boundaryBeat);
                this.muteRegion(drums, dropStart, boundaryBeat);
                drums.push({ pitch: 36, onset: dropStart, duration: 0.5, velocity: 0.7 });
                drums.push({ pitch: CHINA, onset: dropStart, duration: 1.0, velocity: 0.6 }); // Use China for a sharp drop
                drums.push({ pitch: 36, onset: dropStart + 1.0, duration: 0.5, velocity: 0.7 });
                
                // 🌟 P2: 添加 Sub Drop (低频下潜)，增强失重感
                if (PRNGManager.next() > 0.3) {
                    this.injectSubDrop(lh, boundaryBeat);
                }
            }
        });
    }
}