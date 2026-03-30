import { globalPRNG } from '../../utils/PRNG';
// ==========================================
// 📄 文件路径: /src/core/generation/performance/SingerPersona.ts
// 🎭 V2.2 歌手性格渲染器 (接入顺阶偏移计算，转音丝滑不跑调)
// ==========================================
import { NoteData, SingerPersonaConfig, GeneratedChord } from '../types';
import { HarmonyCore } from '../composing/HarmonyCore';
import { GlobalContext } from '../GlobalContext';

export class SingerPersona {
    public static apply(notes: NoteData[], persona: SingerPersonaConfig, chords: GeneratedChord[], instrumentName: string = 'Acoustic_Grand'): NoteData[] {
        if (!persona || !persona.traits) {
            console.warn("SingerPersona.apply received undefined persona or traits. Falling back to Folk_Storyteller.");
            persona = SingerPersona.PERSONAS['Folk_Storyteller'];
        }

        // 🌟 判断是否为键盘/吉他等非人声乐器。如果是，大幅削弱或关闭人声特有的“转音”和“叹息尾音”
        // 因为这些在钢琴上听起来像弹错的装饰音，显得匆忙、杂乱、不够优雅。
        const isPianoOrGuitar = instrumentName.includes('Piano') || instrumentName.includes('EP') || instrumentName.includes('Guitar') || instrumentName.includes('Grand');

        const result: NoteData[] =[];
        const sorted = [...notes].sort((a, b) => a.onset - b.onset);

        let continuousPlayBeats = 0; // 🎷 追踪连续吹奏时长，用于强制换气

        for (let i = 0; i < sorted.length; i++) {
            let current = { ...sorted[i] };
            const next = i < sorted.length - 1 ? sorted[i + 1] : null;
            
            const isSax = instrumentName.includes('Sax');
            
            // 萨克斯的换气阈值更短，0.5拍就算换气了
            const breathGap = isSax ? 0.5 : 1.0;
            const isPhraseStart = result.length === 0 || (current.onset - result[result.length-1].onset - result[result.length-1].duration >= breathGap);
            const isPhraseEnd = !next || (next.onset - (current.onset + current.duration) >= breathGap);
            const isLongNote = current.duration >= 1.0;
            
            const activeChord = chords.find(c => current.onset >= c.startBeat && current.onset < c.endBeat) || chords[0];
            const safeTones = HarmonyCore.getSafeScalePitches(activeChord, GlobalContext.currentTonality);

            if (isSax) {
                // 🎷 萨克斯专属 Idiom 处理
                
                // 0. 真实换气系统 (Real Breathing System)
                if (isPhraseStart) {
                    continuousPlayBeats = 0; // 已经有自然停顿，重置憋气条
                }
                continuousPlayBeats += current.duration;
                
                // 如果连续吹奏超过 12 拍 (3小节)，或者极端憋气超过 16 拍，强制换气！
                let forcedBreath = false;
                if (continuousPlayBeats > 12 && current.duration >= 0.5) {
                    forcedBreath = true; // 找个长音切断换气
                } else if (continuousPlayBeats > 16) {
                    forcedBreath = true; // 憋不住了，短音也得切断换气
                }
                
                if (forcedBreath) {
                    // 强制缩短当前音符，留出换气时间
                    current.duration = Math.min(current.duration * 0.5, 0.2); 
                    continuousPlayBeats = 0; // 换气完毕，憋气条清零
                }
                
                const isEffectivePhraseEnd = isPhraseEnd || forcedBreath;

                // 1. 句首弱起 (First Note Weak/Delayed Attack)
                // 萨克斯的第一个音一定是先提前左手的弱起，模拟吹起
                if (isPhraseStart) {
                    const breathDur = 0.1; 
                    const startPitch = HarmonyCore.shiftDiatonic(current.pitch, safeTones, -1);
                    result.push({
                        pitch: startPitch,
                        onset: Math.max(0, current.onset - breathDur),
                        duration: breathDur + 0.05, // 稍微重叠
                        velocity: current.velocity * 0.4, // 弱起
                        isGraceNote: true
                    });
                }

                // 2. 音区动态与超吹 (Altissimo)
                if (current.pitch >= 79) { // High G 及以上 (超吹区)
                    current.velocity = Math.min(1.0, current.velocity * 1.2); // 强、炸
                    // 结尾强制下滑
                    if (isEffectivePhraseEnd || isLongNote) {
                        const slideDur = 0.15;
                        current.duration = Math.max(0.1, current.duration - slideDur);
                        result.push({...current});
                        result.push({
                            pitch: current.pitch - 2, // 下滑
                            onset: current.onset + current.duration,
                            duration: slideDur,
                            velocity: current.velocity * 0.3,
                            isGraceNote: true
                        });
                        continue;
                    }
                } else if (current.pitch <= 55) {
                    // 低音区：气息厚、暖，音量大
                    current.velocity = Math.min(1.0, current.velocity * 1.1);
                }

                // 3. 气断音 (软断音) - 句末
                if (isEffectivePhraseEnd) {
                    // 气息减弱断音
                    current.duration = Math.max(0.1, current.duration - 0.05);
                }

                // 4. 音符之间的过渡 (Legato / Glissando)
                if (result.length > 0 && !isPhraseStart) {
                    const prev = result[result.length - 1];
                    const gap = current.onset - (prev.onset + prev.duration);
                    const interval = Math.abs(current.pitch - prev.pitch);
                    
                    // 连音重叠 (Legato Overlap) 10-50ms，禁止 0 间隔硬切
                    const overlapMs = 10 + globalPRNG.next() * 40;
                    const overlapBeats = (overlapMs / 1000) * (GlobalContext.currentBPM / 60);
                    
                    if (gap < 0.5) { // 如果是连续的乐句
                        prev.duration = Math.max(prev.duration, (current.onset - prev.onset) + overlapBeats); 
                        
                        // 滑音 (Glissando) - 萨克斯灵魂
                        if (interval > 0 && interval <= 2) {
                            // 2度以内：加 15-80ms 滑音
                            const slideMs = 15 + globalPRNG.next() * 65;
                            const slideBeats = (slideMs / 1000) * (GlobalContext.currentBPM / 60);
                            result.push({
                                pitch: prev.pitch,
                                onset: current.onset - slideBeats,
                                duration: slideBeats + 0.02,
                                velocity: current.velocity * 0.6,
                                isGraceNote: true
                            });
                        }
                    }
                }

                result.push(current);
                continue; // 萨克斯处理完毕，跳过普通歌手的处理
            }

            // 1. 断奏癖好 (钢琴可以保留一点点断奏，但不要太短)
            if (current.duration > 0.5 && globalPRNG.next() < persona.traits.staccatoTendency) {
                current.duration *= isPianoOrGuitar ? 0.8 : 0.5; 
            }

            // 2. 提前抢拍 (防重叠)
            if (current.onset % 1 === 0 && globalPRNG.next() < persona.traits.syncopationPush) {
                const pushAmount = globalPRNG.next() > 0.5 ? 0.5 : 0.25; 
                current.onset -= pushAmount;
                current.duration += pushAmount; 
                
                if (result.length > 0) {
                    const prevNote = result[result.length - 1];
                    if (prevNote.onset + prevNote.duration > current.onset) {
                        prevNote.duration = current.onset - prevNote.onset;
                        if (prevNote.duration <= 0.05) result.pop(); 
                    }
                }
            }

            // 3. 句首转音 (Grace Notes) - 🌟 修复点：钢琴/吉他关闭
            // 钢琴的倚音应该非常克制，否则会显得很烦人。ToplineEngine 已经处理了钢琴的倚音，这里完全关闭。
            const graceProb = isPianoOrGuitar ? 0 : persona.traits.graceNoteProbability;
            
            if ((isPhraseStart || isLongNote) && globalPRNG.next() < graceProb) {
                const graceDur = 0.12; 
                // 🌟 使用 Diatonic Shift：严格从当前音阶的“下方一阶”滑上来！绝对和谐！
                const gracePitch = HarmonyCore.shiftDiatonic(current.pitch, safeTones, -1);
                
                result.push({
                    pitch: gracePitch,
                    onset: current.onset - graceDur,
                    duration: graceDur,
                    velocity: current.velocity * 0.4, // 降低人声转音力度
                    isGraceNote: true
                });
                current.duration -= graceDur; 
            }

            // 4. 句末叹息尾音 (Trailing Fade) - 🌟 修复点：钢琴/吉他完全关闭
            const fadeProb = isPianoOrGuitar ? 0 : persona.traits.trailingFade;
            if (isPhraseEnd && isLongNote && globalPRNG.next() < fadeProb) {
                current.duration -= 0.25;
                result.push({...current}); 
                
                // 🌟 使用 Diatonic Shift：叹息时，声音顺着音阶往下掉 3 个阶（大概四度）
                const fadePitch = HarmonyCore.shiftDiatonic(current.pitch, safeTones, -3);

                result.push({
                    pitch: fadePitch,
                    onset: current.onset + current.duration,
                    duration: 0.25,
                    velocity: current.velocity * 0.2, 
                    isGraceNote: true
                });
                continue; 
            }

            // 最终兜底裁切
            if (result.length > 0) {
                const prev = result[result.length - 1];
                if (prev.onset + prev.duration > current.onset) prev.duration = current.onset - prev.onset;
            }

            result.push(current);
        }
        return result;
    }

    public static readonly PERSONAS: Record<string, SingerPersonaConfig> = {
        'RnB_Diva': { id: 'rnb_diva', name: 'R&B 碎嘴天后', traits: { staccatoTendency: 0.8, trailingFade: 0.2, graceNoteProbability: 0.7, syncopationPush: 0.75 } },
        'Jazz_Crooner': { id: 'jazz_crooner', name: '慵懒爵士男嗓', traits: { staccatoTendency: 0.2, trailingFade: 0.9, graceNoteProbability: 0.4, syncopationPush: 0.6 } },
        'Folk_Storyteller': { id: 'folk_storyteller', name: '民谣述说者', traits: { staccatoTendency: 0.05, trailingFade: 0.1, graceNoteProbability: 0.1, syncopationPush: 0.05 } },
        'Soul_Singer': { id: 'soul_singer', name: '灵魂歌者', traits: { staccatoTendency: 0.4, trailingFade: 0.6, graceNoteProbability: 0.8, syncopationPush: 0.8 } },
        'HK_Pop_King': { id: 'hk_pop_king', name: '港台深情天王', traits: { staccatoTendency: 0.1, trailingFade: 0.8, graceNoteProbability: 0.3, syncopationPush: 0.2 } },
        'C_Pop_Balladeer': { id: 'c_pop_balladeer', name: '华语抒情女嗓', traits: { staccatoTendency: 0.05, trailingFade: 0.9, graceNoteProbability: 0.4, syncopationPush: 0.1 } },
        'Rock_Star': { id: 'rock_star', name: '摇滚巨星', traits: { staccatoTendency: 0.6, trailingFade: 0.1, graceNoteProbability: 0.2, syncopationPush: 0.8 } },
        'Electronic_Producer': { id: 'electronic_producer', name: '电音制作人', traits: { staccatoTendency: 0.1, trailingFade: 0.0, graceNoteProbability: 0.0, syncopationPush: 0.0 } }, // 精准，无多余装饰
        'Jazz_Cat': { id: 'jazz_cat', name: '爵士名伶', traits: { staccatoTendency: 0.3, trailingFade: 0.8, graceNoteProbability: 0.6, syncopationPush: 0.9 } },
        'Rhythm_Master': { id: 'rhythm_master', name: '节奏大师', traits: { staccatoTendency: 0.9, trailingFade: 0.1, graceNoteProbability: 0.2, syncopationPush: 0.95 } },
        'Classical_Virtuoso': { id: 'classical_virtuoso', name: '古典大师', traits: { staccatoTendency: 0.1, trailingFade: 0.4, graceNoteProbability: 0.8, syncopationPush: 0.05 } },
        'Cinematic_Composer': { id: 'cinematic_composer', name: '配乐大师', traits: { staccatoTendency: 0.05, trailingFade: 0.9, graceNoteProbability: 0.1, syncopationPush: 0.1 } },
        'Indie_Rocker': { id: 'indie_rocker', name: '独立摇滚', traits: { staccatoTendency: 0.5, trailingFade: 0.3, graceNoteProbability: 0.3, syncopationPush: 0.7 } }
    };
}