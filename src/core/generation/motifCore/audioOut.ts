// ============================================================
// motifCore sandbox — 发声出口
// ============================================================
//
// 平行沙盒,与 improCore 同级。只依赖:
//   - 共享音频层 core/audio(globalMidiScheduler / startAudioContext)
//   - improCore/engine 的 slot↔tick 换算(纯常量,属 engine 库)
// 不依赖 improCore 的 sandbox UI,保持干净的依赖边界。
// ============================================================

import { globalMidiScheduler, type MidiEvent } from '../../audio/MidiScheduler';
import { startAudioContext } from '../../audio/SynthManager';
import { slotsToTicks } from '../improCore/engine/constants';
import type { SlotNote } from '../improCore/engine';

const WHOLE = 480; // 一小节 slot

export interface DemoTrack {
    notes: SlotNote[];
    channel: number;
    /** GM program(乐器);省略则不发 programChange */
    program?: number;
    /** 轨道目标音量(均衡):把该轨归一到此基准 velocity,保留音符间相对重音(accent)。
     *  解决各源 velocity 不齐(realize 88 / IMP drum 92 / mg 110+)叠 gain 后的失衡。
     *  不给则退回 note.velocity × gain。建议:旋律 96 > bass 80 > 鼓 72 > 织体 54。 */
    mix?: number;
    /** 旧版音量缩放(mix 未给时用):velocity × gain。默认 1。 */
    gain?: number;
    /** 延音踏板(CC64)的踩放边界:和弦边界 slot 数组(每段起始)。参考 mg generatePedalEvents:
     *  每和弦 start 踩下、下个和弦前 RELEASE_LEAD 抬起 → 换和弦清延音再踩。省略/空 = 不踩。 */
    pedalBoundaries?: number[];
    /** 自动 legato:对持续型乐器(管乐/弦乐),连奏段(gap≈0)前音延后 noteOff 咬住下一音,
     *  模拟"一口气吹/拉";乐句断点(gap>0)不动。默认按乐器类型自动判定。 */
    legato?: boolean;
}

const CC_SUSTAIN = 64;
const PEDAL_RELEASE_LEAD = 20; // slot — 下个和弦前抬踏板(mg RELEASE_LEAD 0.05beat≈6slot,这里 20 更稳)
const LEGATO_OVERLAP = 12;     // slot — 连奏段前音延后 noteOff,咬住下一音触发 legato(管乐一口气)

/** 该 program 是否「持续激励型」乐器(管乐/弦乐/organ/pad),连奏段需 legato 交叠模拟一口气吹/拉;
 *  衰减型(钢琴/拨弦/vibes)逐音击发,不需要(= pedalFriendly 的大致反面)。 */
function needsLegato(program: number | undefined): boolean {
    if (program === undefined) return false;
    if (program >= 16 && program <= 23) return true; // organ
    if (program >= 40 && program <= 55) return true; // 弦乐 / ensemble / 合唱
    if (program >= 56 && program <= 79) return true; // 铜管 / 木管 / 管乐(含小号 56)
    if (program >= 80 && program <= 95) return true; // synth lead / pad
    return false;
}

/**
 * CC64 是否对该 GM program 有意义(参考 Cubase/Logic 默认):
 * 踏板只对「自然衰减型」乐器(踩 = 让音 ring out)有意义 —— 钢琴/键盘(0-7)、
 * 钢片琴/vibes/钟琴(8-15 部分)、吉他/拨弦(24-31)、竖琴(46)、kalimba(108)。
 * 「持续型」(弦乐 40-47 主体 / ensemble 48-51 / organ 16-23 / 管乐 56-79 /
 * pad 88-95 / synth lead 80-87)本就持续发声,踩 CC64 = 叠音糊成一片 → 禁用。
 */
function pedalFriendly(program: number | undefined): boolean {
    if (program === undefined) return true; // 默认钢琴(program 0)
    if (program <= 7) return true;          // 钢琴
    if (program === 11 || program === 12) return true; // Vibraphone / Marimba(衰减)
    if (program >= 24 && program <= 31) return true;   // 吉他/拨弦
    if (program === 46) return true;        // Harp
    if (program === 108) return true;       // Kalimba
    return false;                           // 其余(弦乐/pad/organ/管乐/lead)持续型 → 不踩
}

/** 多轨同步播放(各轨一次装载,保证对齐)。支持每轨音量均衡 + CC64 踏板。 */
export async function playTracks(tracks: DemoTrack[], bpm: number): Promise<void> {
    await startAudioContext();
    const events: MidiEvent[] = [];

    for (const tr of tracks) {
        if (tr.program !== undefined) {
            events.push({ ticks: 0, type: 'programChange', channel: tr.channel, data1: tr.program, data2: 0 });
        }
        // mix 模式:把该轨归一到目标音量,但保留音符间相对重音(accent)。
        // 算该轨平均 velocity 作基准,每个音 = mix × (note.vel / avg),clamp 后限到 mix±18。
        const sounded = tr.notes.filter(n => n.pitch >= 0);
        const avgVel = sounded.length
            ? sounded.reduce((s, n) => s + (n.velocity ?? 100), 0) / sounded.length
            : 100;
        const doLegato = tr.legato ?? needsLegato(tr.program); // 持续型乐器自动 legato
        for (let i = 0; i < sounded.length; i++) {
            const n = sounded[i]!;
            let vel: number;
            if (tr.mix !== undefined) {
                const accent = (n.velocity ?? 100) / avgVel;            // 相对重音(>1 强 / <1 弱)
                vel = tr.mix * (0.7 + 0.3 * accent);                    // 70% 归一 + 30% 保留 accent
                vel = Math.max(tr.mix - 18, Math.min(tr.mix + 18, vel)); // 限幅 ±18,防极端
            } else {
                vel = (n.velocity ?? 100) * (tr.gain ?? 1);
            }
            vel = Math.max(1, Math.min(127, Math.round(vel)));
            const onTick = slotsToTicks(n.startSlot);
            let offSlot = n.startSlot + n.durationSlots;
            // legato:若下一音紧接(gap≤2,连奏段)→ noteOff 延后 LEGATO_OVERLAP 咬住下一音(一口气)
            if (doLegato) {
                const next = sounded[i + 1];
                if (next && next.startSlot - offSlot <= 2) {
                    offSlot = next.startSlot + LEGATO_OVERLAP;
                }
            }
            events.push({ ticks: onTick, type: 'noteOn', channel: tr.channel, data1: n.pitch, data2: vel });
            events.push({ ticks: slotsToTicks(offSlot), type: 'noteOff', channel: tr.channel, data1: n.pitch, data2: 0 });
        }
        // CC64 踏板:每个和弦段 start 踩下、段末(下个和弦前 RELEASE_LEAD)抬起。
        // 换和弦时抬一下清掉上一和弦的延音 → 不糊(mg generatePedalEvents 语义)。
        // 仅对「踏板友好」乐器踩(钢琴/拨弦等衰减型);弦乐/pad/管乐持续型踩了必糊 → 跳过。
        const b = tr.pedalBoundaries;
        if (b && b.length > 0 && tr.notes.length > 0 && pedalFriendly(tr.program)) {
            const endSlot = Math.max(...tr.notes.map(n => n.startSlot + n.durationSlots));
            for (let i = 0; i < b.length; i++) {
                const on = b[i]!;
                const next = i + 1 < b.length ? b[i + 1]! : endSlot;
                const off = Math.max(on + 1, next - PEDAL_RELEASE_LEAD); // 下个和弦前抬
                events.push({ ticks: slotsToTicks(on), type: 'cc', channel: tr.channel, data1: CC_SUSTAIN, data2: 127 });
                events.push({ ticks: slotsToTicks(off), type: 'cc', channel: tr.channel, data1: CC_SUSTAIN, data2: 0 });
            }
        }
    }

    globalMidiScheduler.stop();
    globalMidiScheduler.loadTrack(events, bpm);
    globalMidiScheduler.start();
}

/** 停止当前播放 */
export function stopPlayback(): void {
    globalMidiScheduler.stop();
}
