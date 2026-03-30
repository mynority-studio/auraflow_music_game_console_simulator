import { globalPRNG } from '../../../utils/PRNG';
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
    return result;
  }

  protected getHumanizeParams(note: NoteData, index: number, chordSize: number, isHighFirst: boolean, isRightHand: boolean, idiomPreferences?: any) {
      const pianoStyle = idiomPreferences?.pianoStyle || 'pop';
      const effectiveIndex = isHighFirst ? (chordSize - 1 - index) : index;
      
      // 琶音延迟
      let strumDelay = effectiveIndex * (globalPRNG.next() * 0.02 + 0.02); // 每根手指相差 10-20ms
      if (pianoStyle === 'jazz') strumDelay *= 1.5; // 爵士琶音更慵懒
      else if (pianoStyle === 'classical') strumDelay *= 0.5; // 古典更整齐

      let timingWobble = this.randomGaussian(0, 0.015);
      if (pianoStyle === 'jazz') timingWobble = this.randomGaussian(0.01, 0.025); // 爵士整体偏晚且更不稳
      
      const beatsPerBar = GlobalContext.currentTimeSignature[0];
      const is68 = beatsPerBar === 6;
      const beatPos = note.onset % beatsPerBar;

      // 节奏微调：正拍稍微晚一点点（慵懒），弱拍稍微提前一点点（推动感）
      if (beatPos % 1 === 0) {
          timingWobble += globalPRNG.next() * 0.03;
      } else {
          timingWobble -= globalPRNG.next() * 0.03;
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