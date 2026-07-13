#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import createCopychModule from '../components/synth/auraflow_synth/ports/wasm/copych_synth.mjs';
import { createDevicePostChain, DEFAULT_MASTER_LIFT } from '../public/copych/device_postchain.mjs';

const SR = Number(process.env.SR || 24000);
const BLOCK = 128;
const SF2 = resolve(process.env.SF2_PATH || 'public/Aura25_GM128.sf2');
const OUT_DIR = resolve(process.env.OUT_DIR || 'docs/generated/copych_source_artifact_audit');

const CASES = [
  { name: 'piano_five_note', role: 'lead', bank: 0, program: 0, channel: 0, notes: [64, 67, 71, 74, 78], offAt: 0.9, cc7: 84, velocity: 78 },
  { name: 'gu_electric_grand_five_note', role: 'comp', bank: 0, program: 5, channel: 0, notes: [64, 67, 71, 74, 78], offAt: 0.9, cc7: 80, velocity: 74 },
  { name: 'gu_chorused_fm_ep_five_note', role: 'comp', bank: 8, program: 5, channel: 0, notes: [64, 67, 71, 74, 78], offAt: 0.9, cc7: 80, velocity: 74 },
  { name: 'nylon_guitar_five_note', role: 'comp', bank: 0, program: 24, channel: 0, notes: [52, 57, 61, 64, 68], offAt: 0.9, cc7: 56, velocity: 76 },
  { name: 'folk_guitar_five_note', role: 'comp', bank: 0, program: 25, channel: 0, notes: [52, 57, 61, 64, 68], offAt: 0.9, cc7: 56, velocity: 76 },
  { name: 'acoustic_bass_five_note', role: 'bass', bank: 0, program: 32, channel: 0, notes: [40, 47, 52, 55, 59], offAt: 0.76, cc7: 84, velocity: 72 },
  { name: 'synth_bass_five_note', role: 'bass', bank: 0, program: 38, channel: 0, notes: [36, 43, 48, 51, 55], offAt: 0.76, cc7: 84, velocity: 72 },
  { name: 'baritone_sax_five_note', role: 'lead', bank: 0, program: 67, channel: 0, notes: [43, 50, 54, 57, 62], offAt: 0.9, cc7: 64, velocity: 76 },
  { name: 'warm_pad_five_note', role: 'pad', bank: 0, program: 89, channel: 0, notes: [55, 62, 67, 71, 74], offAt: 1.1, cc7: 78, velocity: 62 },
  { name: 'kalimba_five_note', role: 'lead', bank: 0, program: 108, channel: 0, notes: [64, 67, 71, 74, 78], offAt: 0.9, cc7: 84, velocity: 76 },
  { name: 'room_kit_five_hit', role: 'drum', bank: 128, program: 8, channel: 9, notes: [36, 38, 42, 46, 49], offAt: 0.26, cc7: 48, velocity: 94 },
  { name: 'tr808_kit_five_hit', role: 'drum', bank: 128, program: 25, channel: 9, notes: [36, 38, 42, 46, 49], offAt: 0.26, cc7: 90, velocity: 94 },
  { name: 'brush_kit_five_hit', role: 'drum', bank: 128, program: 40, channel: 9, notes: [36, 38, 42, 46, 49], offAt: 0.26, cc7: 90, velocity: 94 },
];

const POSTCHAIN_VARIANTS = [
  { name: 'raw', cfg: null },
  { name: 'device', cfg: { gain: true, eq: true, softclip: true, quantize: true, masterLift: DEFAULT_MASTER_LIFT } },
  { name: 'no_gain', cfg: { gain: false, eq: true, softclip: true, quantize: true, masterLift: DEFAULT_MASTER_LIFT } },
  { name: 'no_quantize', cfg: { gain: true, eq: true, softclip: true, quantize: false, masterLift: DEFAULT_MASTER_LIFT } },
  { name: 'float_no_gain_no_eq', cfg: { gain: false, eq: false, softclip: true, quantize: false, masterLift: 1 } },
];

function wavMono16(samples, sr) {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

function db(v) {
  return 20 * Math.log10(Math.max(v, 1e-12));
}

function metrics(samples) {
  let peak = 0;
  let sum2 = 0;
  let zc = 0;
  let prev = samples[0] ?? 0;
  for (const v of samples) {
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum2 += v * v;
    if ((prev < 0 && v >= 0) || (prev >= 0 && v < 0)) zc++;
    prev = v;
  }
  const rms = Math.sqrt(sum2 / Math.max(1, samples.length));
  return {
    peak: Number(peak.toFixed(6)),
    peakDbfs: Number(db(peak).toFixed(2)),
    rms: Number(rms.toFixed(6)),
    rmsDbfs: Number(db(rms).toFixed(2)),
    zeroCrossRate: Number((zc / Math.max(1, samples.length)).toFixed(5)),
  };
}

async function initSynth() {
  const M = await createCopychModule();
  const sf2 = readFileSync(SF2);
  const ptr = M._malloc(sf2.length);
  M.HEAPU8.set(sf2, ptr);
  const rc = M._copych_wasm_init(ptr, sf2.length, SR);
  M._free(ptr);
  if (rc !== 0) throw new Error(`copych init failed rc=${rc}`);
  M._copych_wasm_set_song_reverb(0.25, 0, 0, 0.7);
  M._copych_wasm_set_song_chorus(0.5, 0, 0.008);
  M._copych_wasm_set_song_delay(0.2, 0, 0);
  return M;
}

function renderRaw(M, testCase) {
  M._copych_wasm_panic();
  const ch = testCase.channel ?? 0;
  const bank = testCase.bank ?? 0;
  M._copych_wasm_cc(ch, 0, (bank >> 7) & 0x7f);
  M._copych_wasm_cc(ch, 32, bank & 0x7f);
  M._copych_wasm_program(ch, testCase.program);
  M._copych_wasm_cc(ch, 7, testCase.cc7);
  M._copych_wasm_cc(ch, 11, 112);
  M._copych_wasm_cc(ch, 64, 0);
  M._copych_wasm_cc(ch, 72, 64);
  M._copych_wasm_cc(ch, 91, 0);
  M._copych_wasm_cc(ch, 93, 0);
  M._copych_wasm_cc(ch, 95, 0);

  const seconds = 1.6;
  const totalBlocks = Math.ceil(seconds * SR / BLOCK);
  const offBlock = Math.floor((testCase.offAt * SR) / BLOCK);
  const pL = M._malloc(BLOCK * 4);
  const pR = M._malloc(BLOCK * 4);
  const out = new Float32Array(totalBlocks * BLOCK);

  let didOn = false;
  let didOff = false;
  for (let block = 0; block < totalBlocks; block++) {
    if (!didOn) {
      for (const note of testCase.notes) M._copych_wasm_note_on(ch, note, testCase.velocity);
      didOn = true;
    }
    if (!didOff && block >= offBlock) {
      for (const note of testCase.notes) M._copych_wasm_note_off(ch, note);
      didOff = true;
    }
    M._copych_wasm_render(pL, pR, BLOCK);
    const L = M.HEAPF32.subarray(pL >> 2, (pL >> 2) + BLOCK);
    const R = M.HEAPF32.subarray(pR >> 2, (pR >> 2) + BLOCK);
    for (let i = 0; i < BLOCK; i++) out[block * BLOCK + i] = (L[i] + R[i]) * 0.5;
  }

  M._free(pL);
  M._free(pR);
  return out;
}

function applyPostchain(raw, cfg) {
  if (!cfg) return raw;
  const L = new Float32Array(raw);
  const R = new Float32Array(raw);
  const chain = createDevicePostChain(SR);
  chain.set(cfg);
  for (let i = 0; i < L.length; i += BLOCK) chain.process(L.subarray(i, i + BLOCK), R.subarray(i, i + BLOCK), Math.min(BLOCK, L.length - i));
  return L;
}

const M = await initSynth();
mkdirSync(OUT_DIR, { recursive: true });

const report = [];
for (const testCase of CASES) {
  const raw = renderRaw(M, testCase);
  for (const variant of POSTCHAIN_VARIANTS) {
    const rendered = applyPostchain(raw, variant.cfg);
    const file = resolve(OUT_DIR, `${testCase.name}__${variant.name}.wav`);
    writeFileSync(file, wavMono16(rendered, SR));
    report.push({
      case: testCase.name,
      role: testCase.role,
      bank: testCase.bank,
      program: testCase.program,
      channel: testCase.channel,
      notes: testCase.notes,
      cc7: testCase.cc7,
      velocity: testCase.velocity,
      variant: variant.name,
      file,
      ...metrics(rendered),
    });
  }
}

writeFileSync(resolve(OUT_DIR, 'render_metrics.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
