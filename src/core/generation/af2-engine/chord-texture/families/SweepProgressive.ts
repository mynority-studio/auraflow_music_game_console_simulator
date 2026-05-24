// SweepProgressive — bass 多层时序进行 + 可选后期 chord 形态
//   Pop_Ballad_158_Sweep(三层 bass + sustained chord)
//   RnB_Classic_Soul_Arp(三层 bass + reverse arp)
import type { ChordDef } from '../../types/ChordDef';
import type { NoteEvent, SweepProgressiveParams } from '../types';
import type { Random } from '../../utils/Random';
import * as P from '../PitchPrimitives';

function resolveBassOffset(
    chord: ChordDef,
    offset: 'root' | '5th' | 'low_octave' | 'rootLow_5th',
): number {
    const bRoot = P.rootAnchor(chord);
    switch (offset) {
        case 'root':         return P.bassMidi(chord);
        case '5th':          return bRoot + 7;
        case 'low_octave':   return P.bassMidiLow(chord);
        case 'rootLow_5th':  return P.rootAnchorLow(chord) + 7;
    }
}

export function applySweepProgressive(
    chord: ChordDef,
    _nextChord: ChordDef | null,
    startBeat: number,
    duration: number,
    params: SweepProgressiveParams,
    _rng: Random,
): NoteEvent[] {
    const out: NoteEvent[] = [];
    const cM = P.chordVoicing(chord);

    // bass 多层
    for (const layer of params.bass_layers) {
        if (layer.time >= duration) continue;
        const pitch = resolveBassOffset(chord, layer.offset);
        const dur = layer.duration_mode === 'to_end'
            ? duration - layer.time
            : (layer.duration ?? 1.0);
        if (dur <= 0) continue;
        out.push({
            noteNumber: pitch,
            time: startBeat + layer.time,
            duration: dur,
            velocity: layer.velocity * 127,
            part: 'bass',
        });
    }

    // chord 后期形态
    if (params.chord_late_start < duration && cM.length > 0) {
        if (params.chord_late_pattern === 'sustained_pad') {
            for (const m of cM) {
                out.push({
                    noteNumber: m,
                    time: startBeat + params.chord_late_start,
                    duration: Math.min(1.5, duration - params.chord_late_start),
                    velocity: params.chord_late_velocity * 127,
                    part: 'accomp',
                });
            }
            if (duration > 2.5) {
                for (const m of cM) {
                    out.push({
                        noteNumber: m,
                        time: startBeat + 2.5,
                        duration: duration - 2.5,
                        velocity: (params.chord_late_velocity - 0.05) * 127,
                        part: 'accomp',
                    });
                }
            }
        } else {
            // reverse_arp_descend(RnB_Classic_Soul_Arp)
            const reversed = cM.slice().reverse();
            for (let idx = 0; idx < reversed.length; idx++) {
                const t = params.chord_late_start + idx * 0.25;
                if (t >= duration) break;
                out.push({
                    noteNumber: reversed[idx],
                    time: startBeat + t,
                    duration: 0.5,
                    velocity: params.chord_late_velocity * 127,
                    part: 'accomp',
                });
            }
        }
    }
    return out;
}
