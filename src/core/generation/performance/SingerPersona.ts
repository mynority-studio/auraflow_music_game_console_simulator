/**
 * 🎭 SingerPersona — 歌手性格渲染器
 * Pitch Space: ABSOLUTE（在 applyOffset 之后调用）
 *
 * 根据 persona traits 对旋律做人性化后处理：
 * - 断奏癖好（staccatoTendency）
 * - 句末叹息尾音（trailingFade）
 * - 句首转音（graceNoteProbability）
 * - 提前抢拍（syncopationPush）
 * - 萨克斯换气系统
 */
import { PRNGManager } from '../../utils/PRNG';
import { NoteData, SingerPersonaConfig, GeneratedChord, Tonality } from '../types';
import { HarmonyCore } from '../composing/HarmonyCore';

export class SingerPersona {
    public static apply(
        notes: NoteData[],
        persona: SingerPersonaConfig | null,
        chords: GeneratedChord[],
        instrumentName: string = 'Acoustic_Grand'
    ): NoteData[] {
        if (!persona || !persona.traits) {
            persona = SingerPersona.PERSONAS['Folk_Storyteller'];
        }
        if (!notes || notes.length === 0) return notes;

        // 判断是否为键盘/吉他——关闭转音和叹息
        const isPianoOrGuitar = instrumentName.includes('Piano') || instrumentName.includes('EP') ||
            instrumentName.includes('Guitar') || instrumentName.includes('Grand') ||
            instrumentName.includes('Vibraphone') || instrumentName.includes('Music_Box') ||
            instrumentName.includes('Marimba');

        const isSax = instrumentName.includes('Sax');

        const result: NoteData[] = [];
        const sorted = [...notes].sort((a, b) => a.onset - b.onset);
        let continuousPlayBeats = 0;

        for (let i = 0; i < sorted.length; i++) {
            let current = { ...sorted[i] };
            const next = i < sorted.length - 1 ? sorted[i + 1] : null;

            const breathGap = isSax ? 0.5 : 1.0;
            const isPhraseStart = result.length === 0 ||
                (current.onset - result[result.length - 1].onset - result[result.length - 1].duration >= breathGap);
            const isPhraseEnd = !next ||
                (next.onset - (current.onset + current.duration) >= breathGap);
            const isLongNote = current.duration >= 1.0;

            const activeChord = chords.find(c => current.onset >= c.startBeat && current.onset < c.endBeat) || chords[0];
            const safeTones = HarmonyCore.getSafeScalePitches(activeChord, Tonality.Major);

            // ═══════ 萨克斯专属处理 ═══════
            if (isSax) {
                if (isPhraseStart) continuousPlayBeats = 0;
                continuousPlayBeats += current.duration;

                // 强制换气
                let forcedBreath = false;
                if (continuousPlayBeats > 12 && current.duration >= 0.5) forcedBreath = true;
                else if (continuousPlayBeats > 16) forcedBreath = true;

                if (forcedBreath) {
                    current.duration = Math.min(current.duration * 0.5, 0.2);
                    continuousPlayBeats = 0;
                }

                const isEffectivePhraseEnd = isPhraseEnd || forcedBreath;

                // 句首弱起
                if (isPhraseStart) {
                    const breathDur = 0.1;
                    const startPitch = HarmonyCore.shiftDiatonic(current.pitch, safeTones, -1);
                    result.push({
                        pitch: startPitch,
                        onset: Math.max(0, current.onset - breathDur),
                        duration: breathDur + 0.05,
                        velocity: current.velocity * 0.4,
                        isGraceNote: true
                    });
                }

                // 超吹区（>=G5）下滑
                if (current.pitch >= 79 && (isEffectivePhraseEnd || isLongNote)) {
                    current.velocity = Math.min(1.0, current.velocity * 1.2);
                    const slideDur = 0.15;
                    current.duration = Math.max(0.1, current.duration - slideDur);
                    result.push({ ...current });
                    result.push({
                        pitch: current.pitch - 2,
                        onset: current.onset + current.duration,
                        duration: slideDur,
                        velocity: current.velocity * 0.3,
                        isGraceNote: true
                    });
                    continue;
                }

                // 句末气断音
                if (isEffectivePhraseEnd) {
                    current.duration = Math.max(0.1, current.duration - 0.05);
                }

                result.push(current);
                continue;
            }

            // ═══════ 通用歌手/乐器处理 ═══════

            // 1. 断奏癖好
            if (current.duration > 0.5 && PRNGManager.next() < persona.traits.staccatoTendency) {
                current.duration *= isPianoOrGuitar ? 0.8 : 0.5;
            }

            // 2. 提前抢拍
            if (current.onset % 1 === 0 && PRNGManager.next() < persona.traits.syncopationPush) {
                const pushAmount = PRNGManager.next() > 0.5 ? 0.5 : 0.25;
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

            // 3. 句首转音 — 钢琴/吉他关闭
            const graceProb = isPianoOrGuitar ? 0 : persona.traits.graceNoteProbability;
            if ((isPhraseStart || isLongNote) && PRNGManager.next() < graceProb) {
                const graceDur = 0.25;
                const gracePitch = HarmonyCore.shiftDiatonic(current.pitch, safeTones, -1);
                result.push({
                    pitch: gracePitch,
                    onset: current.onset - graceDur,
                    duration: graceDur,
                    velocity: current.velocity * 0.4,
                    isGraceNote: true
                });
                current.duration -= graceDur;
            }

            // 4. 句末叹息尾音 — 钢琴/吉他关闭
            const fadeProb = isPianoOrGuitar ? 0 : persona.traits.trailingFade;
            if (isPhraseEnd && isLongNote && PRNGManager.next() < fadeProb) {
                current.duration -= 0.25;
                result.push({ ...current });
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

            // 兜底裁切
            if (result.length > 0) {
                const prev = result[result.length - 1];
                if (prev.onset + prev.duration > current.onset) {
                    prev.duration = current.onset - prev.onset;
                }
            }

            result.push(current);
        }
        return result;
    }

    public static readonly PERSONAS: Record<string, SingerPersonaConfig> = {
        'RnB_Diva': { id: 'rnb_diva', name: 'R&B Diva', traits: { staccatoTendency: 0.8, trailingFade: 0.2, graceNoteProbability: 0.7, syncopationPush: 0.75 } },
        'Jazz_Crooner': { id: 'jazz_crooner', name: 'Jazz Crooner', traits: { staccatoTendency: 0.2, trailingFade: 0.9, graceNoteProbability: 0.4, syncopationPush: 0.6 } },
        'Folk_Storyteller': { id: 'folk_storyteller', name: 'Folk Storyteller', traits: { staccatoTendency: 0.05, trailingFade: 0.1, graceNoteProbability: 0.1, syncopationPush: 0.05 } },
        'Soul_Singer': { id: 'soul_singer', name: 'Soul Singer', traits: { staccatoTendency: 0.4, trailingFade: 0.6, graceNoteProbability: 0.8, syncopationPush: 0.8 } },
        'Electronic_Producer': { id: 'electronic_producer', name: 'Electronic Producer', traits: { staccatoTendency: 0.1, trailingFade: 0.0, graceNoteProbability: 0.0, syncopationPush: 0.0 } },
        'Cinematic_Composer': { id: 'cinematic_composer', name: 'Cinematic Composer', traits: { staccatoTendency: 0.05, trailingFade: 0.9, graceNoteProbability: 0.1, syncopationPush: 0.1 } },
    };
}
