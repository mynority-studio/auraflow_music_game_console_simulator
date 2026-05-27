/**
 * MidiConverter — ArrangedTrack → MidiEvent[] 纯渲染器
 *
 * 职责（pipeline rule §2.9）：
 *   把 ABSOLUTE 空间的 ArrangedTrack 拆解为底层 MidiEvent 流，包含：
 *     - tick=0 处的 programChange（GM 音色选择）
 *     - tick=0 处的 CC7 / CC10 / CC91（音量 / 声像 / 混响 — 基础混音）
 *     - 每个 NoteData 拆成 (noteOn, noteOff) 一对
 *
 * 调用点：PlaybackEngine.loadSong 内部，介于 AbsoluteTransposer.arrange 和
 * globalMidiScheduler.loadTrack 之间。
 *
 * 关键铁律：
 *   - **零 PRNG**（pipeline rule §2.9 D-5）— 同输入同输出，确定性兜底。
 *   - **同步函数**（S-3）— 无 async / Promise。
 *   - **Math.round tick**（P-3 / P-4）— `tick = round(beat × 480)`，
 *     不依赖隐式截断；C 端可直翻译为 `(int)(beat * 480 + 0.5)`。
 *   - **稳定排序**（D-3）：
 *       ticks ASC → 同 tick 时按 priority：
 *         programChange(0) → cc(1) → noteOff(2) → noteOn(3) → pitchBend(4) → visual(5)
 *     priority 既保证 noteOff 优先 noteOn（同音不被新 note 立刻关掉），
 *     也保证 tick=0 的 programChange/CC 先到 SpessaSynth 再发 note。
 *
 * Pitch Space:
 *   假定 NoteData.pitch 已是 ABSOLUTE（K-2 由 AbsoluteTransposer 完成）。
 *   本模块只做物理音域 [0, 127] clamp，不做 keyOffset。
 *
 * @author AuraFlow Tap! Phase 4
 */

import type { ArrangedTrack, NoteData } from '../generation/types';
import type { MidiEvent } from './MidiScheduler';

const PPQ = 480;

// ============================================================
// 通道映射（GM 默认）— 与 PlaybackEngine 的 DEFAULT_CHANNEL_MAP 对齐
// ============================================================

// ============================================================
// MIDI Channel 映射(2026-05-21 重构)— 按 BandRole 分,不按演奏物理
// ============================================================
//
// 钢琴一个乐器,无所谓几只手弹 — 删 pianoLH/RH 概念。每 channel 一个 BandRole 槽位,
// GM program 由 musician.instrumentFamily 决定(钢琴 0 / 萨克斯 65 / 弦乐 48 / 电贝斯 34 / pad 89)。
//
//   ch1 = MainInst   (主奏槽位 — 旧 melody 通道)
//   ch2 = Accomp     (伴奏槽位 — 旧 pianoRH + pianoLH 合并)
//   ch3 = Bass       (低音槽位 — 旧 electricBass 通用化重命名)
//   ch4 = Atmosphere (氛围槽位)
//   ch5 / ch6       预留 Vocal / 备用
//   ch9 = Drums      (GM Drum Map 硬路由,不可改)
export const CHANNEL_MELODY = 1;          // MainInst — 命名保留兼容历史("melody" = MainInst 输出)
export const CHANNEL_ACCOMP = 2;          // Accomp(原 pianoRH+pianoLH 合并)
export const CHANNEL_BASS = 3;            // Bass(原 electricBass)
export const CHANNEL_ATMOSPHERE = 4;
export const CHANNEL_DRUMS = 9;

// ============================================================
// GM Program 默认分配(每 channel 的默认音色)
// ============================================================
//
// 2026-05-27 mgEngine 中性化:melody / accomp 都默认 Acoustic Grand(GM 0),
// 与 mg App.tsx 的 Salamander piano 单一钢琴音源对齐。
// gmProgramOverrides 仍可覆盖(UI 钢琴族下拉)。
// bass / atmosphere / drums 槽位在 mg 钢琴独奏模式下不会用,但保留默认值给未来扩展。

const GM_PROGRAM_MELODY = 0;
const GM_PROGRAM_ACCOMP = 0;
const GM_PROGRAM_BASS = 34;
const GM_PROGRAM_ATMOSPHERE = 89;
const GM_PROGRAM_DRUMS = 0;

// ============================================================
// CC 编号
// ============================================================
const CC_VOLUME = 7;
const CC_PAN = 10;
const CC_REVERB = 91;
const CC_EXPRESSION = 11;

// ============================================================
// 基础混音 profile — 中性化(2026-05-27 mgEngine 接入)
// ============================================================
//
// 原 per-channel volume/pan/reverb 差异化预设(melody 微右+长尾混响 /
// accomp 中度混响 / bass 零混响 punchy / atmosphere 低音量 / drums 中度)
// 全部清零,与 mg App.tsx "single Salamander piano + global reverb" 对齐。
// 所有通道:volume=127(max) / pan=64(center) / reverb=0(SF2 默认混响关)。
//
// 如果需要"模拟" mg 的全局长尾混响,加在 SF2 / SpessaSynth 全局即可,不要
// 重新引入 per-channel 差异。

interface MixProfile { volume: number; pan: number; reverb: number; }

const MIX_IDENTITY: MixProfile = { volume: 127, pan: 64, reverb: 0 };

const MIX_MELODY     = MIX_IDENTITY;
const MIX_ACCOMP     = MIX_IDENTITY;
const MIX_BASS       = MIX_IDENTITY;
const MIX_ATMOSPHERE = MIX_IDENTITY;
const MIX_DRUMS      = MIX_IDENTITY;

// ============================================================
// 事件优先级（同 tick 排序的次序）
// ============================================================
//
// programChange / cc 必须在 noteOn 之前到达合成器，
// 否则首拍音符可能以默认音色（program 0）或上次 CC 状态发出。

function eventPriority(type: MidiEvent['type']): number {
    switch (type) {
        case 'programChange': return 0;
        case 'cc':            return 1;
        case 'noteOff':       return 2;
        case 'noteOn':        return 3;
        case 'pitchBend':     return 4;
        case 'visual':        return 5;
        default:              return 6;
    }
}

// ============================================================
// 公开 API
// ============================================================

export class MidiConverter {
    /**
     * 纯转换。同输入 → 同输出，零 PRNG。
     *
     * 输出最大长度估算（C-4）：
     *   ≈ 3 × (4 + 2 × noteCount)  ← 每轨 4 个 setup event + 每个 note 2 event
     *   典型 1 分钟曲：3 × (4 + 2 × 200) ≈ 1200 events
     */
    public static convert(song: ArrangedTrack): MidiEvent[] {
        const out: MidiEvent[] = [];

        // 动态 GM 程式覆盖(来自 context.gmProgramOverrides,musician 决定)
        const ov = song.gmProgramOverrides;
        const progMelody     = ov?.melody     ?? GM_PROGRAM_MELODY;
        const progAccomp     = ov?.accomp     ?? GM_PROGRAM_ACCOMP;
        const progBass       = ov?.bass       ?? GM_PROGRAM_BASS;
        const progAtmosphere = ov?.atmosphere ?? GM_PROGRAM_ATMOSPHERE;
        const progDrums      = ov?.drums      ?? GM_PROGRAM_DRUMS;

        // 5 轨渲染(顺序无所谓,最后会全局排序)
        renderTrack(out, song.melody,     CHANNEL_MELODY,     progMelody,     MIX_MELODY);
        renderTrack(out, song.accomp,     CHANNEL_ACCOMP,     progAccomp,     MIX_ACCOMP);
        renderTrack(out, song.bass,       CHANNEL_BASS,       progBass,       MIX_BASS);
        renderTrack(out, song.atmosphere, CHANNEL_ATMOSPHERE, progAtmosphere, MIX_ATMOSPHERE);
        // K-8: song.drums 已是 GM Drum Map 物理键位(pitch ∈ {36,38,42,...}),
        // renderTrack 内部仅做 [0,127] clamp。channel 9 + program = kit id(SF2/GM2 兼容)
        renderTrack(out, song.drums,      CHANNEL_DRUMS,      progDrums,      MIX_DRUMS);

        // 2026-05-27 mgEngine 中性化:删除 kick-triggered 伪侧链 ducking(原对
        // accomp + bass 注入 CC11 dip→recovery 包络)。mg 不做侧链,所有声部
        // 平铺,我们也对齐。

        // D-3:完全确定的排序
        out.sort((a, b) => {
            if (a.ticks !== b.ticks) return a.ticks - b.ticks;
            return eventPriority(a.type) - eventPriority(b.type);
        });

        return out;
    }
}

// ============================================================
// 内部：单轨渲染
// ============================================================

/**
 * 渲染单轨：tick=0 setup（program + 3 个 CC）+ 每 note 一对 (noteOn, noteOff)。
 *
 * 空轨 / undefined 轨直接跳过 — 不污染 MidiEvent[] 流。
 */
function renderTrack(
    out: MidiEvent[],
    notes: NoteData[] | undefined,
    channel: number,
    program: number,
    mix: MixProfile,
): void {
    if (!notes || notes.length === 0) return;

    // tick 0 控制事件
    out.push({ ticks: 0, type: 'programChange', channel, data1: program,        data2: 0 });
    out.push({ ticks: 0, type: 'cc',            channel, data1: CC_VOLUME,      data2: mix.volume });
    out.push({ ticks: 0, type: 'cc',            channel, data1: CC_PAN,         data2: mix.pan });
    out.push({ ticks: 0, type: 'cc',            channel, data1: CC_REVERB,      data2: mix.reverb });
    out.push({ ticks: 0, type: 'cc',            channel, data1: CC_EXPRESSION,  data2: 127 });

    // 音符
    for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        if (!(note.duration > 0)) continue;  // duration 必须严格 > 0

        const startTick = Math.round(note.onset * PPQ);
        const endTick = Math.round((note.onset + note.duration) * PPQ);
        if (endTick <= startTick) continue;  // 退化音符 — 不发射

        // velocity (0.0~1.0) → MIDI 1~127；0 视为 noteOff，不允许出现在 noteOn
        const velRaw = Math.round(note.velocity * 127);
        const velocity = velRaw < 1 ? 1 : (velRaw > 127 ? 127 : velRaw);
        // pitch 防御性 clamp 到 [0, 127]
        const pRaw = Math.round(note.pitch);
        const pitch = pRaw < 0 ? 0 : (pRaw > 127 ? 127 : pRaw);

        out.push({ ticks: startTick, type: 'noteOn',  channel, data1: pitch, data2: velocity });
        out.push({ ticks: endTick,   type: 'noteOff', channel, data1: pitch, data2: 0 });
    }
}

// ============================================================
// 内部常量 export（测试 / 调试用）
// ============================================================

export const __mixProfilesForTest = {
    melody:     MIX_MELODY,
    accomp:     MIX_ACCOMP,
    bass:       MIX_BASS,
    atmosphere: MIX_ATMOSPHERE,
    drums:      MIX_DRUMS,
} as const;
