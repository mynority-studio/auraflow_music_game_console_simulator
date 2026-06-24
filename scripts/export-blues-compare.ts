// ============================================================
// scripts/export-blues-compare.ts —— BLUES 对比 MIDI 导出(q_r_blues_chord_contract §15 耳朵复核)
// ------------------------------------------------------------
// 为 4 个 §15 案例(大调布鲁斯强/弱 Eb、小调布鲁斯弱/强 Gb)各导出:
//   ① 试听 lead+伴奏(blues 合同/调味) ② 整编 走 A(blues) ③ control 试听(无 inputTonality,蓝音被吸走)
//   ④ control 整编。→ A/B 对比"有无布鲁斯合同"的听感。
// 同时打印每例合同审计(structuralUnsupported / bluesSeasonedChordCount / contractPassRatio)。
// 跑:npx tsx scripts/export-blues-compare.ts   输出:tmp/midi-analysis/blues/*.mid
// ============================================================
import { writeFileSync, mkdirSync } from 'node:fs';
import { generateMotifWeave } from '../src/core/generation/motifSandbox/model/motifWeaver';
import { buildAccompaniment } from '../src/core/generation/motifSandbox/model/accompaniment';
import { buildSandboxIr } from '../src/core/generation/motifSandbox/model/leadOnlyIr';
import { buildMotifSongOverride } from '../src/core/generation/motifSandbox/bridge/sandboxToOverride';
import { generateSongFromMotif } from '../src/core/generation/newEngine/generation/generateSongFromMotif';
import { musicalIRToSMF } from '../src/core/generation/newEngine/sandbox/midiFile';
import type { CapturedMidiNote, ScaleMode } from '../src/core/generation/motifSandbox/model/types';
import type { SandboxTonality } from '../src/core/generation/motifSandbox/model/sandboxScales';

const OUT = 'tmp/midi-analysis/blues';
mkdirSync(OUT, { recursive: true });
const BPM = 96, SPB = 60000 / BPM;
// (midi, onsetBeat, durBeat) → CapturedMidiNote
const note = (midi: number, on: number, dur: number): CapturedMidiNote => ({ midi, velocity: 96, onsetMs: on * SPB, durationMs: dur * SPB });

// —— 4 个 §15 案例(C 调,keyPc=0)——
interface Case { id: string; tonality: SandboxTonality; mode: ScaleMode; style: 'pop' | 'jazz'; notes: CapturedMidiNote[]; }
const CASES: Case[] = [
  // A:大调布鲁斯 + 强 Eb(beat1 长音 = 结构蓝3)
  { id: 'A-majBlues-strongEb', tonality: 'majorBlues', mode: 'major', style: 'pop',
    notes: [note(67, 0, 0.5), note(64, 0.5, 0.5), note(63, 1, 1.5), note(62, 2.5, 0.5), note(60, 3, 1)] },
  // B:大调布鲁斯 + 弱 Eb(beat1.5 短 = 经过蓝3)
  { id: 'B-majBlues-weakEb', tonality: 'majorBlues', mode: 'major', style: 'pop',
    notes: [note(60, 0, 0.5), note(62, 0.5, 0.5), note(64, 1, 0.5), note(63, 1.5, 0.25), note(62, 1.75, 0.25), note(60, 2, 1), note(67, 3, 1)] },
  // C:小调布鲁斯 + 弱 Gb(beat1.5 短 = 经过蓝5)
  { id: 'C-minBlues-weakGb', tonality: 'minorBlues', mode: 'minor', style: 'jazz',
    notes: [note(60, 0, 0.5), note(63, 0.5, 0.5), note(65, 1, 0.5), note(66, 1.5, 0.25), note(67, 1.75, 0.25), note(63, 2, 1), note(60, 3, 1)] },
  // D:小调布鲁斯 + 强 Gb(beat1 长音 = 结构蓝5)
  { id: 'D-minBlues-strongGb', tonality: 'minorBlues', mode: 'minor', style: 'jazz',
    notes: [note(67, 0, 0.5), note(65, 0.5, 0.5), note(66, 1, 1.5), note(65, 2.5, 0.5), note(63, 3, 1)] },
];

const w = (name: string, bytes: Uint8Array) => { writeFileSync(`${OUT}/${name}.mid`, Buffer.from(bytes)); return name; };

for (const c of CASES) {
  const seed = 7;
  // —— blues(合同/调味)——
  const rb = generateMotifWeave({ capturedNotes: c.notes, style: c.style, keyPc: 0, mode: c.mode, bpm: BPM, seed, inputTonality: c.tonality });
  const accB = buildAccompaniment(rb.progression, c.style, seed, rb.lead);
  w(`${c.id}.blues.preview`, musicalIRToSMF(buildSandboxIr(rb.lead, accB, rb.playbackBpm, c.style), rb.playbackBpm, c.style));
  const songB = generateSongFromMotif({ seed, styleHint: c.style, mood: 'build', targetDuration: 96 }, buildMotifSongOverride(rb, 0, c.mode));
  if (songB.ir) w(`${c.id}.blues.arranged`, musicalIRToSMF(songB.ir, songB.ir.timebase.tempoMap[0]?.bpm ?? rb.playbackBpm, c.style));

  // —— control(无 inputTonality:蓝音被吸到母调、无调味)——
  const rc = generateMotifWeave({ capturedNotes: c.notes, style: c.style, keyPc: 0, mode: c.mode, bpm: BPM, seed });
  const accC = buildAccompaniment(rc.progression, c.style, seed, rc.lead);
  w(`${c.id}.control.preview`, musicalIRToSMF(buildSandboxIr(rc.lead, accC, rc.playbackBpm, c.style), rc.playbackBpm, c.style));
  const songC = generateSongFromMotif({ seed, styleHint: c.style, mood: 'build', targetDuration: 96 }, buildMotifSongOverride(rc, 0, c.mode));
  if (songC.ir) w(`${c.id}.control.arranged`, musicalIRToSMF(songC.ir, songC.ir.timebase.tempoMap[0]?.bpm ?? rc.playbackBpm, c.style));

  const a = rb.audit;
  console.log(`\n■ ${c.id}  (${c.tonality}/${c.style})`);
  console.log(`  blues 审计: 强不支持=${a.structuralUnsupported} 弱不支持=${a.weakUnsupported} quote不支持=${a.quoteStructuralUnsupported} 调味和弦=${a.bluesSeasonedChordCount} 蓝音落地=${a.blueColorStructuralSupported} 通过=${(a.contractPassRatio * 100).toFixed(0)}%`);
  console.log(`  调味和弦: ${rb.progression.filter((p) => p.bluesSeasoned).map((p) => `${p.realRoman}@bar${Math.round(p.startBeat / 4)}(${p.realType})`).join(' ') || '(无)'}`);
  console.log(`  control 调味: ${rc.progression.filter((p) => p.bluesSeasoned).length} (应=0)`);
}
console.log(`\n✓ 导出完成 → ${OUT}/  (每例 4 文件:blues/control × preview/arranged)`);
