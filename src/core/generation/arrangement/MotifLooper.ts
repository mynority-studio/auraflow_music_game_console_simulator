import { NoteData, GeneratedChord, Tonality } from '../types';
import { HarmonyCore } from '../composing/HarmonyCore';

export class MotifLooper {
    public static loopMotif(
        motif: NoteData[],
        chord: GeneratedChord,
        tonality: Tonality,
        targetOctave: number = 60,
        role: 'Foreground' | 'Middleground' | 'Background' = 'Middleground'
    ): NoteData[] {
        if (!motif || motif.length === 0) return [];

        // 找出 motif 最大 onset，用于计算 motif 长度（向上取整到 4 拍倍数）
        let maxMotifOnset = 0;
        for (let i = 0; i < motif.length; i++) {
            if (motif[i].onset > maxMotifOnset) maxMotifOnset = motif[i].onset;
        }
        const motifLengthBeats = Math.max(4, Math.ceil((maxMotifOnset + 1) / 4) * 4);

        // 计算 motif 平均音高，移动到目标八度时保持旋律轮廓
        let pitchSum = 0;
        for (let i = 0; i < motif.length; i++) pitchSum += motif[i].pitch;
        const avgPitch = pitchSum / motif.length;
        let octaveShift = 0;
        while (avgPitch + octaveShift < targetOctave - 6) octaveShift += 12;
        while (avgPitch + octaveShift > targetOctave + 6) octaveShift -= 12;

        // 性能优化：每个 chord 的安全音阶只算一次（hoist 到循环外）
        const safeScalePcs = HarmonyCore.getSafeScalePitches(chord, tonality);
        const chordStart = chord.startBeat;
        const chordEnd = chord.endBeat;

        const notes: NoteData[] = [];
        let currentBeat = Math.floor(chordStart / motifLengthBeats) * motifLengthBeats;

        while (currentBeat < chordEnd - 1e-6) {
            // 🌟 智能变奏逻辑 (AABA / Turnaround)
            const phraseIndex = Math.floor(currentBeat / motifLengthBeats) % 4;
            const isContrast = phraseIndex === 2;       // 'B' 段 of AABA
            const isTurnaround = phraseIndex === 3;     // 乐句末尾收束

            for (let mi = 0; mi < motif.length; mi++) {
                const n = motif[mi];
                const onset = currentBeat + (n.onset % motifLengthBeats);
                if (onset < chordStart - 1e-6 || onset >= chordEnd - 1e-6) continue;

                let pitch = n.pitch + octaveShift;

                if (isContrast) {
                    // 上行四度制造对比段，snap 后仍在调内
                    pitch += 5;
                } else if (isTurnaround && mi >= motif.length - 2) {
                    // 收束：前景/中景下行五度制造解决感，背景声部保持避免过低
                    if (role !== 'Background') pitch -= 7;
                }

                pitch = HarmonyCore.snapToScale(pitch, safeScalePcs);

                // 🌟 关键修复：duration 强制截断在 chord.endBeat 之内
                // 防止 motif 音符的 sustain 跨过和弦边界，在新和弦上仍按旧和弦的非和弦音发声
                const maxDuration = chordEnd - onset;
                const duration = n.duration > maxDuration ? maxDuration : n.duration;
                if (duration <= 1e-6) continue;

                notes.push({
                    pitch,
                    onset,
                    duration,
                    velocity: n.velocity * 0.8 // 伴奏稍弱
                });
            }
            currentBeat += motifLengthBeats;
        }

        return notes;
    }
}
