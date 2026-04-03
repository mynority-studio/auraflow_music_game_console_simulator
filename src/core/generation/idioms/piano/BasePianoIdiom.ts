import { NoteData, GeneratedChord, ChordQuality, CQ_IS_HIGH_TENSION, CQ_IS_MAJOR, CQ_IS_DOM, CQ_IS_MINOR, SectionType } from "../../types";
import { StyleId } from "../../config/StyleFlags";
import { IPianoIdiom, PianoIdiomContext } from "./IPianoIdiom";
import { HarmonyCore } from "../../composing/HarmonyCore";
import { PRNGManager } from "../../../utils/PRNG";

export abstract class BasePianoIdiom implements IPianoIdiom {
  abstract generate(ctx: PianoIdiomContext): NoteData[];

  protected getVoicedTones(ctx: PianoIdiomContext): number[] {
    const { chord, pianoStyle, prevVoicing, textureType } = ctx;

    let voicingStyle: "pop" | "jazz" | "neo-soul" | "rock" = "pop";
    const isJazz = pianoStyle === 'jazz' || pianoStyle === 'bossa';
    const isPop = pianoStyle === 'pop' || pianoStyle === 'ballad';
    const isRock = pianoStyle === 'rock';
    
    if (pianoStyle === 'neosoul') voicingStyle = "neo-soul";
    if (isPop) voicingStyle = "pop";
    if (isRock) voicingStyle = "rock";
    if (isJazz) voicingStyle = "jazz";
    
    // S-2 合规：从 ctx.keyOffset 读取（由 TextureMapper 注入），回退到 chord.keyOffset
    const keyOffset = ctx.keyOffset ?? chord.keyOffset ?? 0;

    let targetCenter = 55 - keyOffset;
    
    // 🌟 旋律避让 (Melody Avoidance): 动态调整伴奏音区
    // Remove melodyNotes logic as it's no longer available in the context
    // The piano should generate its texture independently of the lead melody

    // S-2 合规：从 ctx.activeSection 读取（由 TextureMapper 注入）
    const activeSection = ctx.activeSection ?? null;
    if (activeSection) {
        if (activeSection.type === SectionType.Intro) {
            // 🌟 二段式前奏：从高音区开始，慢慢落下来
            const progress = (chord.startBeat - activeSection.startBeat) / (activeSection.endBeat - activeSection.startBeat);
            targetCenter += 12 * (1 - progress); 
        }
    }

    let voicedTones = HarmonyCore.getSmoothVoicing(
      chord,
      prevVoicing || [],
      targetCenter,
      voicingStyle,
    );

    // Smart Voicing & Frequency Masking
    const chordTones = HarmonyCore.getChordTones(chord, 60).map(p => p % 12);
    const rootPc = chordTones[0];
    const thirdPc = chordTones.length > 1 ? chordTones[1] : -1;
    const fifthPc = chordTones.length > 2 ? chordTones[2] : (rootPc + 7) % 12;

    voicedTones = voicedTones
      .map((p) => {
        let safePitch = p;
        const pc = safePitch % 12;
        
        // 1. Low frequency masking
        if (pc !== rootPc && pc !== fifthPc) {
          while (safePitch < 48) safePitch += 12;
        } else {
          while (safePitch < 40) safePitch += 12;
        }

        // 2. High frequency masking
        if (textureType !== "Arpeggio" && safePitch >= 72) {
            if ((pc === rootPc || pc === fifthPc) && safePitch - 12 >= 40) {
                safePitch -= 12;
            } 
            else if (pc !== rootPc && pc !== fifthPc && safePitch - 12 >= 48) {
                safePitch -= 12;
            }
        }

        return safePitch;
      })
      .sort((a, b) => a - b);

    // 3. Low frequency dense interval interception
    for (let i = 0; i < voicedTones.length - 1; i++) {
        if (voicedTones[i] < 48) {
            const interval = voicedTones[i+1] - voicedTones[i];
            if (interval < 7) {
                voicedTones[i+1] += 12;
                voicedTones = voicedTones.sort((a, b) => a - b);
                i--;
            }
        }
    }

    // Melodic Key-Tone Collision Avoidance (Removed as melodyNotes is no longer available)
    // P-1 合规：数组 + includes() 替代 Set<number>
    const melodyPcsInChord: number[] = [];

    voicedTones = voicedTones.filter(p => {
        const pc = p % 12;
        if (pc === rootPc || pc === fifthPc) return true;
        if (melodyPcsInChord.includes(pc) && voicedTones.length > 2) {
            return false;
        }
        return true;
    });

    // Sakamoto's Subtraction
    const isHighTension = (CQ_IS_HIGH_TENSION & (1 << chord.quality)) !== 0;
    if (isHighTension && voicedTones.length > 3 && PRNGManager.next() < 0.7) {
      voicedTones = voicedTones.filter((p) => p % 12 !== fifthPc);
    }

    // 🌟 方案 C：无根音康平 (Rootless Comping)
    // 如果是爵士、Bossa 或 Neo-Soul 风格，并且不是极其稀疏的段落（假设有贝斯在弹根音），则强制剔除钢琴的根音
    if ((isJazz || pianoStyle === 'neosoul') && !ctx.isSparseSection && ctx.energyLevel > 2) {
        // 找到最低音
        const lowestNote = Math.min(...voicedTones);
        // 如果最低音是根音，或者随机决定剔除所有根音
        if (lowestNote % 12 === rootPc || PRNGManager.next() < 0.8) {
            voicedTones = voicedTones.filter(p => p % 12 !== rootPc);
            
            // 如果剔除根音后和弦太单薄，尝试向上叠加色彩音 (9th, 11th, 13th)
            if (voicedTones.length < 3) {
                const highestNote = Math.max(...(voicedTones.length > 0 ? voicedTones : [60]));
                if ((CQ_IS_MAJOR | CQ_IS_DOM) & (1 << chord.quality)) {
                    voicedTones.push(highestNote + 14); // Add 9th
                } else if (CQ_IS_MINOR & (1 << chord.quality)) {
                    voicedTones.push(highestNote + 14); // Add 9th
                    if (PRNGManager.next() < 0.5) voicedTones.push(highestNote + 17); // Add 11th
                }
            }
        }
    }

    return voicedTones;
  }
}
