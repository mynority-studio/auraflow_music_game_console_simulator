import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { generateMusicSync } from '../generation/musicGeneration/MusicGenerationService';
import { musicalIRToMidiEvents } from '../audio/musicalIrToMidi';
import { DRUM } from '../generation/newEngine/knowledge/grooves';
import { fitMidiToProgramRange, playableRangeForRole } from '../generation/newEngine/knowledge/instruments';
import {
  AURA25_AUDITION_INSTRUMENTS,
  AURA25_PROGRAMS_BY_ROLE,
  isAura25Program,
  mapMidiProgramToAura25,
  mapProgramToAura25,
  type Aura25Role,
} from './Aura25Palette';

interface Sf2SampleHeader {
  name: string;
  originalPitch: number;
  pitchCorrection: number;
  sampleRate: number;
}

interface Sf2PresetHeader {
  name: string;
  bank: number;
  program: number;
  bagIndex: number;
}

interface Sf2Bag {
  genIndex: number;
}

interface Sf2Generator {
  oper: number;
  amount: number;
}

interface Sf2Instrument {
  name: string;
  bagIndex: number;
}

function sf2PdtaRecords<T>(path: string, chunkName: string, readRecord: (data: Buffer, offset: number) => T, recordSize: number): T[] {
  const data = readFileSync(path);
  let pos = 12;
  while (pos + 8 <= data.length) {
    const tag = data.subarray(pos, pos + 4).toString('latin1');
    const size = data.readUInt32LE(pos + 4);
    const payloadStart = pos + 8;
    const payloadEnd = payloadStart + size;
    if (tag === 'LIST' && data.subarray(payloadStart, payloadStart + 4).toString('latin1') === 'pdta') {
      let child = payloadStart + 4;
      while (child + 8 <= payloadEnd) {
        const childTag = data.subarray(child, child + 4).toString('latin1');
        const childSize = data.readUInt32LE(child + 4);
        const childStart = child + 8;
        if (childTag === chunkName) {
          const out: T[] = [];
          for (let p = childStart; p + recordSize <= childStart + childSize; p += recordSize) out.push(readRecord(data, p));
          return out;
        }
        child += 8 + childSize + (childSize & 1);
      }
    }
    pos = payloadEnd + (size & 1);
  }
  throw new Error(`missing pdta/${chunkName} chunk`);
}

function sf2SampleHeaders(path: string): Sf2SampleHeader[] {
  return sf2PdtaRecords(path, 'shdr', (data, p) => ({
    name: data.subarray(p, p + 20).toString('latin1').replace(/\0.*$/, ''),
    originalPitch: data.readUInt8(p + 40),
    pitchCorrection: data.readInt8(p + 41),
    sampleRate: data.readUInt32LE(p + 36),
  }), 46);
}

function sf2PresetHeaders(path: string): Sf2PresetHeader[] {
  return sf2PdtaRecords(path, 'phdr', (data, p) => ({
    name: data.subarray(p, p + 20).toString('latin1').replace(/\0.*$/, ''),
    program: data.readUInt16LE(p + 20),
    bank: data.readUInt16LE(p + 22),
    bagIndex: data.readUInt16LE(p + 24),
  }), 38).filter((preset) => preset.name !== 'EOP');
}

function sf2Bags(path: string, chunkName: 'pbag' | 'ibag'): Sf2Bag[] {
  return sf2PdtaRecords(path, chunkName, (data, p) => ({
    genIndex: data.readUInt16LE(p),
  }), 4);
}

function sf2Generators(path: string, chunkName: 'pgen' | 'igen'): Sf2Generator[] {
  return sf2PdtaRecords(path, chunkName, (data, p) => ({
    oper: data.readUInt16LE(p),
    amount: data.readUInt16LE(p + 2),
  }), 4);
}

function sf2Instruments(path: string): Sf2Instrument[] {
  return sf2PdtaRecords(path, 'inst', (data, p) => ({
    name: data.subarray(p, p + 20).toString('latin1').replace(/\0.*$/, ''),
    bagIndex: data.readUInt16LE(p + 20),
  }), 22);
}

function sf2PresetSendAmounts(path: string, program: number): { reverb: number[]; chorus: number[] } {
  const GEN_CHORUS_SEND = 15;
  const GEN_REVERB_SEND = 16;
  const GEN_INSTRUMENT = 41;
  const phdrs = sf2PresetHeaders(path);
  const pbags = sf2Bags(path, 'pbag');
  const pgens = sf2Generators(path, 'pgen');
  const insts = sf2Instruments(path);
  const ibags = sf2Bags(path, 'ibag');
  const igens = sf2Generators(path, 'igen');
  const reverb: number[] = [];
  const chorus: number[] = [];
  const instruments = new Set<number>();
  const presetIndex = phdrs.findIndex((preset) => preset.bank === 0 && preset.program === program);
  expect(presetIndex, `GM${program} preset`).toBeGreaterThanOrEqual(0);
  const nextBag = presetIndex + 1 < phdrs.length ? phdrs[presetIndex + 1].bagIndex : pbags.length - 1;
  for (let bag = phdrs[presetIndex].bagIndex; bag < nextBag; bag++) {
    for (let gi = pbags[bag].genIndex; gi < pbags[bag + 1].genIndex; gi++) {
      const gen = pgens[gi];
      if (gen.oper === GEN_REVERB_SEND) reverb.push(gen.amount);
      if (gen.oper === GEN_CHORUS_SEND) chorus.push(gen.amount);
      if (gen.oper === GEN_INSTRUMENT) instruments.add(gen.amount);
    }
  }
  for (const inst of instruments) {
    for (let bag = insts[inst].bagIndex; bag < insts[inst + 1].bagIndex; bag++) {
      for (let gi = ibags[bag].genIndex; gi < ibags[bag + 1].genIndex; gi++) {
        const gen = igens[gi];
        if (gen.oper === GEN_REVERB_SEND) reverb.push(gen.amount);
        if (gen.oper === GEN_CHORUS_SEND) chorus.push(gen.amount);
      }
    }
  }
  return { reverb, chorus };
}

function sf2PresetSampleKeyRanges(path: string, program: number): [number, number][] {
  const GEN_KEY_RANGE = 43;
  const GEN_INSTRUMENT = 41;
  const GEN_SAMPLE_ID = 53;
  const phdrs = sf2PresetHeaders(path);
  const pbags = sf2Bags(path, 'pbag');
  const pgens = sf2Generators(path, 'pgen');
  const insts = sf2Instruments(path);
  const ibags = sf2Bags(path, 'ibag');
  const igens = sf2Generators(path, 'igen');
  const instruments = new Set<number>();
  const ranges: [number, number][] = [];
  const presetIndex = phdrs.findIndex((preset) => preset.bank === 0 && preset.program === program);
  expect(presetIndex, `GM${program} preset`).toBeGreaterThanOrEqual(0);
  const nextBag = presetIndex + 1 < phdrs.length ? phdrs[presetIndex + 1].bagIndex : pbags.length - 1;
  for (let bag = phdrs[presetIndex].bagIndex; bag < nextBag; bag++) {
    for (let gi = pbags[bag].genIndex; gi < pbags[bag + 1].genIndex; gi++) {
      const gen = pgens[gi];
      if (gen.oper === GEN_INSTRUMENT) instruments.add(gen.amount);
    }
  }
  for (const inst of instruments) {
    for (let bag = insts[inst].bagIndex; bag < insts[inst + 1].bagIndex; bag++) {
      let keyRange: [number, number] | undefined;
      let hasSample = false;
      for (let gi = ibags[bag].genIndex; gi < ibags[bag + 1].genIndex; gi++) {
        const gen = igens[gi];
        if (gen.oper === GEN_KEY_RANGE) keyRange = [gen.amount & 0xFF, (gen.amount >> 8) & 0xFF];
        if (gen.oper === GEN_SAMPLE_ID) hasSample = true;
      }
      if (hasSample) ranges.push(keyRange ?? [0, 127]);
    }
  }
  return ranges;
}

const AURA25_PITCH_AUDIT_CASES = [
  { name: '大钢琴', role: 'lead', program: 0, range: [21, 108], probes: [[0, 24], [21, 21], [60, 60], [108, 108], [127, 103]] },
  { name: 'CityPop FM 电钢', role: 'comp', program: 5, range: [28, 103], probes: [[0, 36], [28, 28], [64, 64], [103, 103], [127, 103]] },
  { name: '颤音琴', role: 'lead', program: 11, range: [53, 89], probes: [[0, 60], [53, 53], [72, 72], [89, 89], [127, 79]] },
  { name: '尼龙吉他', role: 'comp', program: 24, range: [40, 88], probes: [[0, 48], [40, 40], [52, 52], [88, 88], [127, 79]] },
  { name: '民谣木吉他', role: 'comp', program: 25, range: [40, 88], probes: [[0, 48], [40, 40], [52, 52], [88, 88], [95, 83], [127, 79]] },
  { name: '原声贝斯', role: 'bass', program: 32, range: [28, 67], probes: [[0, 36], [28, 28], [40, 40], [67, 67], [127, 67]] },
  { name: '合成贝斯 1', role: 'bass', program: 38, range: [24, 60], probes: [[0, 24], [24, 24], [36, 36], [60, 60], [127, 55]] },
  { name: '上低音萨克斯', role: 'lead', program: 67, range: [36, 72], probes: [[0, 36], [36, 36], [43, 43], [50, 50], [72, 72], [82, 70], [127, 67]] },
  { name: '暖 Pad', role: 'pad', program: 89, range: [36, 96], probes: [[0, 36], [36, 36], [55, 55], [96, 96], [127, 91]] },
  { name: '卡林巴', role: 'lead', program: 108, range: [60, 88], probes: [[0, 60], [60, 60], [72, 72], [88, 88], [96, 84], [127, 79]] },
] as const;
const DRUM_MIDI_KEYS = new Set<number>(Object.values(DRUM));

describe('Aura25Palette', () => {
  it('maps missing GM programs back into the current 11-preset palette', () => {
    expect(mapProgramToAura25(2, 'lead', 'pop')).toBe(0);
    expect(mapProgramToAura25(3, 'comp', 'pop')).toBe(0);
    expect(mapProgramToAura25(73, 'lead', 'pop')).toBe(0);
    expect(mapProgramToAura25(94, 'pad', 'lofi')).toBe(89);
    expect(mapProgramToAura25(35, 'bass', 'jazz')).toBe(32);
    expect(mapProgramToAura25(26, 'lead', 'jazz')).toBe(24);
    expect(mapProgramToAura25(27, 'comp', 'pop')).toBe(25);
    expect(mapProgramToAura25(66, 'lead', 'jazz')).toBe(67);
    expect(mapProgramToAura25(66, 'lead', 'rnb')).toBe(5);
    expect(mapMidiProgramToAura25(65, 1, 'jazz')).toBe(67);
    expect(mapMidiProgramToAura25(24, 9, 'rnb')).toBe(0);
  });

  it('keeps deleted presets out of the runtime role palette', () => {
    for (const p of [1, 4, 7, 16, 27, 33, 34, 39, 48, 49, 66, 80, 81, 98]) expect(isAura25Program(p)).toBe(false);
    for (const p of [25, 40]) expect(isAura25Program(p, 'drum')).toBe(false);
    expect(isAura25Program(26, 'lead')).toBe(false);
    expect(isAura25Program(26, 'comp')).toBe(false);
    expect(isAura25Program(25, 'comp')).toBe(true);
    expect(isAura25Program(66, 'lead')).toBe(false);
    expect(isAura25Program(67, 'lead')).toBe(true);
  });

  it('keeps generated IR and MIDI program changes inside the current SF2 preset set', () => {
    const styles = ['pop', 'jazz', 'lofi', 'rnb', 'acg', 'modal'];
    for (const styleHint of styles) {
      for (let seed = 0; seed < 24; seed++) {
        const result = generateMusicSync({ seed, styleHint, mood: 'build', targetDuration: 90 });
        if (!result.ir) continue;
        for (const track of result.ir.tracks) {
          if (track.program !== undefined) {
            expect(isAura25Program(track.program, track.role)).toBe(true);
            if (track.role === 'drum') {
              for (const note of track.notes) {
                expect(DRUM_MIDI_KEYS.has(note.pitch as number), `${styleHint} seed${seed} drum MIDI ${note.pitch}`).toBe(true);
              }
            } else {
              const [lo, hi] = playableRangeForRole(track.role, track.program);
              for (const note of track.notes) {
                expect(note.pitch, `${styleHint} seed${seed} ${track.role} GM${track.program}`).toBeGreaterThanOrEqual(lo);
                expect(note.pitch, `${styleHint} seed${seed} ${track.role} GM${track.program}`).toBeLessThanOrEqual(hi);
              }
            }
          }
          for (const pc of track.programChanges ?? []) expect(isAura25Program(pc.program, track.role)).toBe(true);
        }
        for (const ev of musicalIRToMidiEvents(result.ir)) {
          if (ev.type !== 'programChange') continue;
          const role = ev.channel === 9 ? 'drum'
            : ev.channel === 3 ? 'bass'
              : ev.channel === 2 ? 'comp'
                : ev.channel === 4 ? 'pad'
                  : ev.channel === 1 ? 'lead'
                    : undefined;
          expect(isAura25Program(ev.data1, role)).toBe(true);
        }
      }
    }
  });

  it('audits every Aura25 SF2 preset and MIDI pitch-fitting case one by one', () => {
    const sf2Presets = new Set(sf2PresetHeaders('public/Aura25_GM128.sf2').map((preset) => `${preset.bank}:${preset.program}`));
    for (const inst of AURA25_AUDITION_INSTRUMENTS) {
      expect(sf2Presets.has(`${inst.bank}:${inst.program}`), `${inst.name} SF2 preset`).toBe(true);
      expect(isAura25Program(inst.program, inst.role)).toBe(true);
      expect(inst.sampleSizeBytes, `${inst.name} sample size bytes`).toBeGreaterThan(0);
      expect(inst.sampleSizeLabel, `${inst.name} sample size label`).toMatch(/^\d+\.\d{3}MB$/);
    }

    const auditedPairs = new Set<string>();
    for (const c of AURA25_PITCH_AUDIT_CASES) {
      const audition = AURA25_AUDITION_INSTRUMENTS.find((inst) => inst.role === c.role && inst.program === c.program);
      expect(audition?.name, `${c.role} GM${c.program}`).toBe(c.name);
      expect(playableRangeForRole(c.role, c.program)).toEqual(c.range);
      expect(fitMidiToProgramRange(audition!.note, c.role, c.program), `${c.name} audition note`).toBe(audition!.note);
      for (const [input, expected] of c.probes) {
        expect(fitMidiToProgramRange(input, c.role, c.program), `${c.name} MIDI ${input}`).toBe(expected);
      }
      auditedPairs.add(`${c.role}:${c.program}`);
    }

    for (const [role, programs] of Object.entries(AURA25_PROGRAMS_BY_ROLE) as [Aura25Role, readonly number[]][]) {
      if (role === 'drum') continue;
      for (const program of programs) {
        const [lo, hi] = playableRangeForRole(role, program);
        for (const input of [0, lo - 12, lo, Math.round((lo + hi) / 2), hi, hi + 12, 127]) {
          const fitted = fitMidiToProgramRange(input, role, program);
          expect(fitted, `${role} GM${program} MIDI ${input}`).toBeGreaterThanOrEqual(lo);
          expect(fitted, `${role} GM${program} MIDI ${input}`).toBeLessThanOrEqual(hi);
        }
        auditedPairs.add(`${role}:${program}`);
      }
    }

    const expectedPairs = Object.entries(AURA25_PROGRAMS_BY_ROLE)
      .flatMap(([role, programs]) => role === 'drum' ? [] : programs.map((program) => `${role}:${program}`))
      .sort();
    expect([...auditedPairs].sort()).toEqual(expectedPairs);
  });

  it('labels audition presets with their referenced sample footprint', () => {
    const byPreset = new Map(AURA25_AUDITION_INSTRUMENTS.map((inst) => [`${inst.bank}:${inst.program}`, inst]));
    expect(statSync('public/Aura25_GM128.sf2').size).toBeLessThanOrEqual(1.3 * 1024 * 1024);
    expect(byPreset.get('0:25')).toMatchObject({ name: '民谣木吉他', sampleSizeBytes: 341680, sampleSizeLabel: '0.326MB' });
    expect(byPreset.get('128:0')).toMatchObject({ name: '标准鼓组', sampleSizeBytes: 276608, sampleSizeLabel: '0.264MB' });
    expect(byPreset.get('0:5')).toMatchObject({ name: 'CityPop FM 电钢', sampleSizeBytes: 231564, sampleSizeLabel: '0.221MB' });
    expect(byPreset.get('0:0')).toMatchObject({ name: '大钢琴', sampleSizeBytes: 197928, sampleSizeLabel: '0.189MB' });
  });

  it('keeps generated Baritone Sax lead inside the realistic lead range', () => {
    let sawBaritoneSax = false;
    for (let seed = 0; seed < 24; seed++) {
      const result = generateMusicSync({ seed, styleHint: 'jazz', mood: 'build', targetDuration: 90 });
      const lead = result.ir?.tracks.find((track) => track.role === 'lead');
      if (!lead || lead.program !== 67) continue;
      sawBaritoneSax = true;
      for (const note of lead.notes) {
        expect(note.pitch, `seed ${seed} sax note`).toBeGreaterThanOrEqual(36);
        expect(note.pitch, `seed ${seed} sax note`).toBeLessThanOrEqual(72);
      }
    }
    expect(sawBaritoneSax).toBe(true);
  });

  it('keeps jazz pa9ded Baritone Sax stable: low register, no CC1 vibrato, no chorus detune', () => {
    const result = generateMusicSync({ seed: 3297843867, styleHint: 'jazz', mood: 'build', targetDuration: 120, key: 'C' });
    const lead = result.ir?.tracks.find((track) => track.role === 'lead');
    expect(lead?.program).toBe(67);
    expect(Math.max(...lead!.notes.map((note) => note.pitch as number))).toBeLessThanOrEqual(72);
    expect(Math.min(...lead!.notes.map((note) => note.pitch as number))).toBeGreaterThanOrEqual(36);
    expect((lead!.ccEvents ?? []).some((cc) => cc.controller === 1)).toBe(false);
    expect(lead!.mix?.chorus).toBe(0);
    for (const mix of lead!.mixChanges ?? []) expect(mix.mix.chorus).toBe(0);
    const report = result.report as { findings: { location: { trackRole: string } }[] };
    expect(report.findings.filter((finding) => finding.location.trackRole === 'lead')).toEqual([]);
  });

  it('keeps runtime Baritone Sax SF2 zones covering the generated lead range', () => {
    for (const path of ['public/Aura25_GM128.sf2', 'public/Aura25_GM128_generaluser_folkguitar_24k_locked.sf2']) {
      const ranges = sf2PresetSampleKeyRanges(path, 67);
      expect(Math.max(...ranges.map((range) => range[1])), `${path} GM67 high key`).toBeGreaterThanOrEqual(72);
      expect(ranges.some(([low, high]) => low <= 57 && high >= 72), `${path} GM67 top zone`).toBe(true);
    }
  });

  it('bakes Aura25 sample header pitch roots/corrections for Vibraphone and Folk Guitar compatibility', () => {
    const samples = sf2SampleHeaders('public/Aura25_GM128.sf2');
    for (const sample of samples.filter((s) => s.name !== 'EOS')) expect(sample.sampleRate, `${sample.name} sample rate`).toBe(24000);
    const byName = new Map(samples.map((sample) => [sample.name, sample]));
    expect(byName.get('Vibes E3')).toMatchObject({ originalPitch: 75, pitchCorrection: -43 });
    expect(byName.get('Vibes D4')).toMatchObject({ originalPitch: 85, pitchCorrection: 13 });
    expect(byName.get('Vibes D6')).toMatchObject({ originalPitch: 109, pitchCorrection: 13 });
    expect(byName.get('Steel Guitar-E3')).toMatchObject({ originalPitch: 40, pitchCorrection: -5, sampleRate: 24000 });
    expect(byName.get('Steel Guitar-A3')).toMatchObject({ originalPitch: 45, pitchCorrection: 1, sampleRate: 24000 });
    expect(byName.get('Steel Guitar-D4')).toMatchObject({ originalPitch: 50, pitchCorrection: 0, sampleRate: 24000 });
    expect(byName.get('Steel Guitar-G4')).toMatchObject({ originalPitch: 55, pitchCorrection: -2, sampleRate: 24000 });
    expect(byName.get('Steel Guitar-B4')).toMatchObject({ originalPitch: 59, pitchCorrection: 0, sampleRate: 24000 });
    expect(byName.get('Steel Guitar-E5')).toMatchObject({ originalPitch: 64, pitchCorrection: -1, sampleRate: 24000 });
    expect(byName.get('Steel Guitar-G5')).toMatchObject({ originalPitch: 67, pitchCorrection: 1, sampleRate: 24000 });
    expect(byName.get('Steel Guitar-A#5')).toMatchObject({ originalPitch: 70, pitchCorrection: 1, sampleRate: 24000 });
    expect(byName.get('Steel Guitar-C#6')).toMatchObject({ originalPitch: 73, pitchCorrection: 7, sampleRate: 24000 });
    expect(byName.get('Steel Guitar-E6')).toMatchObject({ originalPitch: 76, pitchCorrection: 2, sampleRate: 24000 });
  });

  it('keeps Aura25 guitar preset/zone FX sends dry enough for COMP strums', () => {
    for (const program of [24, 25]) {
      const sends = sf2PresetSendAmounts('public/Aura25_GM128.sf2', program);
      expect(sends.reverb.length, `GM${program} has audited reverb sends`).toBeGreaterThan(0);
      expect(Math.max(...sends.reverb), `GM${program} reverb send`).toBeLessThanOrEqual(16);
      if (sends.chorus.length) expect(Math.max(...sends.chorus), `GM${program} chorus send`).toBeLessThanOrEqual(8);
    }
  });
});
