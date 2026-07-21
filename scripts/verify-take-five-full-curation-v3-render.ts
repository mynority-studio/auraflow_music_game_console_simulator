// Re-render the locked full-v3 MIDI and prove that the audition WAV is its
// byte-identical output. This is an offline provenance gate, never an engine
// input and never an approval action.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import {
  canonicalVideoReplicaApprovalPayload,
  compileVideoReplicaScore,
  TAKE_FIVE_FULL_CURATION_CANDIDATE_V3,
  videoReplicaToSMF,
  VIDEO_REPLICA_APPROVAL_CANONICALIZATION,
} from '../src/core/generation/newEngine/videoReplica';

interface Options {
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
      throw new Error('Usage: --sf2 <soundfont.sf2> [--output-dir <candidate-directory>]');
    }
    values.set(key, value);
  }
  const soundFont = values.get('--sf2');
  if (!soundFont) throw new Error('Missing required --sf2 <soundfont.sf2>');
  return {
    outputDir: resolve(values.get('--output-dir') ?? 'tmp/video-replica/take-five-full-curation-v3'),
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

const options = readOptions();
const score = TAKE_FIVE_FULL_CURATION_CANDIDATE_V3;
const rendererPath = resolve('scripts/render-midi-to-wav.swift');
const midiPath = resolve(options.outputDir, 'take-five-full-curation-v3.mid');
const approvalPayloadPath = resolve(options.outputDir, 'take-five-full-curation-v3.approval-canonical.jsonl');
const wavPath = resolve(options.outputDir, 'take-five-full-curation-v3.wav');
const provenancePath = resolve(options.outputDir, 'take-five-full-curation-v3.render-provenance.json');

const rendererBytes = requireBytes(rendererPath, 'renderer source');
const soundFontBytes = requireBytes(options.soundFont, 'SoundFont');
const midiBytes = requireBytes(midiPath, 'full-v3 MIDI');
const approvalPayloadBytes = requireBytes(approvalPayloadPath, 'canonical approval payload');
const auditionWavBytes = requireBytes(wavPath, 'candidate audition WAV');

const expectedApprovalPayload = canonicalVideoReplicaApprovalPayload(score);
if (!approvalPayloadBytes.equals(Buffer.from(expectedApprovalPayload))) {
  throw new Error('Canonical approval payload is stale relative to the full-v3 score');
}
const expectedMidiBytes = Buffer.from(videoReplicaToSMF(
  compileVideoReplicaScore(score).ir,
  score.source.bpm,
));
if (!midiBytes.equals(expectedMidiBytes)) {
  throw new Error(
    `MIDI is stale: actual=${sha256Bytes(midiBytes)} expected=${sha256Bytes(expectedMidiBytes)}`,
  );
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'take-five-full-v3-render-'));
const rerenderPath = join(temporaryDirectory, basename(wavPath));
try {
  const render = spawnSync('swift', [
    rendererPath,
    '--midi', midiPath,
    '--sf2', options.soundFont,
    '--out', rerenderPath,
    '--tail', '0',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (render.status !== 0) {
    throw new Error(`Renderer failed (${render.status}): ${render.stderr || render.stdout}`);
  }
  const rerenderedWavBytes = requireBytes(rerenderPath, 'freshly rendered verification WAV');
  if (!auditionWavBytes.equals(rerenderedWavBytes)) {
    throw new Error(
      `Audition WAV is stale: actual=${sha256Bytes(auditionWavBytes)} rerendered=${sha256Bytes(rerenderedWavBytes)}`,
    );
  }

  const approvalSha256 = sha256Bytes(approvalPayloadBytes);
  const midiSha256 = sha256Bytes(midiBytes);
  const wavSha256 = sha256Bytes(auditionWavBytes);
  const provenance = {
    schemaVersion: 1,
    status: 'verified-byte-identical',
    authority: {
      readOnly: true,
      engineEffect: 'none',
      approvalEffect: 'none',
    },
    candidate: {
      scoreId: score.id,
      replicaRevision: score.replicaRevision,
      canonicalization: VIDEO_REPLICA_APPROVAL_CANONICALIZATION,
      approvalContentSha256: approvalSha256,
      approvalPayloadPath: relative(process.cwd(), approvalPayloadPath),
    },
    midi: {
      path: relative(process.cwd(), midiPath),
      sha256: midiSha256,
      byteLength: midiBytes.byteLength,
      verification: 'byte-identical to compileVideoReplicaScore -> videoReplicaToSMF',
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
      path: relative(process.cwd(), wavPath),
      sha256: wavSha256,
      byteLength: auditionWavBytes.byteLength,
    },
    verification: {
      method: 'fresh offline rerender compared byte-for-byte with audition WAV',
      rerenderedSha256: sha256Bytes(rerenderedWavBytes),
      byteIdentical: true,
    },
  };
  writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
  console.log(`render provenance: ${relative(process.cwd(), provenancePath)}`);
  console.log(`approval SHA-256: ${approvalSha256}`);
  console.log(`MIDI SHA-256: ${midiSha256}`);
  console.log(`WAV SHA-256: ${wavSha256}`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
