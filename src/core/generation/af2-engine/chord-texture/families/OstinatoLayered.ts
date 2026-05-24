// OstinatoLayered — 16 分稳态 + 偶数 step 强调 + 可选 lower 层
//   Ostinato_16s(无 lower)/ Pop_Ostinato_Rock(top + lower 交替)
import type { ChordDef } from '../../types/ChordDef';
import type { NoteEvent, OstinatoLayeredParams } from '../types';
import type { Random } from '../../utils/Random';
import * as P from '../PitchPrimitives';

export function applyOstinatoLayered(
    chord: ChordDef,
    _nextChord: ChordDef | null,
    startBeat: number,
    duration: number,
    params: OstinatoLayeredParams,
    _rng: Random,
): NoteEvent[] {
    const out: NoteEvent[] = [];
    const bM = params.bass_source === 'bMLow' ? P.bassMidiLow(chord) : P.bassMidi(chord);
    const cM = P.chordVoicing(chord);
    if (cM.length === 0) return out;

    out.push({ noteNumber: bM, time: startBeat, duration, velocity: 0.85 * 127, part: 'bass' });

    const topNote = cM[cM.length - 1];
    const lowerNotes = cM.slice(0, -1);

    const totalSteps = Math.floor(duration * 4);  // 16 分
    for (let i = 0; i < totalSteps; i++) {
        const t = i * 0.25;
        const accentBoost = (i % params.accent_step_mod === 0) ? params.accent_boost : 0;
        out.push({
            noteNumber: topNote,
            time: startBeat + t,
            duration: 0.2,
            velocity: Math.min(127, (params.top_velocity + accentBoost) * 127),
            part: 'accomp',
        });
        if (params.has_lower_layer && i % 2 === 0 && lowerNotes.length > 0 && params.lower_velocity !== undefined) {
            for (const m of lowerNotes) {
                out.push({
                    noteNumber: m,
                    time: startBeat + t,
                    duration: 0.4,
                    velocity: params.lower_velocity * 127,
                    part: 'accomp',
                });
            }
        }
    }
    return out;
}
