// PureArp — 循环琶音(Broken_Chord / Arpeggio_Flow / Arp_Seq / Pop_Piano_Arp_16ths)
//   4 种 pattern 参数化,共享 cM 循环遍历的核心
import type { ChordDef, NoteEvent, Random } from '../../../../mg-engine/musicEngine';
import type { PureArpParams } from '../types';
import * as P from '../PitchPrimitives';
import { CHORD_RANGE } from '../../../music-theory';

export function applyPureArp(
    chord: ChordDef,
    _nextChord: ChordDef | null,
    startBeat: number,
    duration: number,
    params: PureArpParams,
    _rng: Random,
): NoteEvent[] {
    const out: NoteEvent[] = [];
    const bM = params.bass_source === 'bMLow' ? P.bassMidiLow(chord) : P.bassMidi(chord);
    const cM = P.chordVoicing(chord);

    out.push({ noteNumber: bM, time: startBeat, duration, velocity: 0.8 * 127, part: 'bass' });

    // pattern → arp pitches sequence + velocity envelope
    let pitches: number[];
    let skipStrong = false;
    let useSinEnv = false;

    switch (params.pattern) {
        case 'cyclic':
            pitches = cM.slice();
            break;
        case 'cyclic_two_octave':
            pitches = [...cM, ...cM.map(m => m + 12)].filter(m => m <= CHORD_RANGE.HIGH);
            break;
        case 'cyclic_octave_flip':
            // 第二轮 +12 八度
            pitches = [];
            for (let r = 0; r < 2; r++) {
                for (const m of cM) pitches.push(m + (r === 1 ? 12 : 0));
            }
            pitches = pitches.filter(m => m <= CHORD_RANGE.HIGH);
            break;
        case 'sin_envelope_skip_strong':
            pitches = [...cM, ...cM.map(m => m + 12)].filter(m => m <= CHORD_RANGE.HIGH);
            skipStrong = true;
            useSinEnv = true;
            break;
    }
    if (pitches.length === 0) return out;

    const totalSteps = Math.floor(duration / params.grid_step);
    for (let i = 0; i < totalSteps; i++) {
        if (skipStrong && i % 8 === 0) continue;
        const t = i * params.grid_step;
        let vel = params.velocity_base;
        if (useSinEnv) {
            vel = 0.4 + Math.sin((i / totalSteps) * Math.PI) * 0.2;
        }
        const note = pitches[i % pitches.length];
        out.push({
            noteNumber: note,
            time: startBeat + t,
            duration: params.note_duration,
            velocity: Math.max(0, Math.min(127, vel * 127)),
            part: 'accomp',
        });
    }
    return out;
}
