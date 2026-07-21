import { describe, expect, it } from 'vitest';

import { dreamVoiceCcProfile, hasDocumentedPedal, mayEmitAutomaticCc } from './dreamCcCapabilities';

describe('instrumental/dreamCcCapabilities', () => {
  it('only documented acoustic-piano damper control can create an automatic PedalPlan', () => {
    const piano = dreamVoiceCcProfile(0, 'comp');
    const electricPiano = dreamVoiceCcProfile(5, 'comp');
    const vibraphone = dreamVoiceCcProfile(11, 'lead');

    expect(hasDocumentedPedal(piano)).toBe(true);
    expect(piano.automaticControllers).toEqual([11]);
    expect(mayEmitAutomaticCc(piano, 11)).toBe(true);
    expect(hasDocumentedPedal(electricPiano)).toBe(false);
    expect(hasDocumentedPedal(vibraphone)).toBe(false);
    expect(electricPiano.auditionControllers).toEqual([72, 74]);
    expect(electricPiano.blockedControllers).toContain(64);
  });

  it('sax emits CC11 expression only and blocks fake breath, damper and generic portamento', () => {
    const sax = dreamVoiceCcProfile({ bank: 8, program: 66, role: 'lead' });
    expect(sax.automaticControllers).toEqual([11]);
    expect(mayEmitAutomaticCc(sax, 11)).toBe(true);
    expect(mayEmitAutomaticCc(sax, 2)).toBe(false);
    expect(sax.blockedControllers).toEqual(expect.arrayContaining([2, 64, 65, 84]));
  });

  it('admits documented CC1 modulation only for a synth-pad voice assigned to the Pad role', () => {
    const pad = dreamVoiceCcProfile({ bank: 0, program: 89, role: 'pad' });
    const sameVoiceAsLead = dreamVoiceCcProfile({ bank: 0, program: 89, role: 'lead' });

    expect(pad.automaticControllers).toEqual([1, 11]);
    expect(mayEmitAutomaticCc(pad, 1)).toBe(true);
    expect(mayEmitAutomaticCc(sameVoiceAsLead, 1)).toBe(false);
  });

  it('drums and plucked acoustic instruments remain note/timing-driven instead of inheriting pedal or breath CC', () => {
    const drums = dreamVoiceCcProfile(0, 'drum');
    const guitar = dreamVoiceCcProfile(25, 'comp');
    expect(drums.blockedControllers).toEqual(expect.arrayContaining([2, 4, 64, 65, 84]));
    expect(guitar.blockedControllers).toEqual(expect.arrayContaining([2, 64]));
    expect(guitar.automaticControllers).toEqual([]);
  });

  it('uses the full CC0 plus Program address, so MT-32 and Organ Bass cannot inherit a GM gesture', () => {
    const mt32Remap = dreamVoiceCcProfile({ bank: 127, program: 11, role: 'lead' });
    const organBass = dreamVoiceCcProfile({ bank: 40, program: 16, role: 'bass' });
    const oboe = dreamVoiceCcProfile({ bank: 0, program: 68, role: 'lead' });

    expect(mt32Remap.pedal.kind).toBe('none');
    expect(mt32Remap.blockedControllers).toEqual(expect.arrayContaining([2, 64, 65, 84]));
    expect(organBass.pedal.kind).toBe('none');
    expect(oboe.automaticControllers).toEqual([11]);
  });
});
