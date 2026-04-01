import { PRNGManager } from '../../../utils/PRNG';
import { NoteData, GeneratedChord } from "../../types";
import { BaseIdiom } from "./BaseIdiom";
import { GlobalContext } from "../../GlobalContext";

export class PianoIdiom extends BaseIdiom {
  public apply(notes: NoteData[], instrumentName: string, chords: GeneratedChord[], idiomPreferences?: any): NoteData[] {
    const pianoStyle = idiomPreferences?.pianoStyle || 'pop';
    const result: NoteData[] =[];
    if (notes.length === 0) return result;

    const sorted = [...notes].sort((a, b) => a.onset - b.onset);
    const energy = GlobalContext.getCurrentEnergyLevel();

    for (let i = 0; i < sorted.length; i++) {
      let current = { ...sorted[i] };
      const nextNote = i < sorted.length - 1 ? sorted[i + 1] : null;
      
      const activeChord = chords.find(c => current.onset >= c.startBeat && current.onset < c.endBeat) || chords[0];
      const isFastNote = current.duration <= 0.25;
      
      // ==========================================
      // 🦶 核心技法 1：智能踏板 (防糊涂层)
      // ==========================================
      if (!isFastNote) {
        let pedalReleaseTime = activeChord.endBeat - 0.1;
        
        if (pedalReleaseTime > current.onset) {
          let maxDur = pedalReleaseTime - current.onset;
          
          if (nextNote && nextNote.onset - current.onset >= 1.0) {
             maxDur = Math.min(maxDur, (nextNote.onset - current.onset) - 0.25);
          }
          
          if (pianoStyle === 'cinematic') {
              // 电影配乐踏板踩得更满，延音更长
              current.duration = maxDur * 1.1;
          } else if (pianoStyle === 'jazz') {
              // 爵士踏板较少，更干脆
              current.duration = Math.min(0.8, maxDur * 0.8);
          } else {
              if (energy <= 5) current.duration = maxDur; // 慢歌踩满
              else current.duration = Math.min(1.0, maxDur); // 快歌少踩
          }
        }
      }

      // ==========================================
      // 🤲 核心技法 2：连音重叠 (Legato)
      // ==========================================
      if (nextNote && nextNote.onset > current.onset && nextNote.onset - current.onset <= 0.5) {
        let overlapBeats = 0.05; 
        if (pianoStyle === 'cinematic') overlapBeats = 0.1;
        else if (pianoStyle === 'jazz') overlapBeats = 0.02; // 爵士更断
        current.duration = Math.max(current.duration, (nextNote.onset - current.onset) + overlapBeats);
      }

      // 力度控制
      if (pianoStyle === 'jazz') {
          current.velocity = Math.min(0.85, current.velocity); // 爵士力度稍大，动态更广
      } else if (pianoStyle === 'cinematic') {
          current.velocity = Math.min(0.65, current.velocity); // 电影配乐钢琴通常更柔和克制
      } else {
          current.velocity = Math.min(0.75, current.velocity); // 流行永远克制
      }
      
      result.push(current);
    }
    // ==========================================
    // 🎹 核心技法 3：风格化伴奏织体 (Stylistic Comping)
    // ==========================================
    const finalResult: NoteData[] = [];
    const groupedByOnset = new Map<number, NoteData[]>();
    for (const note of result) {
        if (!groupedByOnset.has(note.onset)) {
            groupedByOnset.set(note.onset, []);
        }
        groupedByOnset.get(note.onset)!.push(note);
    }

    const onsets = Array.from(groupedByOnset.keys()).sort((a, b) => a - b);
    
    for (let i = 0; i < onsets.length; i++) {
        const onset = onsets[i];
        const chordNotes = groupedByOnset.get(onset)!;
        const isChord = chordNotes.length >= 3; // 至少三个音才算和弦
        
        // 爵士钢琴：加入 Grace Notes (装饰音) 或 Ghost Chords (幽灵和弦)
        if (pianoStyle === 'jazz' && isChord && energy > 4) {
            // 1. 装饰音 (Grace Notes) - 在和弦最高音下方半音，极短极弱，紧贴正拍
            if (PRNGManager.next() < 0.3) {
                const topNote = chordNotes.reduce((prev, current) => (prev.pitch > current.pitch) ? prev : current);
                finalResult.push({
                    pitch: topNote.pitch - 1, // 半音下方
                    onset: onset - 0.05, // 提前一点点
                    duration: 0.05,
                    velocity: topNote.velocity * 0.5
                });
            }
            
            // 2. 幽灵和弦 (Ghost Chords) - 在反拍或切分位置，极弱的短促和弦
            if (i < onsets.length - 1) {
                const nextOnset = onsets[i+1];
                const gap = nextOnset - onset;
                if (gap >= 1.0 && PRNGManager.next() < 0.4) {
                    const ghostOnset = onset + 0.5; // 8分音符反拍
                    chordNotes.forEach(n => {
                        finalResult.push({
                            pitch: n.pitch,
                            onset: ghostOnset,
                            duration: 0.15,
                            velocity: n.velocity * 0.4
                        });
                    });
                }
            }
        }
        
        // 流行钢琴：加入分解过渡 (Arpeggiated fills)
        if (pianoStyle === 'pop' && isChord && energy > 5) {
            if (i < onsets.length - 1) {
                const nextOnset = onsets[i+1];
                const gap = nextOnset - onset;
                if (gap >= 2.0 && PRNGManager.next() < 0.5) {
                    // 流行抒情歌常见的右手琶音过渡
                    const topNotes = chordNotes.map(n => n.pitch).sort((a, b) => b - a).slice(0, 3);
                    let fillOnset = onset + 1.0;
                    topNotes.forEach((p, idx) => {
                        finalResult.push({
                            pitch: p,
                            onset: fillOnset + idx * 0.25,
                            duration: 0.25,
                            velocity: chordNotes[0].velocity * 0.6
                        });
                    });
                }
            }
        }

        // 🌟 P2: Bossa Nova 钢琴：切分和弦 (Syncopated Chords)
        if ((pianoStyle === 'bossa' || pianoStyle === 'latin') && isChord) {
            if (i < onsets.length - 1) {
                const nextOnset = onsets[i+1];
                const gap = nextOnset - onset;
                // Bossa 常见的提前抢拍 (Anticipation)
                if (gap >= 1.0 && PRNGManager.next() < 0.6) {
                    const syncOnset = onset + 0.75; // 16分音符抢拍
                    chordNotes.forEach(n => {
                        finalResult.push({
                            pitch: n.pitch,
                            onset: syncOnset,
                            duration: 0.25,
                            velocity: n.velocity * 0.8
                        });
                    });
                }
            }
        }

        // 🌟 P2: EDM 钢琴：和弦断奏 (Staccato Chords)
        if ((pianoStyle === 'edm' || pianoStyle === 'house') && isChord) {
            // EDM 钢琴通常是短促有力的断奏
            chordNotes.forEach(n => {
                n.duration = Math.min(n.duration, 0.25); // 强制缩短时值
                n.velocity = Math.min(1.0, n.velocity * 1.2); // 增加力度
            });
            
            // 偶尔在反拍添加一个八度低音或和弦重复
            if (energy > 5 && i < onsets.length - 1) {
                const gap = onsets[i+1] - onset;
                if (gap >= 1.0 && PRNGManager.next() < 0.5) {
                    const repeatOnset = onset + 0.5; // 8分音符反拍
                    chordNotes.forEach(n => {
                        finalResult.push({
                            pitch: n.pitch,
                            onset: repeatOnset,
                            duration: 0.15,
                            velocity: n.velocity * 0.7
                        });
                    });
                }
            }
        }
        
        finalResult.push(...chordNotes);
    }
    
    return finalResult.sort((a, b) => a.onset - b.onset);
  }

  protected getHumanizeParams(note: NoteData, index: number, chordSize: number, isHighFirst: boolean, isRightHand: boolean, idiomPreferences?: any) {
      const pianoStyle = idiomPreferences?.pianoStyle || 'pop';
      const effectiveIndex = isHighFirst ? (chordSize - 1 - index) : index;
      
      // 琶音延迟
      let strumDelay = effectiveIndex * (PRNGManager.next() * 0.02 + 0.02); // 每根手指相差 10-20ms
      if (pianoStyle === 'jazz') strumDelay *= 1.5; // 爵士琶音更慵懒
      else if (pianoStyle === 'classical') strumDelay *= 0.5; // 古典更整齐

      let timingWobble = this.randomGaussian(0, 0.015);
      if (pianoStyle === 'jazz') timingWobble = this.randomGaussian(0.01, 0.025); // 爵士整体偏晚且更不稳
      
      const beatsPerBar = GlobalContext.currentTimeSignature[0];
      const is68 = beatsPerBar === 6;
      const beatPos = note.onset % beatsPerBar;

      // 节奏微调：正拍稍微晚一点点（慵懒），弱拍稍微提前一点点（推动感）
      if (beatPos % 1 === 0) {
          timingWobble += PRNGManager.next() * 0.03;
      } else {
          timingWobble -= PRNGManager.next() * 0.03;
      }

      // 强弱拍层级 (Beat Hierarchy)
      let velocityMultiplier = 1.0;
      if (beatPos === 0) velocityMultiplier *= 1.1;       // 第一拍强拍
      else if (is68 && beatPos === 3) velocityMultiplier *= 0.95; // 6/8 次强拍
      else if (!is68 && beatPos === 2) velocityMultiplier *= 0.9;  // 4/4 第三拍次强拍
      else if (beatPos % 1 !== 0) {
          velocityMultiplier *= 0.8; // 反拍或切分音略弱
          if (pianoStyle === 'jazz') velocityMultiplier *= 1.15; // 爵士强调反拍 (Syncopation)
      }

      // 力度 (Velocity)：下重上轻
      if (index === 0) velocityMultiplier *= 1.1; // 低音较重
      else if (index === chordSize - 1) velocityMultiplier *= 0.9; // 高音较轻

      // 音区配平：突出和弦的最高音 (Top Note)
      if (isRightHand && index === chordSize - 1 && chordSize > 1) {
          velocityMultiplier *= 1.15; 
      }

      let velocityWobble = this.randomGaussian(0, 0.05);
      if (pianoStyle === 'cinematic') velocityWobble = this.randomGaussian(0, 0.08); // 电影动态更大

      return { strumDelay, timingWobble, velocityWobble, velocityMultiplier };
  }

  public humanize(notes: NoteData[], swingRatio: number, swingSubdivision: number, isRightHand: boolean = false, idiomPreferences?: any): NoteData[] {
      // 先调用父类的通用人性化处理（包含 strumDelay, timingWobble, velocityWobble, swing）
      const humanized = super.humanize(notes, swingRatio, swingSubdivision, isRightHand, idiomPreferences);
      
      const pianoStyle = idiomPreferences?.pianoStyle || 'pop';

      // 钢琴专属：踏板感 (Pedal/Duration)
      humanized.forEach(note => {
          if (pianoStyle === 'cinematic') {
              note.duration *= 0.95; // 电影配乐留的空隙小
          } else if (pianoStyle === 'jazz') {
              note.duration *= 0.85; // 爵士留的空隙大，更断
          } else {
              note.duration *= 0.9; // 流行标准
          }
      });
      
      return humanized;
  }
}