import { PRNGManager } from "../../utils/PRNG";
import { NoteData, GeneratedChord, StyleConfig, Tonality } from "../types";
import { HarmonyCore } from "../composing/HarmonyCore";
// S-2: GlobalContext removed — context via explicit parameters

export class TextureMapper {
  public static generateBassLine(
    chord: GeneratedChord,
    energyLevel: number,
    isSparseSection: boolean = false,
    isSectionEnd: boolean = false,
    style?: StyleConfig,
    melodyNotes: NoteData[] = [],
    isBassSolo: boolean = false,
    idiomPreferences?: any,
    nextChord?: GeneratedChord,
    nextEnergyLevel: number = 3,
  ): NoteData[] {
    let finalRoot = chord.root % 12;
    finalRoot += 24; // C1 to B1 (24 to 35)
    if (finalRoot < 28) finalRoot += 12; // E1 to Eb2 (28 to 39)

    const notes: NoteData[] = [];
    const duration = chord.endBeat - chord.startBeat;
    
    // Basic steady bass
    for (let beat = chord.startBeat; beat < chord.endBeat; beat += 1) {
      notes.push({
        pitch: finalRoot,
        onset: beat,
        duration: 0.5,
        velocity: 80
      });
    }

    return this.truncateToChordEnd(notes, chord.endBeat);
  }

  public static generateSignatureRiff(
    scale: number[],
    rootNote: number,
    lengthBeats: number,
    startBeat: number
  ): NoteData[] {
    const riff: NoteData[] = [];
    const rhythmMask = [1, 0, 1, 1, 0, 1, 0, 0]; 
    let currentBeat = 0;
    
    while (currentBeat < lengthBeats) {
        for (let i = 0; i < rhythmMask.length; i++) {
            if (currentBeat >= lengthBeats) break;
            
            if (rhythmMask[i] === 1) {
                const pitch = rootNote + scale[Math.floor(PRNGManager.next() * scale.length)];
                riff.push({
                    pitch: pitch,
                    onset: startBeat + currentBeat,
                    duration: 0.25,
                    velocity: 100
                });
            }
            currentBeat += 0.5;
        }
    }
    return riff;
  }

  public static generateDrumGroove(
    startBeat: number,
    endBeat: number,
    energyLevel: number,
    isIntro: boolean = false,
    isOutro: boolean = false,
    style?: StyleConfig,
    swingRatio: number = 0.5,
    nextEnergyLevel: number = 3,
    hasFullGrooveStarted: boolean = false,
    grooveRatio?: { foundation: number; comping: number; color: number },
    drumStyle: string = "steady",
    melodyNotes: NoteData[] = []
  ): NoteData[] {
    const notes: NoteData[] = [];
    const KICK = 36;
    const SNARE = 38;
    const SIDE_STICK = 37; // 边击 (Cross Stick)
    const CHH = 42;
    const RIDE = 51;

    // 🌟 拦截：如果是舒缓类型，使用专属的舒缓鼓组逻辑
    const isBallad = false;

    for (let beat = startBeat; beat < endBeat; beat += 0.5) {
      const relativeBeat = beat - startBeat;
      const isDownbeat = Math.abs(relativeBeat % 1) < 1e-6;
      const isBackbeat = Math.abs(relativeBeat % 2 - 1) < 1e-6;

      if (isBallad) {
        // 俄式民谣鼓组：舒缓、边击、Ride
        if (relativeBeat === 0) {
            // 强拍底鼓，力度轻
            notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 55 });
        } else if (relativeBeat === 2.5 && PRNGManager.next() < 0.3) {
            // 偶尔的弱拍底鼓
            notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 40 });
        }

        if (isBackbeat) {
            // 2, 4 拍使用边击 (Side Stick) 代替军鼓，力度轻柔
            notes.push({ pitch: SIDE_STICK, onset: beat, duration: 0.1, velocity: 60 });
        }

        // 镲片：使用 Ride 或轻柔的 Hi-hat
        // 避免连续的 8 分音符敲击，加入一些呼吸感
        if (PRNGManager.next() < 0.8) {
            const cymbal = energyLevel >= 6 ? RIDE : CHH;
            const cymbalVel = isDownbeat ? 50 : 35;
            notes.push({ pitch: cymbal, onset: beat, duration: 0.1, velocity: cymbalVel });
        }
      } else {
        // 原来的逻辑
        if (isDownbeat && !isBackbeat) {
          notes.push({ pitch: KICK, onset: beat, duration: 0.1, velocity: 90 });
        } else if (isBackbeat) {
          notes.push({ pitch: SNARE, onset: beat, duration: 0.1, velocity: 90 });
        }
        
        notes.push({ pitch: CHH, onset: beat, duration: 0.1, velocity: 70 });
      }
    }

    return notes;
  }

  public static generateCounterMelody(
    chord: GeneratedChord,
    energyLevel: number,
    melodyNotes: NoteData[],
    style?: StyleConfig,
    tonality: Tonality = Tonality.Major
  ): NoteData[] {
    const notes: NoteData[] = [];
    const duration = chord.endBeat - chord.startBeat;

    // 1. 分析主旋律在当前和弦窗口内的“拥挤度” (Local Density Analysis)
    const localMelodyNotes = melodyNotes.filter(n => n.onset >= chord.startBeat && n.onset < chord.endBeat);
    const melodyNoteCount = localMelodyNotes.length;

    // 计算主旋律在这个和弦内占据的时间比例
    let occupiedTime = 0;
    localMelodyNotes.forEach(n => {
        occupiedTime += Math.min(n.duration, chord.endBeat - n.onset);
    });
    const occupancyRate = occupiedTime / duration;

    const targetCenter = chord.root;
    const chordTones = HarmonyCore.getChordTones(chord, targetCenter);
    const safeScalePcs = HarmonyCore.getSafeScalePitches(chord, tonality); 

    // 2. 密度反转法则 (Density Inversion / The Seesaw Principle)
    // 主旋律急（音符多或占据时间长），副旋律缓（长音或休止）
    // 主旋律缓（留白多），副旋律急（走动或琶音）

    if (melodyNoteCount >= 3 || occupancyRate > 0.6) {
        // 【主旋律急】 -> 副旋律缓 (Sustain / Pad behavior)
        // 只有在能量较高时才铺底，否则直接休止让出空间，避免打架
        if (energyLevel >= 5 && PRNGManager.next() > 0.4) {
            const pitch = chordTones[1] !== undefined ? chordTones[1] : chordTones[0];
            notes.push({
                pitch: pitch + 60, // C4 附近，作为中声部支撑
                onset: chord.startBeat,
                duration: duration,
                velocity: 45 + energyLevel * 3 // 较弱的力度，做背景
            });
        }
    } else {
        // 【主旋律缓】 -> 副旋律急 (Fill / Arpeggio behavior)
        // 寻找主旋律的“真空期” (Gap)
        let gapStart = chord.startBeat;
        if (localMelodyNotes.length > 0) {
            const lastNote = localMelodyNotes[localMelodyNotes.length - 1];
            gapStart = lastNote.onset + lastNote.duration;
        }

        const gapDuration = chord.endBeat - gapStart;

        // 如果有足够的真空期（比如大于 1 拍），执行填音 (Fill)
        if (gapDuration >= 1.0) {
            // 根据能量决定填音的密度
            const fillNotesCount = (gapDuration >= 2.0 && energyLevel >= 6) ? 4 : 2; 
            const step = gapDuration / fillNotesCount;

            for (let i = 0; i < fillNotesCount; i++) {
                // 随机在和弦音和安全音阶中游走
                const useChordTone = PRNGManager.next() > 0.3;
                const pcPool = useChordTone ? chordTones : safeScalePcs;
                const pc = pcPool[Math.floor(PRNGManager.next() * pcPool.length)];

                notes.push({
                    pitch: pc + 72, // 高八度 C5 附近，与主旋律拉开空间，形成对话
                    onset: gapStart + i * step,
                    duration: step * 0.8, // 留一点呼吸
                    velocity: 55 + energyLevel * 4
                });
            }
        } else if (energyLevel >= 7) {
            // 没有明显真空期，但能量很高，做简单的反拍点缀 (Syncopated hits)
            const pitch = chordTones[2 % chordTones.length];
            notes.push({
                pitch: pitch + 72,
                onset: chord.startBeat + duration / 2, // 弱拍/反拍
                duration: duration / 4,
                velocity: 65
            });
        }
    }

    return notes;
  }

  // 🌟 Luis 的核心算法：平稳声部连接与 Top Note 寻路 (Smooth Voice Leading & Top Note Pathing)
  private static calculateSmoothVoicing(
    chordTones: number[], // Raw pitch classes (0-11) or relative intervals
    prevVoicing: number[] | undefined,
    playBass: boolean = false
  ): number[] {
    // 1. Normalize chord tones to pitch classes (0-11)
    const pcs = chordTones.map(p => p % 12);
    
    // 2. Generate candidate voicings (Closed position inversions)
    const candidates: number[][] = [];
    // 🌟 动态频段避让 (Dynamic Register Avoidance)
    // 如果有贝斯，钢琴底线整体上移，让出低频空间 (C3 -> G3/C4)
    const baseOctave = playBass ? 55 : 45; 
    
    for (let inversion = 0; inversion < pcs.length; inversion++) {
      const voicing: number[] = [];
      let currentPitch = baseOctave;
      
      for (let i = 0; i < pcs.length; i++) {
        const pcIndex = (inversion + i) % pcs.length;
        const targetPc = pcs[pcIndex];
        
        let pitch = currentPitch;
        while (pitch % 12 !== targetPc) {
          pitch++;
        }
        voicing.push(pitch);
        currentPitch = pitch + 1; 
      }
      
      candidates.push([...voicing]);
      // 允许向上扩展一个八度的 Voicing
      candidates.push(voicing.map(p => p + 12)); 
      // 如果没有贝斯，允许向下扩展一个八度来获得更厚实的低音
      if (!playBass) {
          candidates.push(voicing.map(p => p - 12));
      }
    }
    
    // 3. If no prevVoicing, return a default balanced voicing
    if (!prevVoicing || prevVoicing.length === 0) {
      let bestCandidate = candidates[0];
      let minDist = Infinity;
      const targetCenter = playBass ? 65 : 55; // 目标中心音高
      for (const c of candidates) {
        const avg = c.reduce((a, b) => a + b, 0) / c.length;
        const dist = Math.abs(avg - targetCenter); // Closest to targetCenter
        if (dist < minDist) {
          minDist = dist;
          bestCandidate = c;
        }
      }
      return bestCandidate;
    }
    
    // 4. Cost Function (The Core of Voice Leading)
    let bestVoicing = candidates[0];
    let minCost = Infinity;
    
    const prevTop = Math.max(...prevVoicing);
    const prevBottom = Math.min(...prevVoicing);
    
    for (const candidate of candidates) {
      let cost = 0;
      
      // A. Voice Distance Cost (声部移动距离惩罚)
      for (const note of candidate) {
        let minNoteDist = Infinity;
        for (const prevNote of prevVoicing) {
          const dist = Math.abs(note - prevNote);
          if (dist < minNoteDist) minNoteDist = dist;
        }
        cost += minNoteDist;
      }
      
      // B. Top Note Pathing Cost (Top Note 寻路惩罚)
      const candidateTop = Math.max(...candidate);
      const topDist = Math.abs(candidateTop - prevTop);
      if (topDist > 5) {
          // 惩罚大于纯四度的大跳，迫使 Top Note 形成平稳旋律线
          cost += topDist * 5.0; 
      } else {
          cost += topDist * 2.0;
      }
      
      // C. Common Tone Bonus (保持音奖励)
      let commonTones = 0;
      for (const note of candidate) {
        if (prevVoicing.includes(note)) {
          cost -= 3.0; 
          commonTones++;
        }
      }
      
      // D. Parallel Motion Penalty (同升同降惩罚)
      // 如果没有保持音，且所有声部同向移动，给予惩罚
      if (commonTones === 0) {
          const candBottom = Math.min(...candidate);
          if ((candidateTop > prevTop && candBottom > prevBottom) || 
              (candidateTop < prevTop && candBottom < prevBottom)) {
              cost += 15.0; // 强力惩罚平行移动
          }
      }
      
      // E. Bass Purity Constraint (低音纯净度约束)
      // C3 (48) 以下只允许根音或五音，防止低频浑浊
      const lowestNote = Math.min(...candidate);
      const lowestPc = lowestNote % 12;
      const rootPc = pcs[0];
      const fifthPc = pcs.length > 2 ? pcs[2] : -1;
      
      if (lowestNote < 48 && lowestPc !== rootPc && lowestPc !== fifthPc) {
        cost += 50.0; 
      }
      
      if (cost < minCost) {
        minCost = cost;
        bestVoicing = candidate;
      }
    }
    
    return bestVoicing;
  }

  public static generateChordTexture(
    chord: GeneratedChord,
    energyLevel: number,
    textureType: string,
    isSparseSection: boolean = false,
    isSectionEnd: boolean = false,
    melodyNotes: NoteData[] = [],
    nextChord?: GeneratedChord,
    style?: StyleConfig,
    prevVoicing?: number[],
    nextEnergyLevel?: number,
    pianoStyle: string = "block-chord",
    densityMultiplier: number = 1.0,
    playBass: boolean = false
  ): NoteData[] {
    const targetCenter = chord.root; 
    const rawChordTones = HarmonyCore.getChordTones(chord, targetCenter);
    
    // 🌟 应用平稳声部连接算法
    const chordTones = this.calculateSmoothVoicing(rawChordTones, prevVoicing, playBass);
    
    const notes: NoteData[] = [];
    const duration = chord.endBeat - chord.startBeat;

    if (textureType === "Rhythmic") {
      // 🌟 织体补偿：Rhythmic 律动扫弦/砸和弦
      for (let beat = chord.startBeat; beat < chord.endBeat; beat += 0.5) {
        // 1/8 note rhythm, with emphasis on downbeats
        const relativeBeat = beat - chord.startBeat;
        const isDownbeat = Math.abs(relativeBeat % 1) < 1e-6;
        const isStrongBeat = relativeBeat % 2 === 0; // 1st and 3rd beats

        // 律动补偿：第一拍和第三拍力度更大，避免机关枪感
        let velocity = 60;
        if (isStrongBeat) velocity = 95;
        else if (isDownbeat) velocity = 80;
        else velocity = 65;

        // 随机跳过一些弱拍以增加律动感
        if (!isDownbeat && PRNGManager.next() < 0.3) continue;

        for (const pitch of chordTones) {
          notes.push({
            pitch: pitch, // 已经计算好绝对音高
            onset: beat,
            duration: 0.25,
            velocity: velocity
          });
        }
      }
    } else if (textureType === "Arpeggio" || textureType === "Pulsing") {
      // 分解和弦或脉冲
      let arpIndex = 0;
      const step = 0.5 / densityMultiplier; // 默认 8 分音符，densityMultiplier=2.0 时变成 16 分音符
      const isHyperDense = densityMultiplier > 1.5;
      
      for (let beat = chord.startBeat; beat < chord.endBeat; beat += step) {
        // 🌟 Luis 的底层护航：防爆音护栏 (Polyphony Choking Prevention)
        // 对于高密度流水音，缩短物理发声时长，变成轻巧的断奏（Staccato/Marcato）
        // 让音符时长仅占网格的 80% (0.8)，强制留出缝隙，释放合成器资源
        const gateTime = isHyperDense ? step * 0.8 : step * 0.95;
        
        notes.push({
          pitch: chordTones[arpIndex % chordTones.length], // 已经计算好绝对音高
          onset: beat,
          duration: gateTime,
          velocity: textureType === "Pulsing" ? 85 : 75 // Pulsing 更强一点
        });
        arpIndex++;
      }
    } else if (textureType === "Pad") {
      // 长音铺底
      for (const pitch of chordTones) {
        notes.push({
          pitch: pitch, // 已经计算好绝对音高
          onset: chord.startBeat,
          duration: duration,
          velocity: 60
        });
      }
    } else {
      // Basic block chord
      for (const pitch of chordTones) {
        notes.push({
          pitch: pitch, // 已经计算好绝对音高
          onset: chord.startBeat,
          duration: duration,
          velocity: 70
        });
      }
    }

    return this.truncateToChordEnd(notes, chord.endBeat);
  }

  private static truncateToChordEnd(notes: NoteData[], chordEndBeat: number): NoteData[] {
    return notes.map(n => {
      if (n.onset >= chordEndBeat) return null;
      if (n.onset + n.duration > chordEndBeat) {
        return { ...n, duration: chordEndBeat - n.onset };
      }
      return n;
    }).filter(n => n !== null) as NoteData[];
  }

  private static deduplicateNotes(notes: NoteData[]): NoteData[] {
    // P-1: linear scan dedup without Set (pitch*10000+onset as numeric key)
    const seen: number[] = [];
    const result: NoteData[] = [];
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      // Encode pitch and onset into a single number for comparison
      // Use pitch * 100000 + onset * 100 to avoid collisions
      const key = n.pitch * 100000 + Math.round(n.onset * 100);
      if (seen.indexOf(key) === -1) {
        seen.push(key);
        result.push(n);
      }
    }
    return result;
  }

  public static generateRiff(
    chord: GeneratedChord,
    energyLevel: number,
    style?: StyleConfig,
  ): NoteData[] {
    return [];
  }

  public static generateVocalHarmony(
    melodyNotes: NoteData[],
    chords: GeneratedChord[],
    style: StyleConfig | undefined,
    energyLevel: number,
    tonality: Tonality
  ): NoteData[] {
    return [];
  }
}

