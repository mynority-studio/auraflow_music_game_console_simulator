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
  start: number;
  end: number;
  startLoop: number;
  endLoop: number;
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
  const chunk = sf2ListChildChunk(path, 'pdta', chunkName);
  const out: T[] = [];
  for (let p = 0; p + recordSize <= chunk.length; p += recordSize) out.push(readRecord(chunk, p));
  return out;
}

function sf2ListChildChunk(path: string, listKind: 'pdta' | 'sdta', chunkName: string): Buffer {
  const data = readFileSync(path);
  let pos = 12;
  while (pos + 8 <= data.length) {
    const tag = data.subarray(pos, pos + 4).toString('latin1');
    const size = data.readUInt32LE(pos + 4);
    const payloadStart = pos + 8;
    const payloadEnd = payloadStart + size;
    if (tag === 'LIST' && data.subarray(payloadStart, payloadStart + 4).toString('latin1') === listKind) {
      let child = payloadStart + 4;
      while (child + 8 <= payloadEnd) {
        const childTag = data.subarray(child, child + 4).toString('latin1');
        const childSize = data.readUInt32LE(child + 4);
        const childStart = child + 8;
        if (childTag === chunkName) {
          return data.subarray(childStart, childStart + childSize);
        }
        child += 8 + childSize + (childSize & 1);
      }
    }
    pos = payloadEnd + (size & 1);
  }
  throw new Error(`missing ${listKind}/${chunkName} chunk`);
}

function sf2SampleHeaders(path: string): Sf2SampleHeader[] {
  return sf2PdtaRecords(path, 'shdr', (data, p) => ({
    name: data.subarray(p, p + 20).toString('latin1').replace(/\0.*$/, ''),
    start: data.readUInt32LE(p + 20),
    end: data.readUInt32LE(p + 24),
    startLoop: data.readUInt32LE(p + 28),
    endLoop: data.readUInt32LE(p + 32),
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

function sf2PresetSendAmounts(path: string, program: number, bank = 0): { reverb: number[]; chorus: number[] } {
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
  const presetIndex = phdrs.findIndex((preset) => preset.bank === bank && preset.program === program);
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

interface Sf2EffectiveZone {
  sampleId: number;
  keyRange: [number, number];
  velRange: [number, number];
  attenuationCb: number;
  releaseTc: number;
  filterFcTc?: number;
}

const GEN_INITIAL_FILTER_FC = 8;
const GEN_RELEASE_VOL_ENV = 38;
const GEN_INITIAL_ATTENUATION = 48;

function signed16(v: number): number {
  return v >= 32768 ? v - 65536 : v;
}

function rangeFromGenerator(gens: Sf2Generator[], oper: number): [number, number] {
  const gen = gens.find((g) => g.oper === oper);
  return gen ? [gen.amount & 0xFF, (gen.amount >> 8) & 0xFF] : [0, 127];
}

function intersectRange(a: [number, number], b: [number, number]): [number, number] | undefined {
  const lo = Math.max(a[0], b[0]);
  const hi = Math.min(a[1], b[1]);
  return lo <= hi ? [lo, hi] : undefined;
}

function signedGeneratorTotal(oper: number, ...groups: Sf2Generator[][]): number {
  return groups
    .flat()
    .filter((gen) => gen.oper === oper)
    .reduce((sum, gen) => sum + signed16(gen.amount), 0);
}

function sf2EffectiveZones(path: string, bank: number, program: number): Sf2EffectiveZone[] {
  const GEN_KEY_RANGE = 43;
  const GEN_VEL_RANGE = 44;
  const GEN_INSTRUMENT = 41;
  const GEN_SAMPLE_ID = 53;
  const phdrs = sf2PresetHeaders(path);
  const pbags = sf2Bags(path, 'pbag');
  const pgens = sf2Generators(path, 'pgen');
  const insts = sf2Instruments(path);
  const ibags = sf2Bags(path, 'ibag');
  const igens = sf2Generators(path, 'igen');
  const presetIndex = phdrs.findIndex((preset) => preset.bank === bank && preset.program === program);
  expect(presetIndex, `bank${bank} GM${program} preset`).toBeGreaterThanOrEqual(0);

  const zones: Sf2EffectiveZone[] = [];
  let pglobal: Sf2Generator[] = [];
  const nextBag = presetIndex + 1 < phdrs.length ? phdrs[presetIndex + 1].bagIndex : pbags.length - 1;
  for (let bag = phdrs[presetIndex].bagIndex; bag < nextBag; bag++) {
    const pzone = pgens.slice(pbags[bag].genIndex, pbags[bag + 1].genIndex);
    const instGen = pzone.find((gen) => gen.oper === GEN_INSTRUMENT);
    if (!instGen) {
      pglobal = pzone;
      continue;
    }
    const pKey = intersectRange(rangeFromGenerator(pglobal, GEN_KEY_RANGE), rangeFromGenerator(pzone, GEN_KEY_RANGE));
    const pVel = intersectRange(rangeFromGenerator(pglobal, GEN_VEL_RANGE), rangeFromGenerator(pzone, GEN_VEL_RANGE));
    if (!pKey || !pVel) continue;

    let iglobal: Sf2Generator[] = [];
    for (let ibag = insts[instGen.amount].bagIndex; ibag < insts[instGen.amount + 1].bagIndex; ibag++) {
      const izone = igens.slice(ibags[ibag].genIndex, ibags[ibag + 1].genIndex);
      const sampleGen = izone.find((gen) => gen.oper === GEN_SAMPLE_ID);
      if (!sampleGen) {
        iglobal = izone;
        continue;
      }
      const iKey = intersectRange(rangeFromGenerator(iglobal, GEN_KEY_RANGE), rangeFromGenerator(izone, GEN_KEY_RANGE));
      const iVel = intersectRange(rangeFromGenerator(iglobal, GEN_VEL_RANGE), rangeFromGenerator(izone, GEN_VEL_RANGE));
      if (!iKey || !iVel) continue;
      const keyRange = intersectRange(pKey, iKey);
      const velRange = intersectRange(pVel, iVel);
      if (!keyRange || !velRange) continue;
      zones.push({
        sampleId: sampleGen.amount,
        keyRange,
        velRange,
        attenuationCb: signedGeneratorTotal(GEN_INITIAL_ATTENUATION, pglobal, pzone, iglobal, izone),
        releaseTc: signedGeneratorTotal(GEN_RELEASE_VOL_ENV, pglobal, pzone, iglobal, izone),
        filterFcTc: [...pglobal, ...pzone, ...iglobal, ...izone].find((gen) => gen.oper === GEN_INITIAL_FILTER_FC)?.amount,
      });
    }
  }
  return zones;
}

function sf2SampleRms(path: string, sample: Sf2SampleHeader): number {
  const smpl = sf2ListChildChunk(path, 'sdta', 'smpl');
  let sumSq = 0;
  const frames = Math.max(0, sample.end - sample.start);
  for (let i = sample.start; i < sample.end; i++) {
    const value = smpl.readInt16LE(i * 2) / 32768;
    sumSq += value * value;
  }
  return frames > 0 ? Math.sqrt(sumSq / frames) : 0;
}

function sf2LoopScore(path: string, sampleName: string): number {
  const sample = sf2SampleHeaders(path).find((s) => s.name === sampleName);
  expect(sample, `${sampleName} sample`).toBeTruthy();
  const smpl = sf2ListChildChunk(path, 'sdta', 'smpl');
  const at = (frame: number): number => smpl.readInt16LE(frame * 2) / 32768;
  const jump = Math.abs(at(sample!.startLoop) - at(sample!.endLoop - 1));
  const slope = Math.abs((at(sample!.startLoop + 1) - at(sample!.startLoop)) - (at(sample!.endLoop - 1) - at(sample!.endLoop - 2)));
  return jump * 4 + slope;
}

function sf2AuditionEstimatedDb(path: string, bank: number, program: number, note: number, velocity = 96): number {
  const samples = sf2SampleHeaders(path);
  const rms = new Map<number, number>();
  const zones = sf2EffectiveZones(path, bank, program)
    .filter((zone) => zone.keyRange[0] <= note && note <= zone.keyRange[1] && zone.velRange[0] <= velocity && velocity <= zone.velRange[1]);
  expect(zones.length, `bank${bank} GM${program} active zones`).toBeGreaterThan(0);
  let energy = 0;
  for (const zone of zones) {
    if (!rms.has(zone.sampleId)) rms.set(zone.sampleId, sf2SampleRms(path, samples[zone.sampleId]));
    const gain = Math.pow(10, -zone.attenuationCb / 200);
    energy += Math.pow(rms.get(zone.sampleId)! * gain, 2);
  }
  return 20 * Math.log10(Math.sqrt(energy) + 1e-9);
}

const AURA25_PITCH_AUDIT_CASES = [
  { name: '大钢琴', role: 'lead', program: 0, range: [21, 108], probes: [[0, 24], [21, 21], [60, 60], [108, 108], [127, 103]] },
  { name: 'GU Electric Grand', role: 'comp', program: 5, range: [28, 103], probes: [[0, 36], [28, 28], [64, 64], [103, 103], [127, 103]] },
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
    expect(mapMidiProgramToAura25(24, 9, 'rnb')).toBe(25);
  });

  it('keeps deleted presets out of the runtime role palette', () => {
    for (const p of [1, 4, 7, 27, 33, 34, 39, 49, 66, 80, 81, 98]) expect(isAura25Program(p)).toBe(false);
    for (const p of [8, 25, 40]) expect(isAura25Program(p, 'drum')).toBe(true);
    for (const p of [0, 7, 16, 23, 24, 31, 32, 47, 48, 49]) expect(isAura25Program(p, 'drum')).toBe(false);
    expect(isAura25Program(26, 'lead')).toBe(false);
    expect(isAura25Program(26, 'comp')).toBe(false);
    expect(isAura25Program(25, 'comp')).toBe(true);
    expect(isAura25Program(66, 'lead')).toBe(false);
    expect(isAura25Program(67, 'lead')).toBe(true);
  });

  it('keeps only Room, TR-808, and Brush bank128 drum presets in the shipped SF2', () => {
    const drumPresets = sf2PresetHeaders('public/Aura25_GM128.sf2')
      .filter((preset) => preset.bank === 128)
      .map((preset) => ({ program: preset.program, name: preset.name }));
    expect(drumPresets).toEqual([
      { program: 40, name: 'Brush' },
      { program: 25, name: 'TR 808' },
      { program: 8, name: 'Room' },
    ]);
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
  }, 20000);

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
    expect(statSync('public/Aura25_GM128.sf2').size).toBeLessThanOrEqual(1_400_000);
    expect(byPreset.get('0:25')).toMatchObject({ name: '民谣木吉他', sampleSizeBytes: 17276, sampleSizeLabel: '0.016MB' });
    expect(byPreset.get('128:8')).toMatchObject({ name: 'Room 鼓组', sampleSizeBytes: 284048, sampleSizeLabel: '0.271MB' });
    expect(byPreset.get('0:5')).toMatchObject({ name: 'GU Electric Grand', sampleSizeBytes: 332568, sampleSizeLabel: '0.317MB' });
    expect(byPreset.get('8:5')).toMatchObject({ name: 'GU Chorused FM EP', sampleSizeBytes: 231564, sampleSizeLabel: '0.221MB' });
    expect(byPreset.get('0:11')).toMatchObject({ name: '颤音琴', sampleSizeBytes: 45558, sampleSizeLabel: '0.043MB' });
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
    const path = 'public/Aura25_GM128.sf2';
    const ranges = sf2PresetSampleKeyRanges(path, 67);
    expect(Math.max(...ranges.map((range) => range[1])), `${path} GM67 high key`).toBeGreaterThanOrEqual(72);
    expect(ranges.some(([low, high]) => low <= 57 && high >= 72), `${path} GM67 top zone`).toBe(true);
  });

  it('bakes Aura25 sample header pitch roots/corrections for Vibraphone and guitar compatibility', () => {
    const samples = sf2SampleHeaders('public/Aura25_GM128.sf2');
    for (const sample of samples.filter((s) => s.name !== 'EOS')) expect(sample.sampleRate, `${sample.name} sample rate`).toBe(24000);
    const byName = new Map(samples.map((sample) => [sample.name, sample]));
    expect(byName.get('VIBE_52A')).toMatchObject({ originalPitch: 52, pitchCorrection: 0, sampleRate: 24000 });
    expect(byName.get('VIBE_64A')).toMatchObject({ originalPitch: 64, pitchCorrection: 3, sampleRate: 24000 });
    expect(byName.get('VIBE_76A')).toMatchObject({ originalPitch: 76, pitchCorrection: 6, sampleRate: 24000 });
    expect(byName.get('VIBE_88A')).toMatchObject({ originalPitch: 88, pitchCorrection: 14, sampleRate: 24000 });
    expect(byName.get('VIBE_A0A')).toMatchObject({ originalPitch: 100, pitchCorrection: 14, sampleRate: 24000 });
    expect(byName.get('N Guitar D2')).toMatchObject({ originalPitch: 61, pitchCorrection: 12, sampleRate: 24000 });
    expect(byName.get('N Guitar Gb2')).toMatchObject({ originalPitch: 65, pitchCorrection: -16, sampleRate: 24000 });
    expect(byName.get('N Guitar B2')).toMatchObject({ originalPitch: 70, pitchCorrection: -8, sampleRate: 24000 });
    expect(byName.get('N Guitar E3')).toMatchObject({ originalPitch: 74, pitchCorrection: -1, sampleRate: 24000 });
    expect(byName.get('N Guitar Ab3')).toMatchObject({ originalPitch: 78, pitchCorrection: -15, sampleRate: 24000 });
    expect(byName.get('N Guitar C4')).toMatchObject({ originalPitch: 82, pitchCorrection: -8, sampleRate: 24000 });
    expect(byName.get('N Guitar E4')).toMatchObject({ originalPitch: 86, pitchCorrection: 23, sampleRate: 24000 });
    expect(byName.get('Steel AcGtr C6')).toMatchObject({ originalPitch: 107, pitchCorrection: -22, sampleRate: 24000 });
  });

  it('replaces GM5 with GU Electric Grand and adds bounded GU Chorused FM EP', () => {
    const samples = sf2SampleHeaders('public/Aura25_GM128.sf2');
    const gm5SampleNames = new Set(sf2EffectiveZones('public/Aura25_GM128.sf2', 0, 5).map((zone) => samples[zone.sampleId].name));
    expect([...gm5SampleNames].some((name) => name.startsWith('CP-80 EP-'))).toBe(true);
    expect(gm5SampleNames).toEqual(new Set([
      'CP-80 EP-C2',
      'CP-80 EP-G2',
      'CP-80 EP-E3',
      'CP-80 EP-C4',
      'CP-80 EP-G4',
      'CP-80 EP-E5',
      'CP-80 EP-C6',
      'CP-80 EP-G6',
    ]));
    expect([...gm5SampleNames].some((name) => name.startsWith('Grand Piano-'))).toBe(false);
    expect([...gm5SampleNames].some((name) => name.startsWith('EPiano2') || name.includes('DX7 Strike') || name === 'DX7 Wave')).toBe(false);
    expect(samples.find((sample) => sample.name === 'CP-80 EP-C4')).toMatchObject({ sampleRate: 24000, originalPitch: 60, pitchCorrection: -5 });
    expect(sf2PresetSendAmounts('public/Aura25_GM128.sf2', 5)).toEqual({ reverb: [0], chorus: [0] });

    const b8Gm5SampleNames = new Set(sf2EffectiveZones('public/Aura25_GM128.sf2', 8, 5).map((zone) => samples[zone.sampleId].name));
    expect(b8Gm5SampleNames).toEqual(new Set([
      'DX7 Strike 1',
      'DX7 Strike 2',
      'DX7 Strike 3',
      'DX7 Strike 4',
      'DX7 Strike 5',
      'DX7 Strike 6',
      'DX7 Wave',
    ]));
    expect(sf2PresetSendAmounts('public/Aura25_GM128.sf2', 5, 8)).toEqual({ reverb: [0], chorus: Array(11).fill(80) });
    expect(sf2AuditionEstimatedDb('public/Aura25_GM128.sf2', 0, 5, 64)).toBeGreaterThanOrEqual(-28);
    expect(sf2AuditionEstimatedDb('public/Aura25_GM128.sf2', 8, 5, 64)).toBeGreaterThanOrEqual(-31);
  });

  it('replaces GM11 with a clean 24k Roland vibraphone instead of the old short-loop Vibes layer', () => {
    const samples = sf2SampleHeaders('public/Aura25_GM128.sf2');
    const gm11Zones = sf2EffectiveZones('public/Aura25_GM128.sf2', 0, 11);
    const gm11SampleNames = new Set(gm11Zones.map((zone) => samples[zone.sampleId].name));
    expect(gm11SampleNames).toEqual(new Set(['VIBE_52A', 'VIBE_64A', 'VIBE_76A', 'VIBE_88A', 'VIBE_A0A']));
    expect(Object.fromEntries(gm11Zones.map((zone) => [samples[zone.sampleId].name, zone.filterFcTc]))).toMatchObject({
      VIBE_52A: 11739,
      VIBE_64A: 11562,
      VIBE_76A: 11175,
      VIBE_88A: 10806,
      VIBE_A0A: 10539,
    });
    expect([...gm11SampleNames].some((name) => name === 'Vibes D6' || name === 'Vibes D4' || name === 'Vibes E3')).toBe(false);
    expect(sf2PresetSendAmounts('public/Aura25_GM128.sf2', 11)).toEqual({ reverb: [], chorus: [] });
    expect(sf2AuditionEstimatedDb('public/Aura25_GM128.sf2', 0, 11, 72)).toBeLessThanOrEqual(-25.5);
    expect(sf2AuditionEstimatedDb('public/Aura25_GM128.sf2', 0, 11, 89)).toBeLessThanOrEqual(-25.5);
    expect(sf2AuditionEstimatedDb('public/Aura25_GM128.sf2', 0, 11, 53)).toBeGreaterThanOrEqual(-31);
    expect(sf2AuditionEstimatedDb('public/Aura25_GM128.sf2', 0, 11, 72)).toBeLessThanOrEqual(-28.5);
    expect(sf2AuditionEstimatedDb('public/Aura25_GM128.sf2', 0, 11, 89)).toBeLessThanOrEqual(-29.5);
    expect(sf2AuditionEstimatedDb('public/Aura25_GM128.sf2', 0, 11, 96)).toBeLessThanOrEqual(-31.0);
  });

  it('keeps Aura25 SF2 hidden FX sends bounded for ESP32 zone-send multiplication', () => {
    const limits = [
      { program: 5, reverb: 0, chorus: 0 },
      { program: 11, reverb: 0, chorus: 0 },
      { program: 24, reverb: 16, chorus: 8 },
      { program: 25, reverb: 16, chorus: 8 },
      { program: 32, reverb: 24, chorus: 8 },
      { program: 38, reverb: 24, chorus: 8 },
      { program: 67, reverb: 70, chorus: 8 },
      { program: 89, reverb: 70, chorus: 80 },
    ];
    for (const limit of limits) {
      const sends = sf2PresetSendAmounts('public/Aura25_GM128.sf2', limit.program);
      expect(Math.max(...sends.reverb), `GM${limit.program} reverb send`).toBeLessThanOrEqual(limit.reverb);
      if (sends.chorus.length) expect(Math.max(...sends.chorus), `GM${limit.program} chorus send`).toBeLessThanOrEqual(limit.chorus);
    }
    const chorusedFm = sf2PresetSendAmounts('public/Aura25_GM128.sf2', 5, 8);
    expect(Math.max(...chorusedFm.reverb), 'bank8 GM5 reverb send').toBeLessThanOrEqual(0);
    expect(Math.max(...chorusedFm.chorus), 'bank8 GM5 chorus send').toBeLessThanOrEqual(80);
  });

  it('keeps Aura25 melodic audition loudness normalized before ESP32 mixing', () => {
    const values = AURA25_AUDITION_INSTRUMENTS
      .filter((inst) => inst.bank === 0)
      .map((inst) => ({
        name: inst.name,
        db: sf2AuditionEstimatedDb('public/Aura25_GM128.sf2', inst.bank, inst.program, inst.note),
      }));
    const loudest = Math.max(...values.map((v) => v.db));
    const quietest = Math.min(...values.map((v) => v.db));
    expect(loudest, values.map((v) => `${v.name}:${v.db.toFixed(1)}dB`).join(', ')).toBeLessThanOrEqual(-25.5);
    expect(quietest, values.map((v) => `${v.name}:${v.db.toFixed(1)}dB`).join(', ')).toBeGreaterThanOrEqual(-31);
    expect(loudest - quietest, values.map((v) => `${v.name}:${v.db.toFixed(1)}dB`).join(', ')).toBeLessThanOrEqual(5.2);
  });

  it('keeps imported GM128_6MB Room/TR-808/Brush drum kits dry and body-first at 24kHz', () => {
    for (const program of [8, 25, 40]) {
      const drumZones = sf2EffectiveZones('public/Aura25_GM128.sf2', 128, program);
      expect(drumZones.length, `bank128:${program} drum zones`).toBeGreaterThanOrEqual(40);
      expect(Math.max(...drumZones.map((zone) => zone.attenuationCb)), `bank128:${program} attenuation preserved`).toBeGreaterThanOrEqual(180);

      const sends = sf2PresetSendAmounts('public/Aura25_GM128.sf2', program, 128);
      expect(Math.max(...sends.reverb), `bank128:${program} reverb send`).toBeLessThanOrEqual(1);
      if (sends.chorus.length) expect(Math.max(...sends.chorus), `bank128:${program} chorus send`).toBeLessThanOrEqual(1);
    }

    const values = Array.from({ length: 47 }, (_, i) => i + 35)
      .map((key) => ({ key, db: sf2AuditionEstimatedDb('public/Aura25_GM128.sf2', 128, 8, key) }));
    const loudest = Math.max(...values.map((v) => v.db));
    const quietest = Math.min(...values.map((v) => v.db));
    expect(loudest - quietest, values.map((v) => `${v.key}:${v.db.toFixed(1)}dB`).join(', ')).toBeLessThanOrEqual(39);

    const byKey = new Map(values.map((v) => [v.key, v.db]));
    expect(byKey.get(36)!, 'kick').toBeGreaterThanOrEqual(-12);
    expect(byKey.get(38)!, 'snare').toBeGreaterThanOrEqual(-14);
    expect(byKey.get(42)!, 'closed hat restored below body').toBeLessThanOrEqual(-30);
    expect(byKey.get(46)!, 'open hat restored below body').toBeLessThanOrEqual(-30);
    expect(byKey.get(49)!, 'crash restored below body').toBeLessThanOrEqual(-20);
    expect(byKey.get(51)!, 'ride restored below body').toBeLessThanOrEqual(-38);
    expect(byKey.get(70)!, 'maracas restored below body').toBeLessThanOrEqual(-40);
    expect(byKey.get(36)! - byKey.get(42)!, 'kick over closed hat').toBeGreaterThanOrEqual(20);
    expect(byKey.get(38)! - byKey.get(46)!, 'snare over open hat').toBeGreaterThanOrEqual(16);
  });

  it('keeps GU Electric Grand dry at the asset layer; expression tail stays in MIDI/controller policy', () => {
    const activeAt = (program: number, note: number): Sf2EffectiveZone[] => sf2EffectiveZones('public/Aura25_GM128.sf2', 0, program)
      .filter((zone) => zone.keyRange[0] <= note && note <= zone.keyRange[1] && zone.velRange[0] <= 96 && 96 <= zone.velRange[1]);
    const pianoRelease = activeAt(0, 60).map((zone) => zone.releaseTc);
    const electricGrandRelease = activeAt(5, 64).map((zone) => zone.releaseTc);
    expect(pianoRelease.length, 'GM0 active release zones').toBeGreaterThan(0);
    expect(electricGrandRelease.length, 'GM5 active release zones').toBeGreaterThan(0);
    expect(Math.max(...pianoRelease), `piano release ${pianoRelease.join(',')}`).toBeLessThanOrEqual(150);
    expect(sf2PresetSendAmounts('public/Aura25_GM128.sf2', 5)).toEqual({ reverb: [0], chorus: [0] });
    expect(Math.max(...electricGrandRelease), `GU Electric Grand release ${electricGrandRelease.join(',')}`).toBeLessThanOrEqual(150);
  });

  it('keeps high-risk Aura25 loop boundaries smooth enough for ESP32 sustained playback', () => {
    const limits = [
      ['Acoustic Bass A31', 0.02],
      ['BariAb4', 0.02],
      ['BariC4', 0.01],
      ['BariE4', 0.01],
      ['Kalimba C3', 0.01],
      ['Kalimba C5', 0.01],
      ['N Guitar E3', 0.02],
      ['N Guitar E4', 0.03],
      ['SawBassWave C2', 0.01],
      ['SawBassWave C3', 0.01],
      ['SawBassWave F5', 0.01],
      ['SynthStrings G2', 0.01],
      ['SynthStrings D6', 0.08],
      ['VIBE_52A', 0.01],
      ['VIBE_64A', 0.01],
      ['VIBE_76A', 0.01],
      ['VIBE_88A', 0.01],
      ['VIBE_A0A', 0.01],
    ] as const;
    for (const [sample, limit] of limits) {
      expect(sf2LoopScore('public/Aura25_GM128.sf2', sample), sample).toBeLessThanOrEqual(limit);
    }
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
