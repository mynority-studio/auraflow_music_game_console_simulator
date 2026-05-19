/**
 * MidiConverter — ArrangedTrack → MidiEvent[] 纯渲染器
 *
 * 职责（pipeline rule §2.9）：
 *   把 ABSOLUTE 空间的 ArrangedTrack 拆解为底层 MidiEvent 流，包含：
 *     - tick=0 处的 programChange（GM 音色选择）
 *     - tick=0 处的 CC7 / CC10 / CC91（音量 / 声像 / 混响 — 基础混音）
 *     - 每个 NoteData 拆成 (noteOn, noteOff) 一对
 *
 * 调用点：PlaybackEngine.loadSong 内部，介于 Orchestrator.arrange 和
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
 *   假定 NoteData.pitch 已是 ABSOLUTE（K-2 由 Orchestrator 完成）。
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

export const CHANNEL_MELODY = 1;
export const CHANNEL_PIANO_RH = 4;
export const CHANNEL_PIANO_LH = 5;
/** GM 标准固定鼓通道（Phase 5 新增）— pitch 直接对应 GM Drum Map，program 被忽略 */
export const CHANNEL_DRUMS = 9;
/** 氛围通道（BandEngine MVP 新增）— Pad/Strings/Choir 长音铺底 */
export const CHANNEL_ATMOSPHERE = 8;
/** V5.3 — 独立电贝斯通道（Bass 角色乐手）— 与 PianoLH 物理分离 */
export const CHANNEL_ELECTRIC_BASS = 7;

// ============================================================
// GM Program 分配（Phase 6 — 双钢琴层位）
// ============================================================
//
// 选型逻辑：
//   - melody → 1  (Bright Acoustic Piano)  与 comping 同家族保证融合；更亮的 attack
//                                          + 微右 pan 74 + 长尾 reverb 70 让它从中频
//                                          钢琴织体上方"切"出来作为 lead voice
//   - pianoRH → 0  (Acoustic Grand)        comping 主力，中频饱满、居中、短混响
//   - pianoLH → 33 (Electric Bass)         低频锚定，attack 干净
//   - drums  → 0  (GM 鼓固定，program 被 Channel 9 忽略；发 0 兜底)
//
// 双钢琴区分三层：① 音色家族同但 brightness 不同  ② pan 错位（74 vs 64）
//                ③ reverb 深度（70 vs 50）— 远近感分离
//
// Phase 7 计划按 styleId 切换为 EP（Neo-Soul Rhodes）等。

const GM_PROGRAM_MELODY = 1;
const GM_PROGRAM_PIANO_RH = 0;
/** V5.3 — PianoLH 改回 0 Grand Piano（与 PianoRH 一致 — "一架真钢琴"） */
const GM_PROGRAM_PIANO_LH = 0;
const GM_PROGRAM_DRUMS = 0;
/** Atmosphere → GM 89 Warm Pad（模拟 pad 暖色，融合度高，不抢焦点） */
const GM_PROGRAM_ATMOSPHERE = 89;
/** V5.3 — 独立电贝斯 GM 33 Finger Bass（原 PianoLH 用途，现拆出独立通道） */
const GM_PROGRAM_ELECTRIC_BASS = 33;

// ============================================================
// CC 编号
// ============================================================
const CC_VOLUME = 7;
const CC_PAN = 10;
const CC_REVERB = 91;
const CC_EXPRESSION = 11;

// ============================================================
// 基础混音 profile（Phase 6 — 钢琴 instrumental 编制重新校准 + The Walker 急救）
// ============================================================
//
// CLAUDE.md 原始等级 "Vocal/Melody 118 > Drums 108 > Bass 98 > Chord 85" 是
// vocal-led 流行编制：vocal 是焦点，bass 比 chord 强 13 单位作为律动锚点。
// 但本工程是钢琴 instrumental 编制（lead piano 替代 vocal），需要校准两点：
//
//   1. 没有 vocal 时，lead piano 就是焦点 — 推到 CC7 上限附近确保压住伴奏
//   2. 没有独立 chord pad 时，comping piano 是唯一和声体 — 必须大幅高于原"Chord 85"
//
// Phase 6 The Walker 修订：
//   - Bass 严禁混响：长尾混响会糊掉低频根音的 attack，让 Walking Bass 的"行进感"消失
//   - Bass volume 上抬补偿失去混响后的响度，且 Walking / Funk 需要 punchy attack 占位
//
// pan: 64 = 居中
// reverb: 0~127；melody 长尾制造空间感

interface MixProfile { volume: number; pan: number; reverb: number; }

const MIX_MELODY:       MixProfile = { volume: 122, pan: 74, reverb: 70 };  // 焦点：高音量 + 微右 + 长尾
const MIX_PIANO_RH:     MixProfile = { volume: 102, pan: 64, reverb: 50 };  // 和声体：上抬 17 单位
/** V5.3 — PianoLH 现在是 Grand Piano 低音区，mix 与 RH 接近（"一架真钢琴"），微左 pan 增加空间感 */
const MIX_PIANO_LH:     MixProfile = { volume:  96, pan: 54, reverb: 45 };
const MIX_DRUMS:        MixProfile = { volume: 102, pan: 64, reverb: 25 };  // 微降让 melody 透气
const MIX_ATMOSPHERE:   MixProfile = { volume:  70, pan: 64, reverb: 60 };  // 铺底
/** V5.3 — 独立电贝斯：继承原 PianoLH 的零混响 + 低音量配置（Phase 6 The Walker 标定） */
const MIX_ELECTRIC_BASS: MixProfile = { volume:  78, pan: 64, reverb:  0 };

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

        // B3 — 动态 GM 程式覆盖（来自 ArrangedTrack.gmProgramOverrides，由 Orchestrator 从 context 透传）
        const ov = song.gmProgramOverrides;
        const progMelody       = ov?.melody       ?? GM_PROGRAM_MELODY;
        const progPianoRH      = ov?.pianoRH      ?? GM_PROGRAM_PIANO_RH;
        const progPianoLH      = ov?.pianoLH      ?? GM_PROGRAM_PIANO_LH;
        const progDrums        = ov?.drums        ?? GM_PROGRAM_DRUMS;
        const progAtmosphere   = ov?.atmosphere   ?? GM_PROGRAM_ATMOSPHERE;
        const progElectricBass = ov?.electricBass ?? GM_PROGRAM_ELECTRIC_BASS;

        // 六轨渲染（顺序无所谓，最后会全局排序）
        renderTrack(out, song.melody,       CHANNEL_MELODY,        progMelody,        MIX_MELODY);
        renderTrack(out, song.pianoRH,      CHANNEL_PIANO_RH,      progPianoRH,       MIX_PIANO_RH);
        renderTrack(out, song.pianoLH,      CHANNEL_PIANO_LH,      progPianoLH,       MIX_PIANO_LH);
        // V5.3 — 独立电贝斯轨（Bass 角色乐手输出）
        renderTrack(out, song.electricBass, CHANNEL_ELECTRIC_BASS, progElectricBass,  MIX_ELECTRIC_BASS);
        // K-8: song.drums 已是 GM Drum Map 物理键位（pitch ∈ {36,38,42,...}），
        // renderTrack 内部仅做 [0,127] clamp，不会越界。channel 9 + program = kit id（SF2/GM2 兼容）
        renderTrack(out, song.drums,        CHANNEL_DRUMS,         progDrums,         MIX_DRUMS);
        renderTrack(out, song.atmosphere,   CHANNEL_ATMOSPHERE,    progAtmosphere,    MIX_ATMOSPHERE);

        // Fake Sidechain (伪侧链): 基于 Kick 鼓点对伴奏和贝斯通道注入 CC11 闪避包络
        // D-5 safe: 无 PRNG 消耗的机械注入，零 DSP 开销
        // V5.3 — 改为对 ElectricBass 通道做深度 ducking（原 PianoLH 当时是贝斯）；PianoLH 现在是钢琴低音区，做轻 ducking
        const kicks = out.filter(e => e.type === 'noteOn' && e.channel === CHANNEL_DRUMS && e.data1 === 36);
        for (let i = 0; i < kicks.length; i++) {
            const kickTick = kicks[i].ticks;
            // PianoRH 深 ducking
            out.push({ ticks: kickTick,       type: 'cc', channel: CHANNEL_PIANO_RH, data1: CC_EXPRESSION, data2: 60 });
            out.push({ ticks: kickTick + 120, type: 'cc', channel: CHANNEL_PIANO_RH, data1: CC_EXPRESSION, data2: 90 });
            out.push({ ticks: kickTick + 240, type: 'cc', channel: CHANNEL_PIANO_RH, data1: CC_EXPRESSION, data2: 127 });

            // PianoLH 轻 ducking（钢琴低音区，与 RH 一致 mix 思路）
            out.push({ ticks: kickTick,       type: 'cc', channel: CHANNEL_PIANO_LH, data1: CC_EXPRESSION, data2: 80 });
            out.push({ ticks: kickTick + 120, type: 'cc', channel: CHANNEL_PIANO_LH, data1: CC_EXPRESSION, data2: 105 });
            out.push({ ticks: kickTick + 240, type: 'cc', channel: CHANNEL_PIANO_LH, data1: CC_EXPRESSION, data2: 127 });

            // ElectricBass 中度 ducking，让出 Kick 频段（继承原 PianoLH 的处理）
            out.push({ ticks: kickTick,       type: 'cc', channel: CHANNEL_ELECTRIC_BASS, data1: CC_EXPRESSION, data2: 70 });
            out.push({ ticks: kickTick + 120, type: 'cc', channel: CHANNEL_ELECTRIC_BASS, data1: CC_EXPRESSION, data2: 100 });
            out.push({ ticks: kickTick + 240, type: 'cc', channel: CHANNEL_ELECTRIC_BASS, data1: CC_EXPRESSION, data2: 127 });
        }

        // D-3：完全确定的排序
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
    melody: MIX_MELODY,
    pianoRH: MIX_PIANO_RH,
    pianoLH: MIX_PIANO_LH,
    drums: MIX_DRUMS,
    atmosphere: MIX_ATMOSPHERE,
    electricBass: MIX_ELECTRIC_BASS,
} as const;
