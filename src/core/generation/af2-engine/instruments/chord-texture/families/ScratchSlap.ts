// ScratchSlap — funk 抓弦 / slap bass(Funk_Guitar_Scratch / Slap_Bass_Line)
// 两种模式:offbeat_skip_strong(scratch)/ slap_anchor_points(精准 slap 点)
import type { ChordDef, NoteEvent, Random } from '../../../../mg-engine/musicEngine';
import type { ScratchSlapParams } from '../types';
import * as P from '../PitchPrimitives';

export function applyScratchSlap(
    chord: ChordDef,
    _nextChord: ChordDef | null,
    startBeat: number,
    duration: number,
    params: ScratchSlapParams,
    _rng: Random,
): NoteEvent[] {
    const out: NoteEvent[] = [];
    const bM = P.bassMidi(chord);

    if (params.pattern_kind === 'offbeat_skip_strong') {
        // Funk_Guitar_Scratch — bass on beat 0,chord at 16th offbeats(跳过强拍)
        const cM = P.chordVoicing(chord);
        out.push({ noteNumber: bM, time: startBeat, duration: 0.5, velocity: 0.8 * 127, part: 'bass' });

        const maxSteps = Math.floor(duration * 4);
        for (let i = 0; i < maxSteps; i++) {
            if (i % 4 === 0) continue;  // skip strong beats
            const t = i * 0.25;
            for (const m of cM) {
                out.push({
                    noteNumber: m,
                    time: startBeat + t,
                    duration: params.short_duration,
                    velocity: 0.4 * 127,
                    part: 'accomp',
                });
            }
        }
    } else {
        // slap_anchor_points — Slap_Bass_Line 精准 4 点
        const bMLow = P.bassMidiLow(chord);
        const bRoot = P.rootAnchor(chord);
        const slapPitches = [bMLow, bM, bRoot + 12, bM];  // 4 个 slap 音高

        for (let i = 0; i < params.points.length; i++) {
            const t = params.points[i];
            if (t < duration) {
                const vel = i === 0 ? 0.9 : (i === 1 ? 0.8 : 0.7);
                out.push({
                    noteNumber: slapPitches[i % slapPitches.length],
                    time: startBeat + t,
                    duration: params.short_duration,
                    velocity: vel * 127,
                    part: 'bass',
                });
            }
        }
    }

    return out;
}
