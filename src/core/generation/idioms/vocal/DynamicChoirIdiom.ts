import { IVocalHarmonyIdiom, VocalHarmonyContext } from "./IVocalHarmonyIdiom";
import { NoteData } from "../../types";
import { HarmonyCore } from "../../composing/HarmonyCore";
import { PRNGManager } from "../../../utils/PRNG";

export class DynamicChoirIdiom implements IVocalHarmonyIdiom {
    generate(ctx: VocalHarmonyContext): NoteData[] {
        const choirNotes: NoteData[] = [];
        const { melodyNotes, chords, energyLevel } = ctx;

        if (melodyNotes.length === 0 || chords.length === 0) return [];

        // 只有在能量较高时才启用 Choir
        if (energyLevel < 5) return [];

        // 分析主旋律的“缝隙” (Gaps)
        const gaps: { start: number; end: number }[] = [];
        for (let i = 0; i < melodyNotes.length - 1; i++) {
            const currentNote = melodyNotes[i];
            const nextNote = melodyNotes[i + 1];
            const gapStart = currentNote.onset + currentNote.duration;
            const gapEnd = nextNote.onset;
            const gapDuration = gapEnd - gapStart;

            // 如果缝隙大于 1 拍，认为是可填缝的空间
            if (gapDuration >= 1.0) {
                gaps.push({ start: gapStart, end: gapEnd });
            }
        }

        // 处理最后一个音符之后的空间
        const lastNote = melodyNotes[melodyNotes.length - 1];
        const lastChord = chords[chords.length - 1];
        const sectionEnd = lastChord.endBeat;
        if (sectionEnd - (lastNote.onset + lastNote.duration) >= 1.0) {
            gaps.push({ start: lastNote.onset + lastNote.duration, end: sectionEnd });
        }

        // 在缝隙中生成 Choir 填缝 (Fills)
        for (const gap of gaps) {
            const gapDuration = gap.end - gap.start;
            
            // 找到当前缝隙对应的和弦
            const activeChord = chords.find(c => gap.start >= c.startBeat && gap.start < c.endBeat) || chords[0];
            const chordTones = HarmonyCore.getChordTones(activeChord, 60); // C4 附近的和弦音

            // 决定填缝的节奏：长音 (Oohs/Aahs) 还是短促的节奏型
            const isLongPad = PRNGManager.next() > 0.5;

            if (isLongPad) {
                // 长音 Pad
                const padDuration = Math.min(gapDuration, 2.0); // 最长 2 拍
                const onset = gap.start + 0.25; // 稍微延迟进入
                
                // 唱 3 音和 5 音
                const pitch3 = chordTones[1] + 12; // 提高八度
                const pitch5 = chordTones[2] + 12;

                choirNotes.push({ pitch: pitch3, onset, duration: padDuration, velocity: 0.6 });
                choirNotes.push({ pitch: pitch5, onset, duration: padDuration, velocity: 0.6 });
            } else {
                // 短促节奏型 (例如 "Ah - Ah")
                const numNotes = gapDuration >= 2.0 ? 2 : 1;
                const noteDuration = 0.5;
                let currentOnset = gap.start + 0.5;

                for (let i = 0; i < numNotes; i++) {
                    const pitch = chordTones[1] + 12; // 唱 3 音
                    choirNotes.push({ pitch, onset: currentOnset, duration: noteDuration, velocity: 0.7 });
                    currentOnset += noteDuration + 0.5;
                }
            }
        }

        // 🌟 动态交互：当主旋律在唱高潮长音时，Choir 唱下方的和声垫
        for (const note of melodyNotes) {
            if (note.duration >= 2.0 && note.pitch > 70) {
                const activeChord = chords.find(c => note.onset >= c.startBeat && note.onset < c.endBeat) || chords[0];
                const chordTones = HarmonyCore.getChordTones(activeChord, 60);
                
                // Choir 唱根音和 3 音，力度较弱
                choirNotes.push({ pitch: chordTones[0], onset: note.onset, duration: note.duration, velocity: 0.5 });
                choirNotes.push({ pitch: chordTones[1], onset: note.onset, duration: note.duration, velocity: 0.5 });
            }
        }

        return choirNotes;
    }
}
