// ============================================================
// TextureMapper — 三维频段解耦 + Idiom 驱动的伴奏织体生成器
// ============================================================
// Pitch Space: RELATIVE
//   输入：GeneratedChord（root 0~11 相对调式）+ SectionMetadata + chordIdiom
//   输出：bass / rhythmComping / sustainedPad 三层独立相对音高音轨
//   绝对 MIDI 由 Orchestrator.applyOffset() 统一施加 keyOffset（K-2）
//
// 织体维度：
//   sustainedPad     呼吸铺底层（Glue）   能量>=5 + idiom.comping.allowDrop2 自动 Drop-2 开放排列
//   bass             低频地基层           energy <=4 长音 / 5~6 根五交替 / >=7 八度跃动
//   rhythmComping    律动驱动层           扫弦延迟 / 切分 pattern / comping duration 全部走 Idiom
//
// 数据驱动改造（V7.6 + Lead/Comping 拆分）：
//   原本通过 InstrumentIdFamily 查表识别 isGuitar/isSynth 的脏代码已移除，
//   改为消费 chordIdiom.comping.{strumDelay, compingPatterns, compingDuration, allowDrop2}，
//   使得本模块对乐器名彻底无感。.lead 字段不归本模块管。
//   compingPatterns 是 Pattern 池，按小节索引轮换以消除机械重复感。
// ============================================================

import { NoteData, GeneratedChord, SectionMetadata, ChordQuality, InstrumentIdiom } from '../types';
import { MusicTheory } from '../theory/MusicTheory';
import { DEFAULT_FALLBACK_IDIOM as AcousticPianoIdiom } from '../idioms/MusicianRegistry';
import { PRNGManager } from '../../utils/PRNG';

const VOICING_TARGET_CENTER = 0;
const BASS_OCTAVE_OFFSET = -24;
const BEAT_EPS = 0.001;
const DOWNBEAT_EPS = 0.01;

export class TextureMapper {
    public static generateAccompaniment(
        chords: GeneratedChord[],
        sections: SectionMetadata[],
        chordIdiom: InstrumentIdiom = AcousticPianoIdiom,
    ): { bass: NoteData[]; rhythmComping: NoteData[]; sustainedPad: NoteData[] } {
        const bass: NoteData[] = [];
        const rhythmComping: NoteData[] = [];
        const sustainedPad: NoteData[] = [];
        let currentVoicing: number[] = [];

        // 🌟 按乐句 (Phrase，每 16 拍) 预先决定织体，打破死循环
        const phraseTextures: Record<number, string> = {};
        for (let i = 0; i < chords.length; i++) {
            const chord = chords[i];
            const phraseIdx = Math.floor(chord.startBeat / 16);
            if (!phraseTextures[phraseIdx]) {
                // 查找该乐句起点所在的段落能量
                let energy = 5;
                for (let s = 0; s < sections.length; s++) {
                    if (chord.startBeat >= sections[s].startBeat - BEAT_EPS && chord.startBeat < sections[s].endBeat - BEAT_EPS) {
                        energy = sections[s].energyLevel; break;
                    }
                }

                let tex = 'block';
                if (energy >= 7) {
                    tex = 'comping'; // 高能段落强制切分
                } else if (energy <= 3) {
                    tex = 'block';   // 极低能段强制留白
                } else {
                    const texType = chordIdiom.comping.textureType || 'block';
                    if (texType === 'mixed' && chordIdiom.comping.textureProbabilities) {
                        const roll = PRNGManager.nextFloat(0, 1);
                        const w = chordIdiom.comping.textureProbabilities;
                        if (roll < w.block) tex = 'block';
                        else if (roll < w.block + w.arpeggio) tex = 'arpeggio';
                        else tex = 'comping';
                    } else {
                        tex = texType;
                    }
                }
                phraseTextures[phraseIdx] = tex;
            }
        }

        for (let ci = 0; ci < chords.length; ci++) {
            const chord = chords[ci];

            // 1) 查找当前和弦所在段落的能量
            let energy = 5;
            for (let i = 0; i < sections.length; i++) {
                const s = sections[i];
                if (
                    chord.startBeat >= s.startBeat - BEAT_EPS &&
                    chord.startBeat < s.endBeat - BEAT_EPS
                ) {
                    energy = s.energyLevel;
                    break;
                }
            }

            // 2) chord.quality 已是 ChordQuality 枚举（types.ts 数值类型），直接使用
            const qEnum = chord.quality;
            const intervals = MusicTheory.getChordTones(qEnum);
            const pcs: number[] = [];

            // 大师级无根音排列 (Rootless Voicing)：≥4 音的高级和弦丢弃根音让贝斯独占低频，加 9 音染色
            const isAdvancedChord = intervals.length >= 4;
            for (let j = 0; j < intervals.length; j++) {
                if (isAdvancedChord && intervals[j] === 0) continue; // 剔除根音，让给贝斯
                pcs.push(((chord.root + intervals[j]) % 12 + 12) % 12);
            }
            if (isAdvancedChord && (qEnum === ChordQuality.Major7 || qEnum === ChordQuality.Minor7 || qEnum === ChordQuality.Dominant7 || qEnum === ChordQuality.Minor9 || qEnum === ChordQuality.Major9)) {
                const ninthPc = ((chord.root + 2) % 12 + 12) % 12;
                if (!pcs.includes(ninthPc)) pcs.push(ninthPc); // 加入 9 音增加高级色彩
            }
            if (pcs.length === 0) pcs.push(chord.root); // 兜底

            // 3) 平滑声部连接 + 能量>=5 且 Idiom 允许时启动 Drop-2
            const rawVoicing = MusicTheory.getSmoothVoicing(pcs, currentVoicing, VOICING_TARGET_CENTER);
            currentVoicing = (energy >= 5 && chordIdiom.comping.allowDrop2) ? MusicTheory.getDrop2Voicing(rawVoicing) : rawVoicing;

            const chordDur = chord.endBeat - chord.startBeat;

            // --- Layer 1: Sustained Pad（铺底胶水层）---
            for (let i = 0; i < currentVoicing.length; i++) {
                sustainedPad.push({ pitch: currentVoicing[i], onset: chord.startBeat, duration: chordDur, velocity: 0.35 });
            }

            // --- Layer 2: Bass（低频地基层，保留之前的 Walkdown 逻辑）---
            const actualBassPc = chord.bassOverride !== undefined ? chord.bassOverride : chord.root;
            let bassPitch = actualBassPc + BASS_OCTAVE_OFFSET;
            if (chord.bassOverride !== undefined && actualBassPc > chord.root) bassPitch -= 12;

            const nextChord = ci < chords.length - 1 ? chords[ci + 1] : null;
            let nextBassPitch = bassPitch;
            if (nextChord) {
                const nBPc = nextChord.bassOverride !== undefined ? nextChord.bassOverride : nextChord.root;
                nextBassPitch = nBPc + BASS_OCTAVE_OFFSET;
                if (nextChord.bassOverride !== undefined && nBPc > nextChord.root) nextBassPitch -= 12;
            }

            if (energy <= 4) {
                bass.push({ pitch: bassPitch, onset: chord.startBeat, duration: chordDur, velocity: 0.7 });
            } else if (energy <= 6) {
                let fifthSemitones = 7;
                if (qEnum === ChordQuality.Diminished || qEnum === ChordQuality.Diminished7 || qEnum === ChordQuality.HalfDiminished) fifthSemitones = 6;
                else if (qEnum === ChordQuality.Augmented) fifthSemitones = 8;
                const bassFifth = chord.root + fifthSemitones + BASS_OCTAVE_OFFSET;
                for (let b = chord.startBeat; b < chord.endBeat - BEAT_EPS; b += 2.0) {
                    const isBeat1 = Math.abs((b - chord.startBeat) % 4) < DOWNBEAT_EPS;
                    let dur = 1.8;
                    if (b + dur > chord.endBeat) dur = chord.endBeat - b;
                    bass.push({ pitch: isBeat1 ? bassPitch : bassFifth, onset: b, duration: dur, velocity: 0.75 });
                }
            } else {
                for (let b = chord.startBeat; b < chord.endBeat - BEAT_EPS; b += 0.5) {
                    const isDownbeat = Math.abs((b * 2) % 2) < DOWNBEAT_EPS;
                    bass.push({ pitch: isDownbeat ? bassPitch : bassPitch + 12, onset: b, duration: 0.4, velocity: isDownbeat ? 0.85 : 0.65 });
                }
            }

            if (nextChord && energy >= 4 && chordDur >= 2.0) {
                let shortestDiff = nextBassPitch - bassPitch;
                while (shortestDiff > 6) shortestDiff -= 12;
                while (shortestDiff < -6) shortestDiff += 12;
                if (Math.abs(shortestDiff) <= 4 && Math.abs(shortestDiff) > 0) {
                    const passingOnset = chord.endBeat - 0.5;
                    let conflict = false;
                    for (let i = 0; i < bass.length; i++) {
                        if (Math.abs(bass[i].onset - passingOnset) < 0.1) {
                            bass[i].duration = passingOnset - bass[i].onset;
                            if (bass[i].duration < 0.05) conflict = true;
                        } else if (bass[i].onset < passingOnset && bass[i].onset + bass[i].duration > passingOnset) {
                            bass[i].duration = passingOnset - bass[i].onset - 0.05;
                        }
                    }
                    if (!conflict) {
                        const direction = shortestDiff > 0 ? 1 : -1;
                        const passingPitch = bassPitch + direction * (Math.abs(shortestDiff) >= 3 ? 2 : 1);
                        bass.push({ pitch: passingPitch, onset: passingOnset, duration: 0.5, velocity: 0.65 });
                    }
                }
            }

            // --- Layer 3: Rhythm Comping（乐句级一致性）---
            const phraseIdx = Math.floor(chord.startBeat / 16);
            const secTex = phraseTextures[phraseIdx] || 'block';

            const playArpeggio = secTex === 'arpeggio';
            const playComping = secTex === 'comping';

            if (playArpeggio && chordIdiom.comping.arpeggioPatterns) {
                // 流水琶音：每个乐句锁定一种 Pattern
                const root = chord.root;
                let third = chord.root + 4;
                if (qEnum === ChordQuality.Minor || qEnum === ChordQuality.Minor7 || qEnum === ChordQuality.Minor9 || qEnum === ChordQuality.HalfDiminished || qEnum === ChordQuality.Diminished || qEnum === ChordQuality.Minor11) third = chord.root + 3;
                let fifth = chord.root + 7;
                if (qEnum === ChordQuality.Diminished || qEnum === ChordQuality.HalfDiminished || qEnum === ChordQuality.Diminished7) fifth = chord.root + 6;
                else if (qEnum === ChordQuality.Augmented) fifth = chord.root + 8;

                const widePitches = [root, fifth, root + 12, third + 12];
                const arpPool = chordIdiom.comping.arpeggioPatterns;
                const flowPattern = arpPool[phraseIdx % arpPool.length]; // 乐句级锁定

                let arpIdx = 0;
                const step = energy >= 6 ? 0.25 : 0.5;
                for (let b = chord.startBeat; b < chord.endBeat - BEAT_EPS; b += step) {
                    const pIdx = flowPattern[arpIdx % flowPattern.length];
                    if (pIdx !== null && widePitches[pIdx] !== undefined) {
                        rhythmComping.push({
                            pitch: widePitches[pIdx],
                            onset: b,
                            duration: step * 1.5,
                            velocity: 0.55 + (pIdx === 0 ? 0.15 : 0.0),
                        });
                    }
                    arpIdx++;
                }
            } else if (playComping) {
                // 节奏切分：每个乐句锁定一种 Pattern
                const patterns = chordIdiom.comping.compingPatterns;
                const compDur = chordIdiom.comping.compingDuration;
                const currentPattern = patterns[phraseIdx % patterns.length]; // 乐句级锁定

                const barStart = Math.floor(chord.startBeat / 4) * 4;
                for (let b = barStart; b < chord.endBeat - BEAT_EPS; b += 4.0) {
                    for (let r = 0; r < currentPattern.length; r++) {
                        const hitOnset = b + currentPattern[r];
                        if (hitOnset >= chord.startBeat - BEAT_EPS && hitOnset < chord.endBeat - BEAT_EPS) {
                            for (let i = 0; i < currentVoicing.length; i++) {
                                const stagger = i * chordIdiom.comping.strumDelay;
                                rhythmComping.push({ pitch: currentVoicing[i], onset: hitOnset + stagger, duration: compDur, velocity: 0.75 });
                            }
                        }
                    }
                }
            } else {
                // 柱式留白
                for (let i = 0; i < currentVoicing.length; i++) {
                    const stagger = i * chordIdiom.comping.strumDelay;
                    rhythmComping.push({ pitch: currentVoicing[i], onset: chord.startBeat + stagger, duration: chordDur - stagger, velocity: 0.5 });
                }
            }
        }

        return { bass, rhythmComping, sustainedPad };
    }
}
