import type {
  RichSmfDocument,
  RichSmfEvent,
  RichSmfTrack,
  SmfAnalysisSupport,
  SmfChannelEvent,
  SmfKeySignatureEvent,
  SmfMetaEvent,
  SmfTempoEvent,
  SmfTextEvent,
  SmfTimeDivision,
  SmfTimeSignatureEvent,
} from './types';

class Reader {
  constructor(private readonly data: Uint8Array, public pos = 0) {}

  get remaining(): number { return this.data.length - this.pos; }

  u8(): number {
    if (this.pos >= this.data.length) throw new Error('SMF 截断（越界读）');
    return this.data[this.pos++];
  }

  peek(): number {
    if (this.pos >= this.data.length) throw new Error('SMF 截断（越界读）');
    return this.data[this.pos];
  }

  u16(): number { return (this.u8() << 8) | this.u8(); }

  u32(): number {
    return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0;
  }

  ascii(length: number): string {
    let result = '';
    for (let i = 0; i < length; i++) result += String.fromCharCode(this.u8());
    return result;
  }

  bytes(length: number): Uint8Array {
    if (length < 0 || this.pos + length > this.data.length) throw new Error('SMF 截断（数据越界）');
    const result = this.data.slice(this.pos, this.pos + length);
    this.pos += length;
    return result;
  }

  vlq(): number {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const byte = this.u8();
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new Error('SMF VLQ 超长（>4 字节）');
  }

  skip(length: number): void { void this.bytes(length); }
}

const TEXT_META_TYPES = new Set([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09]);

function decodeText(data: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/\0+$/g, '');
  } catch {
    return Array.from(data, (byte) => String.fromCharCode(byte)).join('').replace(/\0+$/g, '');
  }
}

function parseTimeDivision(raw: number): SmfTimeDivision {
  if ((raw & 0x8000) === 0) {
    if (raw === 0) throw new Error('SMF division=0 非法');
    return { kind: 'ppq', ppq: raw };
  }
  const signedFpsByte = (raw >> 8) & 0xff;
  const signedFps = signedFpsByte >= 0x80 ? signedFpsByte - 0x100 : signedFpsByte;
  const ticksPerFrame = raw & 0xff;
  if (ticksPerFrame === 0 || signedFps >= 0) throw new Error('SMF SMPTE division 非法');
  return { kind: 'smpte', framesPerSecond: Math.abs(signedFps), ticksPerFrame };
}

function supportFor(format: number, division: SmfTimeDivision): SmfAnalysisSupport {
  if (format === 2) return { supported: false, reason: 'format-2-independent-sequences' };
  if (division.kind === 'smpte') return { supported: false, reason: 'smpte-time-division' };
  return { supported: true, scope: 'smf-format-0-1-ppq' };
}

function stableEventOrder(a: RichSmfEvent, b: RichSmfEvent): number {
  return (a.tick - b.tick) || (a.order - b.order);
}

/**
 * Lossless-enough SMF parser for analysis.
 *
 * Unlike the playback parser, this keeps physical-track provenance, original
 * ticks, all channel messages, SysEx payloads, and every Meta payload. Format 2
 * and SMPTE files are parsed for diagnostics but explicitly marked unsupported
 * for musical inference.
 */
export function parseRichSMF(input: ArrayBuffer | Uint8Array): RichSmfDocument {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const reader = new Reader(bytes);
  if (reader.ascii(4) !== 'MThd') throw new Error('不是 SMF 文件（缺 MThd）');
  const headerLength = reader.u32();
  if (headerLength < 6) throw new Error('SMF 头长度非法');
  const format = reader.u16();
  if (format < 0 || format > 2) throw new Error(`SMF format ${format} 非法`);
  const declaredTrackCount = reader.u16();
  const timeDivision = parseTimeDivision(reader.u16());
  reader.skip(headerLength - 6);

  const warnings: string[] = [];
  const tracks: RichSmfTrack[] = [];
  const allEvents: RichSmfEvent[] = [];
  const tempoMap: SmfTempoEvent[] = [];
  const timeSignatureMap: SmfTimeSignatureEvent[] = [];
  const keySignatureMap: SmfKeySignatureEvent[] = [];
  const textEvents: SmfTextEvent[] = [];
  let globalOrder = 0;
  let durationTicks = 0;

  for (let trackIndex = 0; trackIndex < declaredTrackCount; trackIndex++) {
    if (reader.remaining < 8) {
      warnings.push(`轨道数不足（头声明 ${declaredTrackCount}，实际 ${trackIndex}）`);
      break;
    }
    if (reader.ascii(4) !== 'MTrk') throw new Error(`第 ${trackIndex + 1} 轨缺 MTrk`);
    const declaredLength = reader.u32();
    const trackEndOffset = reader.pos + declaredLength;
    if (trackEndOffset > bytes.length) throw new Error(`第 ${trackIndex + 1} 轨长度越界`);

    const events: RichSmfEvent[] = [];
    let tick = 0;
    let runningStatus = 0;
    let trackName: string | undefined;
    let instrumentName: string | undefined;

    while (reader.pos < trackEndOffset) {
      tick += reader.vlq();
      const firstByte = reader.peek();
      let status: number;
      if ((firstByte & 0x80) !== 0) {
        status = reader.u8();
        if (status < 0xf0) runningStatus = status;
      } else {
        if (runningStatus === 0) throw new Error('running status 无前置状态字节');
        status = runningStatus;
      }

      if (status === 0xff) {
        const metaType = reader.u8();
        const length = reader.vlq();
        const data = reader.bytes(length);
        const event: SmfMetaEvent = {
          kind: 'meta',
          tick,
          trackIndex,
          order: globalOrder++,
          metaType,
          data,
        };
        events.push(event);
        allEvents.push(event);

        if (metaType === 0x51) {
          if (data.length !== 3) {
            warnings.push(`轨 ${trackIndex + 1} tick ${tick}: Tempo Meta 长度应为 3，收到 ${data.length}`);
          } else {
            const microsecondsPerQuarter = (data[0] << 16) | (data[1] << 8) | data[2];
            if (microsecondsPerQuarter <= 0) {
              warnings.push(`轨 ${trackIndex + 1} tick ${tick}: Tempo Meta 值非法`);
            } else {
              tempoMap.push({
                tick,
                trackIndex,
                microsecondsPerQuarter,
                bpm: 60_000_000 / microsecondsPerQuarter,
              });
            }
          }
        } else if (metaType === 0x58) {
          if (data.length !== 4) {
            warnings.push(`轨 ${trackIndex + 1} tick ${tick}: Time Signature Meta 长度应为 4，收到 ${data.length}`);
          } else {
            const denominatorPower = data[1];
            const denominator = denominatorPower <= 30 ? 2 ** denominatorPower : Number.POSITIVE_INFINITY;
            const valid = data[0] > 0 && Number.isFinite(denominator);
            timeSignatureMap.push({
              tick,
              trackIndex,
              numerator: data[0],
              denominator,
              denominatorPower,
              midiClocksPerMetronomeClick: data[2],
              notated32ndNotesPerQuarter: data[3],
              valid,
            });
            if (!valid) warnings.push(`轨 ${trackIndex + 1} tick ${tick}: Time Signature Meta 值非法`);
          }
        } else if (metaType === 0x59) {
          if (data.length !== 2) {
            warnings.push(`轨 ${trackIndex + 1} tick ${tick}: Key Signature Meta 长度应为 2，收到 ${data.length}`);
          } else {
            const sharpsFlats = data[0] >= 0x80 ? data[0] - 0x100 : data[0];
            const mode = data[1] === 0 ? 'major' : data[1] === 1 ? 'minor' : 'unknown';
            const valid = sharpsFlats >= -7 && sharpsFlats <= 7 && mode !== 'unknown';
            keySignatureMap.push({
              tick,
              trackIndex,
              sharpsFlats,
              modeByte: data[1],
              mode,
              valid,
            });
            if (!valid) warnings.push(`轨 ${trackIndex + 1} tick ${tick}: Key Signature Meta 值超出 SMF 定义`);
          }
        }

        if (TEXT_META_TYPES.has(metaType)) {
          const text = decodeText(data);
          textEvents.push({ tick, trackIndex, metaType, text });
          if (metaType === 0x03 && trackName === undefined) trackName = text;
          if (metaType === 0x04 && instrumentName === undefined) instrumentName = text;
        }

        runningStatus = 0;
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        const length = reader.vlq();
        const event = {
          kind: 'sysex' as const,
          tick,
          trackIndex,
          order: globalOrder++,
          status: status as 0xf0 | 0xf7,
          data: reader.bytes(length),
        };
        events.push(event);
        allEvents.push(event);
        runningStatus = 0;
        continue;
      }

      const messageNibble = status & 0xf0;
      const channel = status & 0x0f;
      const data1 = reader.u8() & 0x7f;
      const data2 = messageNibble === 0xc0 || messageNibble === 0xd0 ? 0 : reader.u8() & 0x7f;
      const type = messageNibble === 0x80 ? 'noteOff'
        : messageNibble === 0x90 ? (data2 === 0 ? 'noteOff' : 'noteOn')
        : messageNibble === 0xa0 ? 'polyAftertouch'
        : messageNibble === 0xb0 ? 'cc'
        : messageNibble === 0xc0 ? 'programChange'
        : messageNibble === 0xd0 ? 'channelAftertouch'
        : messageNibble === 0xe0 ? 'pitchBend'
        : null;
      if (!type) throw new Error(`未知状态字节 0x${status.toString(16)}`);

      const event: SmfChannelEvent = {
        kind: 'channel',
        type,
        tick,
        trackIndex,
        order: globalOrder++,
        channel,
        data1: type === 'pitchBend' ? data1 | (data2 << 7) : data1,
        data2,
      };
      events.push(event);
      allEvents.push(event);
    }

    reader.pos = trackEndOffset;
    durationTicks = Math.max(durationTicks, tick);
    tracks.push({
      index: trackIndex,
      declaredLength,
      endTick: tick,
      name: trackName,
      instrumentName,
      events,
    });
  }

  if (tracks.length < declaredTrackCount) {
    warnings.push(`仅解析到 ${tracks.length}/${declaredTrackCount} 个轨道`);
  }
  if (tempoMap.length === 0) warnings.push('未声明 Tempo；播放兼容层可使用 120 BPM，但分析报告不得标为声明值');
  if (timeSignatureMap.length === 0) warnings.push('未声明拍号');
  if (keySignatureMap.length === 0) warnings.push('未声明调号');

  allEvents.sort(stableEventOrder);
  tempoMap.sort((a, b) => (a.tick - b.tick) || (a.trackIndex - b.trackIndex));
  timeSignatureMap.sort((a, b) => (a.tick - b.tick) || (a.trackIndex - b.trackIndex));
  keySignatureMap.sort((a, b) => (a.tick - b.tick) || (a.trackIndex - b.trackIndex));
  textEvents.sort((a, b) => (a.tick - b.tick) || (a.trackIndex - b.trackIndex));

  return {
    format,
    declaredTrackCount,
    timeDivision,
    analysisSupport: supportFor(format, timeDivision),
    tracks,
    events: allEvents,
    tempoMap,
    timeSignatureMap,
    keySignatureMap,
    textEvents,
    durationTicks,
    warnings,
  };
}

