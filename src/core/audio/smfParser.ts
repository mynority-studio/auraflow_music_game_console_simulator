// ============================================================
// smfParser — Standard MIDI File (.mid) → MidiEvent[]（上传播放批）
// ------------------------------------------------------------
// 支持 format 0/1（format 2 拒绝）、running status、SysEx/meta 跳过、
// vel=0 noteOn→noteOff 规范化、多轨合并稳定排序、division→PPQ480 重标定
// （globalMidiScheduler.ppq=480 固定）。
// 变速限制（v1）：取首个 tempo meta 为全曲 bpm；后续变速事件忽略并记 warning
// （scheduler 单 bpm 模型）。SMPTE division 拒绝。纯函数无 DOM，vitest 可测。
// ============================================================

import type { MidiEvent } from './MidiScheduler';

export interface SmfParseResult {
    events: MidiEvent[];   /* ticks 已重标定到 PPQ480，全局稳定排序 */
    bpm: number;           /* 首个 tempo meta（缺省 120） */
    format: number;
    division: number;      /* 原文件 PPQ */
    trackCount: number;
    noteCount: number;     /* noteOn 数（诊断/UI 显示） */
    durationTicks: number; /* 末事件 tick（PPQ480 域） */
    warnings: string[];
}

const SCHED_PPQ = 480;

class Reader {
    constructor(private readonly d: Uint8Array, public pos = 0) {}
    get remaining(): number { return this.d.length - this.pos; }
    u8(): number {
        if (this.pos >= this.d.length) throw new Error('SMF 截断（越界读）');
        return this.d[this.pos++];
    }
    peek(): number {
        if (this.pos >= this.d.length) throw new Error('SMF 截断（越界读）');
        return this.d[this.pos];
    }
    u16(): number { return (this.u8() << 8) | this.u8(); }
    u32(): number { return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0; }
    ascii(n: number): string {
        let s = '';
        for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8());
        return s;
    }
    vlq(): number {
        let v = 0;
        for (let i = 0; i < 4; i++) {
            const b = this.u8();
            v = (v << 7) | (b & 0x7f);
            if ((b & 0x80) === 0) return v;
        }
        throw new Error('SMF VLQ 超长（>4 字节）');
    }
    skip(n: number): void {
        if (this.pos + n > this.d.length) throw new Error('SMF 截断（跳过越界）');
        this.pos += n;
    }
}

interface RawEv { tick: number; order: number; ev: MidiEvent }

export function parseSMF(buf: ArrayBuffer | Uint8Array): SmfParseResult {
    const data = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const r = new Reader(data);
    if (r.ascii(4) !== 'MThd') throw new Error('不是 SMF 文件（缺 MThd）');
    const hlen = r.u32();
    if (hlen < 6) throw new Error('SMF 头长度非法');
    const format = r.u16();
    const trackCount = r.u16();
    const division = r.u16();
    r.skip(hlen - 6);
    if (format === 2) throw new Error('SMF format 2 不支持');
    if (division & 0x8000) throw new Error('SMPTE 时基不支持（仅 PPQ）');
    if (division === 0) throw new Error('SMF division=0 非法');

    const warnings: string[] = [];
    const raw: RawEv[] = [];
    let bpm = 0;            /* 0=未见 tempo */
    let extraTempo = 0;
    let noteCount = 0;
    let order = 0;

    for (let t = 0; t < trackCount; t++) {
        if (r.remaining < 8) { warnings.push(`轨道数不足（头声明 ${trackCount}，实际 ${t}）`); break; }
        if (r.ascii(4) !== 'MTrk') throw new Error(`第 ${t + 1} 轨缺 MTrk`);
        const tlen = r.u32();
        const end = r.pos + tlen;
        if (end > data.length) throw new Error(`第 ${t + 1} 轨长度越界`);
        let tick = 0;
        let running = 0;
        while (r.pos < end) {
            tick += r.vlq();
            let status = r.peek();
            if (status & 0x80) { r.u8(); running = status; }
            else {
                if (!running) throw new Error('running status 无前置状态字节');
                status = running;
            }
            if (status === 0xff) {                      /* meta */
                const type = r.u8();
                const len = r.vlq();
                if (type === 0x51 && len === 3) {       /* tempo（µs/四分音符） */
                    const uspq = (r.u8() << 16) | (r.u8() << 8) | r.u8();
                    const b = 60_000_000 / uspq;
                    if (bpm === 0) bpm = b;
                    else if (Math.abs(b - bpm) > 1e-6) extraTempo++;
                } else {
                    r.skip(len);                        /* 其余 meta（含 0x2F EOT）跳过 */
                }
                running = 0;                            /* meta/SysEx 清 running status（规范） */
                continue;
            }
            if (status === 0xf0 || status === 0xf7) {   /* SysEx */
                r.skip(r.vlq());
                running = 0;
                continue;
            }
            const kind = status & 0xf0;
            const ch = status & 0x0f;
            const d1 = r.u8() & 0x7f;
            const d2 = (kind === 0xc0 || kind === 0xd0) ? 0 : (r.u8() & 0x7f);
            let ev: MidiEvent | null = null;
            switch (kind) {
                case 0x80: ev = { ticks: 0, type: 'noteOff', channel: ch, data1: d1, data2: d2 }; break;
                case 0x90:
                    ev = d2 === 0
                        ? { ticks: 0, type: 'noteOff', channel: ch, data1: d1, data2: 0 }   /* vel0 规范化 */
                        : (noteCount++, { ticks: 0, type: 'noteOn', channel: ch, data1: d1, data2: d2 });
                    break;
                case 0xb0: ev = { ticks: 0, type: 'cc', channel: ch, data1: d1, data2: d2 }; break;
                case 0xc0: ev = { ticks: 0, type: 'programChange', channel: ch, data1: d1, data2: 0 }; break;
                case 0xe0: ev = { ticks: 0, type: 'pitchBend', channel: ch, data1: d1 | (d2 << 7), data2: 0 }; break;
                case 0xa0: case 0xd0: break;            /* poly/channel aftertouch：无消费点，跳过 */
                default: throw new Error(`未知状态字节 0x${status.toString(16)}`);
            }
            if (ev) raw.push({ tick, order: order++, ev });
        }
        r.pos = end;   /* 容错：轨内提前 EOT 时跳到声明边界 */
    }

    if (bpm === 0) { bpm = 120; warnings.push('无 tempo meta，按 120 BPM'); }
    if (extraTempo > 0) warnings.push(`忽略 ${extraTempo} 处中途变速（v1 单 bpm 模型，取首段）`);

    /* 多轨合并：tick 稳定排序（同 tick 保原相对序=轨序+轨内序）+ PPQ 重标定 */
    raw.sort((a, b) => (a.tick - b.tick) || (a.order - b.order));
    let durationTicks = 0;
    const events: MidiEvent[] = raw.map(({ tick, ev }) => {
        const t480 = Math.round((tick * SCHED_PPQ) / division);
        if (t480 > durationTicks) durationTicks = t480;
        return { ...ev, ticks: t480 };
    });

    return { events, bpm, format, division, trackCount, noteCount, durationTicks, warnings };
}
