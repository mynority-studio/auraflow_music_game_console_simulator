import { PRNGManager } from '../../../utils/PRNG';
import { NoteData, GeneratedChord, RuntimeIdiomPreferences } from "../../types";
import { BaseIdiom } from "./BaseIdiom";

export class BassIdiom extends BaseIdiom {
  public apply(notes: NoteData[], instrumentName: string, chords: GeneratedChord[], idiomPreferences?: RuntimeIdiomPreferences): NoteData[] {
    const bassStyle = idiomPreferences?.bassStyle || 'pop';
    const result: NoteData[] = [];
    if (notes.length === 0) return result;

    const sorted = [...notes].sort((a, b) => a.onset - b.onset);

    for (let i = 0; i < sorted.length; i++) {
      let current = { ...sorted[i] };
      const nextNote = i < sorted.length - 1 ? sorted[i + 1] : null;

      const activeChord = chords.find(c => current.onset >= c.startBeat && current.onset < c.endBeat) || chords[0];
      
      // 1. 连音与断音 (Legato vs Staccato)
      const isRoot = current.pitch % 12 === activeChord.root % 12;
      const isLongNote = current.duration >= 1.0;
      
      let gap = 0.05; // 默认留一点空隙
      if (bassStyle === 'cinematic' || bassStyle === 'folk') {
          // 偏连音 (Legato)
          gap = 0.01;
      } else if (bassStyle === 'funk' || bassStyle === 'lofi') {
          // 偏断音 (Staccato)
          gap = isRoot && isLongNote ? 0.05 : 0.15; // 根音长音连一点，律动短音断开
      } else if (bassStyle === 'jazz') {
          // Walking bass 稍微连贯但有颗粒感
          gap = 0.08;
      }

      if (nextNote && nextNote.onset > current.onset) {
          const maxDur = nextNote.onset - current.onset;
          current.duration = Math.min(current.duration, maxDur - gap);
          if (current.duration < 0.1) current.duration = 0.1; // 保证最小时值
      }

      // 2. 音头与力度 (Velocity)
      // 根据用户反馈，整体调低贝斯力度
      // 根音：65-80, 经过音：55-68, 鬼音：35-50
      let baseVel = 0.75;
      if (current.velocity < 0.4) {
          // 已经是鬼音
          baseVel = 0.35 + PRNGManager.next() * 0.15; // 35-50
      } else if (isRoot) {
          baseVel = 0.65 + PRNGManager.next() * 0.15; // 65-80
      } else {
          baseVel = 0.55 + PRNGManager.next() * 0.13; // 55-68
      }

      // 风格化力度调整
      if (bassStyle === 'lofi' || bassStyle === 'folk' || bassStyle === 'cinematic') {
          baseVel *= 0.85; // 抒情/氛围类曲风再轻一点
      } else if (bassStyle === 'funk') {
          // 强弱对比极大
          if (Math.abs(current.onset % 1) < 1e-6) baseVel = Math.min(1.0, baseVel * 1.1);
          else baseVel *= 0.8;
      }

      current.velocity = Math.max(0.1, Math.min(1.0, baseVel));

      result.push(current);
    }

    return result;
  }

  protected getHumanizeParams(note: NoteData, index: number, chordSize: number, isHighFirst: boolean, isRightHand: boolean, idiomPreferences?: RuntimeIdiomPreferences) {
      const bassStyle = idiomPreferences?.bassStyle || 'pop';
      
      let timingWobble = 0;
      // safe: timeSignature is [number,number] injected by Orchestrator via idiomPrefsWithSections
      const beatsPerBar = idiomPreferences?.timeSignature?.[0] ?? 4;
      const beatPos = note.onset % beatsPerBar;

      // 节奏微人类化
      // 正拍：略微靠前 0-3ms
      // 反拍/切分：略微滞后 2-6ms
      if (Math.abs(beatPos % 1) < 1e-6) {
          timingWobble = -PRNGManager.next() * 0.003; // 提前 0-3ms
      } else {
          timingWobble = PRNGManager.next() * 0.004 + 0.002; // 滞后 2-6ms
      }

      // 风格化时间感
      if (bassStyle === 'lofi') {
          timingWobble += PRNGManager.next() * 0.01; // 稍微不稳，拖一点点
      } else if (bassStyle === 'funk') {
          timingWobble -= PRNGManager.next() * 0.002; // 稍微靠前，更弹
      }

      const velocityWobble = this.randomGaussian(0, 0.03); // 微小力度波动

      return { strumDelay: 0, timingWobble, velocityWobble, velocityMultiplier: 1.0 };
  }

  public humanize(notes: NoteData[], swingRatio: number, swingSubdivision: number, isRightHand: boolean = false, idiomPreferences?: RuntimeIdiomPreferences): NoteData[] {
      const humanized = super.humanize(notes, swingRatio, swingSubdivision, isRightHand, idiomPreferences);
      
      // 长音轻微渐弱 (模拟 CC11 掉 5-10)
      // 在 MIDI 层面，我们只能调整音符的初始 velocity，但对于长音，我们可以稍微降低它的 velocity 来模拟
      humanized.forEach(note => {
          if (note.duration >= 1.0) {
              note.velocity *= 0.95; 
          }
      });
      
      return humanized;
  }
}
