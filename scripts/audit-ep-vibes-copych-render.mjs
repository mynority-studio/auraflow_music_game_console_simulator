#!/usr/bin/env node
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import createCopychModule from '../components/synth/auraflow_synth/ports/wasm/copych_synth.mjs';

const SR = 24000;
const BLOCK = 128;
const OUT_DIR = resolve('docs/generated/ep_vibes_spectral_audit');
const SF2 = resolve('public/Aura25_GM128.sf2');

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

function dispatch(M, ev) {
  if (ev.type === 'program') M._copych_wasm_program(ev.channel, ev.program);
  else if (ev.type === 'cc') M._copych_wasm_cc(ev.channel, ev.controller, ev.value);
  else if (ev.type === 'on') M._copych_wasm_note_on(ev.channel, ev.note, ev.velocity);
  else if (ev.type === 'off') M._copych_wasm_note_off(ev.channel, ev.note);
}

function rms(samples, from, to) {
  let sum = 0;
  let n = 0;
  for (let i = Math.max(0, from); i < Math.min(samples.length, to); i++) {
    sum += samples[i] * samples[i];
    n++;
  }
  return n ? Math.sqrt(sum / n) : 0;
}

async function initSynth() {
  const M = await createCopychModule();
  const sf2 = readFileSync(SF2);
  const ptr = M._malloc(sf2.length);
  M.HEAPU8.set(sf2, ptr);
  const rc = M._copych_wasm_init(ptr, sf2.length, SR);
  M._free(ptr);
  if (rc !== 0) throw new Error(`copych init failed rc=${rc}`);
  M._copych_wasm_set_song_reverb(0.25, 0.0, 0.0, 0.7);
  M._copych_wasm_set_song_chorus(0.5, 0.0, 0.008);
  M._copych_wasm_set_song_delay(0.2, 0.0, 0);
  return M;
}

function renderCase(M, name, events, seconds) {
  M._copych_wasm_panic();
  const pL = M._malloc(BLOCK * 4);
  const pR = M._malloc(BLOCK * 4);
  const totalBlocks = Math.ceil(seconds * SR / BLOCK);
  const out = new Float32Array(totalBlocks * BLOCK);
  const sorted = [...events].sort((a, b) => a.at - b.at);
  let ei = 0;
  for (let block = 0; block < totalBlocks; block++) {
    const t = block * BLOCK / SR;
    while (ei < sorted.length && sorted[ei].at <= t + 1e-9) dispatch(M, sorted[ei++]);
    M._copych_wasm_render(pL, pR, BLOCK);
    const L = M.HEAPF32.subarray(pL >> 2, (pL >> 2) + BLOCK);
    const R = M.HEAPF32.subarray(pR >> 2, (pR >> 2) + BLOCK);
    for (let i = 0; i < BLOCK; i++) out[block * BLOCK + i] = 0.5 * (L[i] + R[i]);
  }
  M._free(pL);
  M._free(pR);
  const peak = Math.max(...out.map((v) => Math.abs(v)));
  const onRms = rms(out, Math.floor(0.15 * SR), Math.floor(0.75 * SR));
  const tailRms = rms(out, Math.floor(1.05 * SR), Math.floor(1.75 * SR));
  const file = resolve(OUT_DIR, `${name}.wav`);
  writeFileSync(file, wavMono16(out, SR));
  return { name, file, seconds, peak, onRms, tailRms, tailToOnDb: 20 * Math.log10((tailRms + 1e-12) / (onRms + 1e-12)) };
}

const M = await initSynth();
mkdirSync(OUT_DIR, { recursive: true });

const cases = [
  {
    name: 'fm_ep_c4_release68',
    seconds: 2.25,
    events: [
      { at: 0, type: 'program', channel: 0, program: 5 },
      { at: 0, type: 'cc', channel: 0, controller: 7, value: 90 },
      { at: 0, type: 'cc', channel: 0, controller: 11, value: 112 },
      { at: 0, type: 'cc', channel: 0, controller: 72, value: 68 },
      { at: 0, type: 'cc', channel: 0, controller: 91, value: 0 },
      { at: 0, type: 'cc', channel: 0, controller: 93, value: 0 },
      { at: 0, type: 'on', channel: 0, note: 60, velocity: 96 },
      { at: 0.35, type: 'off', channel: 0, note: 60 },
    ],
  },
  {
    name: 'fm_ep_c4_connected_to_next',
    seconds: 2.25,
    events: [
      { at: 0, type: 'program', channel: 0, program: 5 },
      { at: 0, type: 'cc', channel: 0, controller: 7, value: 90 },
      { at: 0, type: 'cc', channel: 0, controller: 11, value: 112 },
      { at: 0, type: 'cc', channel: 0, controller: 72, value: 68 },
      { at: 0, type: 'cc', channel: 0, controller: 91, value: 0 },
      { at: 0, type: 'cc', channel: 0, controller: 93, value: 0 },
      { at: 0, type: 'on', channel: 0, note: 60, velocity: 96 },
      { at: 0.80, type: 'off', channel: 0, note: 60 },
      { at: 0.80, type: 'on', channel: 0, note: 64, velocity: 92 },
      { at: 1.15, type: 'off', channel: 0, note: 64 },
    ],
  },
  ...[72, 84, 89, 96].map((note) => ({
    name: `vibes_${note}`,
    seconds: 2.25,
    events: [
      { at: 0, type: 'program', channel: 0, program: 11 },
      { at: 0, type: 'cc', channel: 0, controller: 7, value: 86 },
      { at: 0, type: 'cc', channel: 0, controller: 11, value: 112 },
      { at: 0, type: 'cc', channel: 0, controller: 91, value: 0 },
      { at: 0, type: 'cc', channel: 0, controller: 93, value: 0 },
      { at: 0, type: 'on', channel: 0, note, velocity: 96 },
      { at: 0.80, type: 'off', channel: 0, note },
    ],
  })),
];

const metrics = cases.map((c) => renderCase(M, c.name, c.events, c.seconds));
writeFileSync(resolve(OUT_DIR, 'render_metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
console.log(JSON.stringify(metrics, null, 2));
