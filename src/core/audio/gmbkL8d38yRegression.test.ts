import { describe, expect, it } from 'vitest';
import { hashSeedToInt } from '../../state/MusicGenerationSeedStore';
import { generateSong } from '../generation/newEngine/generation/GenerationController';
import { dream5504VoiceName } from '../sound/GMBK5X128Voices';
import { musicalIRToMidiEvents, ROLE_CHANNEL, roomWetFor } from './musicalIrToMidi';

describe('Dream 5504 · POP seed l8d38y', () => {
  it('keeps Electric Piano 2 on its official capital address and executes a soft electric-key touch', () => {
    const result = generateSong({
      seed: hashSeedToInt('l8d38y'),
      styleHint: 'pop',
      mood: 'build',
      targetDuration: 90,
    });
    expect(result.ir).toBeDefined();
    const ir = result.ir!;
    const lead = ir.tracks.find(track => track.role === 'lead')!;
    const bass = ir.tracks.find(track => track.role === 'bass')!;

    expect(lead).toMatchObject({ bank: 0, program: 5 });
    expect(dream5504VoiceName(lead.bank, lead.program, 'lead')).toBe('Electric Piano 2');
    expect(lead.programChanges ?? []).toEqual([]);
    expect(lead.notes.length).toBeGreaterThan(0);
    expect(Math.max(...lead.notes.map(note => note.velocity))).toBeLessThanOrEqual(103);
    expect(lead.notes.reduce((sum, note) => sum + note.velocity, 0) / lead.notes.length).toBeLessThan(90);

    // PC38 must remain Synth Bass 1 here. A style label alone must not turn it
    // into Reso SH Bass/TB303, which are separate explicit variation voices.
    expect(bass).toMatchObject({ bank: 0, program: 38 });
    expect(dream5504VoiceName(bass.bank, bass.program, 'bass')).toBe('Synth Bass 1');
  });

  it('keeps all generated volume controllers at the Firm5504 defaults', () => {
    const result = generateSong({
      seed: hashSeedToInt('l8d38y'),
      styleHint: 'pop',
      mood: 'build',
      targetDuration: 90,
    });
    const ir = result.ir!;
    const events = musicalIRToMidiEvents(ir, roomWetFor('pop'), 'pop');

    for (const track of ir.tracks) {
      expect(track.mix, track.role).toMatchObject({ volume: 100, reverb: 0, chorus: 0 });
      const channel = ROLE_CHANNEL[track.role];
      const channelEvents = events.filter(event => event.channel === channel);
      const allowed = new Set([0, 121]);
      if ((track.bank ?? 0) === 0 && [0, 1, 3].includes(track.program ?? -1)) {
        allowed.add(64);
      }
      expect(channelEvents.filter(event => event.type === 'cc').every(event => allowed.has(event.data1)), `${track.role} raw CC`).toBe(true);
      expect(channelEvents.some(event => event.type === 'cc' && [7, 11].includes(event.data1)), `${track.role} default volume/expression`).toBe(false);
      expect(channelEvents.some(event => event.type === 'cc' && [1, 10, 72, 74, 91, 93, 98, 99].includes(event.data1)), `${track.role} no unsupported shaping CC`).toBe(false);
    }

    const leadSetup = events.filter(event => event.channel === ROLE_CHANNEL.lead && event.ticks === 0);
    expect(leadSetup.slice(0, 3)).toMatchObject([
      { type: 'cc', data1: 121, data2: 0 },
      { type: 'cc', data1: 0, data2: 0 },
      { type: 'programChange', data1: 5 },
    ]);
    expect(leadSetup.some(event => event.type === 'cc' && [7, 11].includes(event.data1))).toBe(false);
    expect(events.some(event => event.type === 'cc' && [72, 74, 98, 99].includes(event.data1))).toBe(false);
  });
});
