import { PRNGManager } from '../../utils/PRNG';
import { NoteData } from '../types';
import { TextureMapper } from '../arrangement/TextureMapper';
import { HarmonyCore } from '../composing/HarmonyCore';
import { IdiomContext, InstrumentIdiom } from './BaseIdiom';
import { StyleId } from '../config/StyleFlags';

export class PianoIdiom implements InstrumentIdiom {
    public generate(ctx: IdiomContext): NoteData[] {
        const { textureType, styleConfig } = ctx;
        
        // 🌟 拦截：如果是水波纹抒情钢琴，进入专属的大线条逻辑
        if (textureType === 'Water_Arpeggio') {
            return this.generateBalladPiano(ctx);
        }

        const notes: NoteData[] = [];
        const { chord, energyLevel, playBass, melodyNotes, prevVoicing, densityMultiplier, musicContext } = ctx;
        const tonality = musicContext?.tonality || "Major";
        const syncopationProb = (musicContext as any)?.groove?.syncopationProb || 0.2;

        // 1. 右手织体：交由 TextureMapper 处理，但要求其注意和声避让
        const rhNotes = TextureMapper.generateChordTexture(
            chord, energyLevel, textureType, false, false, melodyNotes, undefined, ctx.styleConfig, prevVoicing, undefined, "block-chord", densityMultiplier, playBass
        );
        notes.push(...rhNotes);

        // 2. 左手律动 (The Advanced LH Groove Engine)
        const lhNotes: NoteData[] = [];
        const root = chord.root % 12;
        const fifth = (root + 7) % 12;
        const lhBaseOctave = 36; // C2
        
        // 提取三音，用于构建 1-5-10 开放排列
        const chordTones = HarmonyCore.getChordTones(chord, root + lhBaseOctave);
        const third = chordTones.length > 1 ? chordTones[1] : root + lhBaseOctave + 4; 
        const tenth = third + 12; // 跨越八度的十度音 (The Magic 10th)

        if (!playBass) {
            // 没有贝斯时，左手承担低盘和律动，但使用【开放排列 (Open Voicing)】
            const duration = chord.endBeat - chord.startBeat;
            
            // 正拍 1.0：砸下厚实的根音 (Root)
            lhNotes.push({ pitch: root + lhBaseOctave, onset: chord.startBeat, duration: 0.8, velocity: 75 });

            if (duration >= 2) {
                // 弱拍 1.5 或 2.0：五度音支撑
                const fifthOnset = chord.startBeat + (PRNGManager.next() < 0.5 ? 0.5 : 1.0);
                lhNotes.push({ pitch: fifth + lhBaseOctave, onset: fifthOnset, duration: 0.8, velocity: 55 });

                // 切分拍：绝美的 10 度音 (Tenth) 切入
                if (energyLevel >= 4 && PRNGManager.next() < 0.7) {
                    lhNotes.push({ pitch: tenth, onset: chord.startBeat + 1.5, duration: 0.5, velocity: 60 });
                }

                // 🚀 Bebop 半音趋近 (Chromatic Approach)
                // 仅在律动感较强且能量较高时触发，防止入侵古典/平直曲风
                if (energyLevel >= 6 && PRNGManager.next() < syncopationProb * 1.5) {
                    const approachTarget = fifth + lhBaseOctave; 
                    const approachNote = approachTarget - 1; // 降五度/增四度 趋近
                    lhNotes.push({
                        pitch: approachNote,
                        onset: chord.endBeat - 0.5,
                        duration: 0.25,
                        velocity: 45
                    });
                }
            }
        } else {
            // 有贝斯时，左手极简，专门打反拍或幽灵音 (Ghost Notes)
            const beats = chord.endBeat - chord.startBeat;
            for (let i = 0; i < beats; i++) {
                if (PRNGManager.next() < (energyLevel >= 7 ? 0.4 : 0.2)) {
                    // 只在反拍 (+0.5 或 +0.75) 弹奏，绝不抢贝斯的正拍
                    const offbeat = chord.startBeat + i + (PRNGManager.next() < 0.5 ? 0.5 : 0.75);
                    if (offbeat < chord.endBeat) {
                        lhNotes.push({
                            pitch: root + lhBaseOctave + 12, // 弹高八度
                            onset: offbeat,
                            duration: 0.25,
                            velocity: 40 + PRNGManager.next() * 15
                        });
                    }
                }
            }
        }
        notes.push(...lhNotes);

        // 3. 缝隙加花：R&B 移音技巧 (Lower Chromatic Slurs)
        const localMelodyNotes = melodyNotes.filter(n => n.onset >= chord.startBeat && n.onset < chord.endBeat);
        let gapStart = chord.startBeat;
        if (localMelodyNotes.length > 0) {
            const lastNote = localMelodyNotes[localMelodyNotes.length - 1];
            gapStart = lastNote.onset + lastNote.duration;
        }
        const gapDuration = chord.endBeat - gapStart;

        // 如果主旋律闭嘴超过 1 拍，触发“对话感”加花
        // 触发概率与 syncopationProb 挂钩，防止入侵古典/儿歌
        if (gapDuration >= 1.0 && energyLevel >= 5 && PRNGManager.next() < syncopationProb * 1.5) {
            // 提取目标音：当前和弦的 3 音 或 1 音 或 5 音
            const targetChoice = PRNGManager.next();
            let targetPitch = (root % 12) + 60; // 默认 1 音
            if (targetChoice > 0.6) targetPitch = (third % 12) + 60;
            else if (targetChoice > 0.3) targetPitch = (fifth % 12) + 60;
            
            // 🚀 R&B 移音技巧：下方半音上滑 (Lower Chromatic Slur)
            // 这是最安全且最有蓝调味道的做法，避免了从上方滑落可能撞上调外音的风险
            const gracePitch = targetPitch - 1; 

            // 生成一个极快的装饰音 (Grace Note) 滑向目标音
            notes.push({
                pitch: gracePitch,
                onset: gapStart + 0.25, // 稍微延迟，形成慵懒感
                duration: 0.125, // 极短，16分或32分音符
                velocity: 65
            });
            notes.push({
                pitch: targetPitch,
                onset: gapStart + 0.375, // 紧贴着装饰音之后落地
                duration: 0.5,
                velocity: 75
            });
        }

        return notes;
    }

    private generateBalladPiano(ctx: IdiomContext): NoteData[] {
        // 【大师级重构】：Water Arpeggio (如水流般的抛物线分解)
        const notes: NoteData[] = [];
        const { chord, playBass } = ctx;
        const duration = chord.endBeat - chord.startBeat;
        
        const root = chord.root % 12;
        const lhBaseOctave = 36; // C2

        // 1. 左手：深邃的 1 - 5 - 8 - 10 跨八度琶音底盘
        if (!playBass) {
            notes.push({ pitch: root + lhBaseOctave, onset: chord.startBeat, duration: duration, velocity: 50 });
            if (duration >= 2) {
                notes.push({ pitch: root + 7 + lhBaseOctave, onset: chord.startBeat + 0.5, duration: duration - 0.5, velocity: 40 });
                notes.push({ pitch: root + 12 + lhBaseOctave, onset: chord.startBeat + 1.0, duration: duration - 1.0, velocity: 45 });
                
                // 跨八度的十度音
                const thirdPc = HarmonyCore.getChordTones(chord, 0).length > 1 ? HarmonyCore.getChordTones(chord, 0)[1] : root + 4;
                notes.push({ pitch: (thirdPc % 12) + lhBaseOctave + 12, onset: chord.startBeat + 1.5, duration: duration - 1.5, velocity: 40 });
            }
        }

        // 2. 右手：钟摆式数学曲线 (Pendulum Arpeggio)
        // 废弃之前的随机选音，改用抛物线式的规律音型
        const chordTones = HarmonyCore.getChordTones(chord, 60); // C4
        const rhPool = [...chordTones];
        
        // 加入 9 音增加色彩 (The "Add9" Magic)
        const ninthPc = (root + 2) % 12;
        rhPool.push(ninthPc + 60);
        rhPool.sort((a, b) => a - b);

        let currentBeat = chord.startBeat + (playBass ? 0 : 2.0); // 如果左手弹了琶音，右手等左手弹完两拍再介入，形成交织

        let isAscending = true;
        let poolIdx = 0;

        while (currentBeat < chord.endBeat - 0.25) {
            let pitch = rhPool[poolIdx];
            
            // 力度呈现正弦波呼吸感
            const progress = (currentBeat - chord.startBeat) / duration;
            const velocity = 35 + Math.sin(progress * Math.PI) * 25; 

            notes.push({
                pitch: pitch,
                onset: currentBeat,
                duration: 0.5, // 延音重叠
                velocity: velocity
            });

            // 像水波一样来回激荡 (0 -> 1 -> 2 -> 3 -> 2 -> 1)
            if (isAscending) {
                poolIdx++;
                if (poolIdx >= rhPool.length - 1) isAscending = false;
            } else {
                poolIdx--;
                if (poolIdx <= 0) isAscending = true;
            }

            // 偶尔加入 8 分音符的三连音拉扯节奏
            const step = PRNGManager.next() < 0.1 ? 0.33 : 0.5;
            currentBeat += step;
        }

        return notes;
    }
}
