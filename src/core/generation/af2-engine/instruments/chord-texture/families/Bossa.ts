// Bossa — clave-driven 节奏(Bossa_Piano_Arp / Bossa_Clave_Comping)
// bass 可选 2-bar root-5 循环 / simple 一击。chord 在 clave 时间点击发。
import type { ChordDef, NoteEvent, Random } from '../../../../mg-engine/musicEngine';
import type { BossaParams } from '../types';
import * as P from '../PitchPrimitives';

export function applyBossa(
    chord: ChordDef,
    _nextChord: ChordDef | null,
    startBeat: number,
    duration: number,
    params: BossaParams,
    _rng: Random,
): NoteEvent[] {
    const out: NoteEvent[] = [];
    const bM = P.bassMidi(chord);
    const cM = P.chordVoicing(chord);

    // Bass layer
    if (params.bass_layer === 'fixed_2bar_cycle') {
        const bRoot = P.rootAnchor(chord);
        for (let i = 0; i < Math.floor(duration); i += 2) {
            out.push({ noteNumber: bM, time: startBeat + i, duration: 1.5, velocity: 0.85 * 127, part: 'bass' });
            if (i + 1 < duration) {
                out.push({ noteNumber: bRoot + 7, time: startBeat + i + 1, duration: 1.0, velocity: 0.75 * 127, part: 'bass' });
            }
        }
    } else {
        // simple
        out.push({ noteNumber: bM, time: startBeat, duration, velocity: 0.8 * 127, part: 'bass' });
    }

    // Chord 在 clave 时间点
    for (const t of params.clave_points) {
        if (t < duration) {
            for (const m of cM) {
                out.push({
                    noteNumber: m,
                    time: startBeat + t,
                    duration: 0.4,
                    velocity: params.chord_velocity * 127,
                    part: 'chord',
                });
            }
        }
    }

    return out;
}
