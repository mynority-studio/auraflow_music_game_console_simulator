// Build one audition-only delta on top of the immutable full-v4 score.
// This script never defines, edits, approves or product-routes a fixed score.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { parseSMF } from '../src/core/audio/smfParser';
import {
  canonicalVideoReplicaApprovalPayload,
  VIDEO_REPLICA_APPROVAL_CANONICALIZATION,
} from '../src/core/generation/newEngine/videoReplica/VideoReplicaApproval';
import { compileVideoReplicaScore } from '../src/core/generation/newEngine/videoReplica/VideoReplicaScore';
import { TAKE_FIVE_FULL_CURATION_CANDIDATE_V4 } from '../src/core/generation/newEngine/videoReplica/takeFiveFullCuration';
import { videoReplicaToSMF } from '../src/core/generation/newEngine/videoReplica/videoReplicaMidi';
import {
  buildTakeFiveF3IsolationIr,
  TAKE_FIVE_F3_ISOLATION_DELTA,
} from './takeFiveF3Isolation';

interface Options {
  baseDir: string;
  outputDir: string;
  soundFont: string;
}

function readOptions(): Options {
  const values = new Map<string, string>();
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('Usage: --sf2 <soundfont.sf2> [--base-dir <v4-directory>] [--output-dir <directory>]');
    }
    values.set(key, value);
  }
  const soundFont = values.get('--sf2');
  if (!soundFont) throw new Error('Missing required --sf2 <soundfont.sf2>');
  return {
    baseDir: resolve(values.get('--base-dir') ?? 'tmp/video-replica/take-five-full-curation-v4'),
    outputDir: resolve(
      values.get('--output-dir') ?? 'tmp/video-replica/auditions/take-five-f3-isolation',
    ),
    soundFont: resolve(soundFont),
  };
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function requireBytes(path: string, description: string): Buffer {
  if (!existsSync(path)) throw new Error(`Missing ${description}: ${path}`);
  return readFileSync(path);
}

function commandVersion(command: string, args: readonly string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) return 'unavailable';
  return result.stdout.trim().split('\n')[0] ?? 'unknown';
}

function renderMidi(rendererPath: string, midiPath: string, soundFont: string, outputPath: string): void {
  const result = spawnSync('swift', [
    rendererPath,
    '--midi', midiPath,
    '--sf2', soundFont,
    '--out', outputPath,
    '--tail', '0',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Renderer failed (${result.status}): ${result.stderr || result.stdout}`);
  }
}

function noteKeys(bytes: Uint8Array, type: 'noteOn' | 'noteOff'): string[] {
  return parseSMF(bytes).events
    .filter((event) => event.type === type)
    .map((event) => [event.channel, event.ticks, event.data1, event.data2].join('|'))
    .sort();
}

function multisetDelta(after: readonly string[], before: readonly string[]): string[] {
  const remaining = new Map<string, number>();
  for (const value of before) remaining.set(value, (remaining.get(value) ?? 0) + 1);
  const additions: string[] = [];
  for (const value of after) {
    const count = remaining.get(value) ?? 0;
    if (count > 0) remaining.set(value, count - 1);
    else additions.push(value);
  }
  const missing = [...remaining.entries()].flatMap(([value, count]) => Array(count).fill(value));
  if (missing.length > 0) throw new Error(`Audition variant removed base MIDI events: ${missing.join(', ')}`);
  return additions;
}

const options = readOptions();
const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V4;
const rendererPath = resolve('scripts/render-midi-to-wav.swift');
const baseMidiPath = resolve(options.baseDir, 'take-five-full-curation-v4.mid');
const baseApprovalPath = resolve(options.baseDir, 'take-five-full-curation-v4.approval-canonical.jsonl');
const variantId = 'take-five-full-v4-f3-43288-isolation';
const variantMidiPath = resolve(options.outputDir, `${variantId}.mid`);
const variantWavPath = resolve(options.outputDir, `${variantId}.wav`);
const variantPayloadPath = resolve(options.outputDir, `${variantId}.audition-canonical.json`);
const provenancePath = resolve(options.outputDir, `${variantId}.render-provenance.json`);

const detectorAmplitude = 0.26701903343200684;
const auditionDelta = TAKE_FIVE_F3_ISOLATION_DELTA;

const approvalPayload = canonicalVideoReplicaApprovalPayload(score);
const approvalSha256Before = sha256Bytes(Buffer.from(approvalPayload));
const storedApprovalBytes = requireBytes(baseApprovalPath, 'full-v4 approval payload');
if (!storedApprovalBytes.equals(Buffer.from(approvalPayload))) {
  throw new Error('Full-v4 approval payload is stale before building the isolation variant');
}

const { ir: baseIr } = compileVideoReplicaScore(score);
const expectedBaseMidiBytes = Buffer.from(videoReplicaToSMF(baseIr, score.source.bpm));
const storedBaseMidiBytes = requireBytes(baseMidiPath, 'full-v4 MIDI');
if (!storedBaseMidiBytes.equals(expectedBaseMidiBytes)) {
  throw new Error('Full-v4 MIDI is stale before building the isolation variant');
}
if (score.notes.some((note) => (
  note.performedStartTick === auditionDelta.performedStartTick && note.midi === auditionDelta.midi
))) {
  throw new Error('The audition-only F3 unexpectedly already exists in the fixed score');
}

const variantIr = buildTakeFiveF3IsolationIr(baseIr);
const variantMidiBytes = Buffer.from(videoReplicaToSMF(variantIr, score.source.bpm));

const baseParsed = parseSMF(expectedBaseMidiBytes);
const variantParsed = parseSMF(variantMidiBytes);
if (baseParsed.noteCount !== 534 || variantParsed.noteCount !== 535) {
  throw new Error(`Isolation note-count invariant failed: base=${baseParsed.noteCount}, variant=${variantParsed.noteCount}`);
}
const addedOns = multisetDelta(noteKeys(variantMidiBytes, 'noteOn'), noteKeys(expectedBaseMidiBytes, 'noteOn'));
const addedOffs = multisetDelta(noteKeys(variantMidiBytes, 'noteOff'), noteKeys(expectedBaseMidiBytes, 'noteOff'));
if (JSON.stringify(addedOns) !== JSON.stringify(['2|43288|53|55'])
  || JSON.stringify(addedOffs) !== JSON.stringify(['2|43455|53|0'])) {
  throw new Error(`Isolation MIDI delta is not exactly one F3: on=${addedOns.join(',')} off=${addedOffs.join(',')}`);
}

const variantCanonical = {
  schemaVersion: 1,
  kind: 'video-replica-audition-only-delta',
  id: variantId,
  authority: {
    fixedScoreEffect: 'none',
    productEffect: 'none',
    approvalEffect: 'none',
    extractionEffect: 'none',
  },
  baseCandidate: {
    scoreId: score.id,
    replicaRevision: score.replicaRevision,
    canonicalization: VIDEO_REPLICA_APPROVAL_CANONICALIZATION,
    approvalContentSha256: approvalSha256Before,
  },
  delta: auditionDelta,
  evidence: {
    status: 'conflicting-needs-user-ab',
    sourceVideoWindowSeconds: [28.55, 28.75],
    detectorConfigurations: ['balanced', 'sensitive', 'balanced-no-melodia'],
    detectorAmplitude,
    detectorDurationTicksRange: [167, 223],
    defaultConfigurationDetected: false,
    velocityCalibration: {
      method: 'linear regressions from detector amplitudeMedian to score velocity over same-source matched events',
      predictionRange: [54.5, 55.5],
      selectedAuditionVelocity: 55,
      sweepArtifactSha256: 'd5b4ce2419f8da730ed47d2c338a32c885bafe6b0a7d63863dbd3c3af145f616',
      consensusArtifactSha256: '955e1baa3159e8fd28590ab4c48b66e17f32dd1baac83b09b2ee3eec932fec8c',
      authority: 'audition-only; detector amplitude is not a physical MIDI key velocity fact',
    },
  },
};
const variantPayload = `${JSON.stringify(variantCanonical, null, 2)}\n`;
const variantContentSha256 = sha256Bytes(Buffer.from(variantPayload));

mkdirSync(options.outputDir, { recursive: true });
writeFileSync(variantPayloadPath, variantPayload);
writeFileSync(variantMidiPath, variantMidiBytes);

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'take-five-f3-isolation-'));
const rerenderPath = join(temporaryDirectory, basename(variantWavPath));
try {
  renderMidi(rendererPath, variantMidiPath, options.soundFont, variantWavPath);
  renderMidi(rendererPath, variantMidiPath, options.soundFont, rerenderPath);
  const wavBytes = requireBytes(variantWavPath, 'F3 isolation WAV');
  const rerenderedBytes = requireBytes(rerenderPath, 'fresh F3 isolation rerender');
  if (!wavBytes.equals(rerenderedBytes)) {
    throw new Error('F3 isolation WAV is not byte-identical across two locked renders');
  }

  const approvalSha256After = sha256Bytes(Buffer.from(canonicalVideoReplicaApprovalPayload(score)));
  if (approvalSha256After !== approvalSha256Before) {
    throw new Error('Building the audition variant changed the fixed-score approval identity');
  }

  const rendererBytes = requireBytes(rendererPath, 'renderer source');
  const soundFontBytes = requireBytes(options.soundFont, 'SoundFont');
  const provenance = {
    schemaVersion: 1,
    kind: 'video-replica-audition-variant-render',
    status: 'verified-byte-identical',
    authority: variantCanonical.authority,
    baseCandidate: {
      ...variantCanonical.baseCandidate,
      approvalPayloadPath: relative(process.cwd(), baseApprovalPath),
      midiPath: relative(process.cwd(), baseMidiPath),
      midiSha256: sha256Bytes(storedBaseMidiBytes),
      fixedScoreNoteCount: score.notes.length,
      verification: 'base approval and MIDI bytes equal the immutable full-v4 score before and after export',
    },
    auditionVariant: {
      id: variantId,
      canonicalPayloadPath: relative(process.cwd(), variantPayloadPath),
      contentSha256: variantContentSha256,
      delta: auditionDelta,
      verification: {
        baseNoteCount: baseParsed.noteCount,
        variantNoteCount: variantParsed.noteCount,
        addedNoteOns: addedOns,
        addedNoteOffs: addedOffs,
        removedEvents: 0,
      },
    },
    midi: {
      path: relative(process.cwd(), variantMidiPath),
      sha256: sha256Bytes(variantMidiBytes),
      byteLength: variantMidiBytes.byteLength,
    },
    renderer: {
      id: 'macos-avfoundation-offline-midi-to-wav-v1',
      sourcePath: relative(process.cwd(), rendererPath),
      sourceSha256: sha256Bytes(rendererBytes),
      swiftVersion: commandVersion('swift', ['--version']),
      macOSVersion: commandVersion('sw_vers', ['-productVersion']),
      parameters: {
        sampleRate: 44_100,
        channels: 2,
        sampleFormat: 'float32',
        tailSeconds: 0,
        bank: score.piano.bank,
        program: score.piano.program,
      },
    },
    soundFont: {
      path: options.soundFont,
      sha256: sha256Bytes(soundFontBytes),
      byteLength: soundFontBytes.byteLength,
    },
    output: {
      path: relative(process.cwd(), variantWavPath),
      sha256: sha256Bytes(wavBytes),
      byteLength: wavBytes.byteLength,
    },
    verification: {
      method: 'two independent tail=0 offline renders compared byte-for-byte',
      rerenderedSha256: sha256Bytes(rerenderedBytes),
      byteIdentical: true,
      fixedScoreApprovalSha256Before: approvalSha256Before,
      fixedScoreApprovalSha256After: approvalSha256After,
    },
  };
  writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
  console.log(`audition MIDI: ${relative(process.cwd(), variantMidiPath)}`);
  console.log(`audition WAV: ${relative(process.cwd(), variantWavPath)}`);
  console.log(`audition provenance: ${relative(process.cwd(), provenancePath)}`);
  console.log(`fixed-score approval unchanged: ${approvalSha256After}`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
