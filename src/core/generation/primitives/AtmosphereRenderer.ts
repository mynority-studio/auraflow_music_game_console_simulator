/**
 * AtmosphereRenderer — 氛围层（Pad / Strings / Choir）渲染器
 *
 * 消费 HarmonyCore 输出的 voicing[] + AtmosphereIdiom 参数 + 段落 intensityScale，
 * 每个和弦输出 voiceCount 个长音 NoteData，构成"长音铺底"的 pad 织体。
 *
 * 与 TextureMapper（comping）的区别：
 *   - 不跟随 RhythmMutator 的 0/1 grid — pad 是"和弦时长 = 单个 block 时长"
 *   - 不做琶音 / 单音 — 永远齐砸 voiceCount 个声部
 *   - releaseRatio > 1 会让 pad 拖尾过踏到下个和弦头，营造连续铺底
 *   - crossfade=true 时显式 overlap 进入下个和弦 0.25 拍，避免硬切
 *
 * 与 Stage5Layering accomp 的区别：
 *   - 掐头规则相同（去掉 voicing[0]，让位 Bass 轨）
 *   - 但 pad 不消耗 RhythmMutator/TextureMapper，是独立的"长音渲染器"
 *
 * Pitch Space: RELATIVE（K-1 / K-2）
 *   - 输入 voicing[] 已是 HarmonyCore 输出的相对空间 MIDI（C=60 中心）
 *   - 输出 NoteData.pitch 直接抄自 voicing[]
 *   - AbsoluteTransposer.applyOffset 在管道末端统一加 keyOffset
 *
 * 约束遵从（music_generation_pipeline_rule.md）：
 *   D-1: 零 PRNG（V1 完全确定性，仅由 chords + idiom + intensityScale 决定）
 *   D-3: 输出 sort (onset ASC, pitch ASC)
 *   D-4: 浮点比较走 EPSILON
 *   P-1: 输出 NoteData[] 连续 array
 *   S-3: 全同步纯函数
 *   S-4: 输出纯数据
 *   K-2: 严禁 +keyOffset
 *
 * @author AuraFlow Tap! BandEngine MVP Step 4
 */

import { AtmosphereIdiom, GeneratedChord, NoteData } from '../types';

const EPSILON = 1e-6;
const MIDI_MAX = 127;

// Pitch Space anchor — 与 Stage5Layering ACCOMP_MIN_PITCH 对齐
// Pad 与 Comping 共享 ≥ C3 的约束，避免与 Bass 轨低频堆叠
const ATMOSPHERE_MIN_PITCH = 48;  // C3

// Crossfade overlap — 显式 crossfade 时延伸进下和弦的拍数
const CROSSFADE_OVERLAP_BEATS = 0.25;

// AtmosphereIdiom 默认值（Nina 卡片未覆盖时的兜底）
const DEFAULT_ATTACK_SOFTNESS = 0.5;
const DEFAULT_RELEASE_RATIO   = 1.0;
const DEFAULT_VOICE_COUNT     = 3;
const DEFAULT_VELO_RANGE: [number, number] = [40, 80];
const DEFAULT_CROSSFADE       = false;
const DEFAULT_OCTAVE_LAYERING = false;

// ============================================================
// 公开 API
// ============================================================

export interface AtmosphereRenderInput {
    /** 段落内的和弦序列（已带 voicing 数组，RELATIVE 空间） */
    chords: GeneratedChord[];
    /**
     * AtmosphereIdiom 参数 — 通常来自 musician.personnel.atmosphereOverrides。
     * Partial 接受：未提供的字段走默认值（DEFAULT_*）。
     */
    idiom: Partial<AtmosphereIdiom> | undefined;
    /**
     * 段落能量乘子 ∈ [0, 1]（BandEngine 输出，来自 section.energyLevel 归一化）。
     * 用于在 idiom.velocityRange 内做线性插值：低能量 → veloLo，高能量 → veloHi。
     */
    intensityScale: number;
}

export class AtmosphereRenderer {
    /**
     * 渲染 pad 织体 — 每和弦一个长音 block，voiceCount 个声部同时发声。
     *
     * 输出最大长度（C-4 文档化）：
     *   ≤ chords.length × (voiceCount + 1)   // +1 = 可选 octaveLayering 的低八度
     *
     * PRNG 消耗：0
     */
    public static render(input: AtmosphereRenderInput): NoteData[] {
        const { chords, idiom, intensityScale } = input;
        const out: NoteData[] = [];

        if (chords.length === 0) return out;

        // ----------------------------------------------------------------
        // Idiom 解析（缺省补默认）
        // ----------------------------------------------------------------
        const releaseRatio = idiom?.releaseRatio ?? DEFAULT_RELEASE_RATIO;
        const voiceCount = Math.max(1, (idiom?.voiceCount ?? DEFAULT_VOICE_COUNT) | 0);
        const velocityRange = idiom?.velocityRange ?? DEFAULT_VELO_RANGE;
        const crossfade = idiom?.crossfade ?? DEFAULT_CROSSFADE;
        const octaveLayering = idiom?.octaveLayering ?? DEFAULT_OCTAVE_LAYERING;
        // attackSoftness 当前 V1 不在 NoteData 层面表达（需 CC 73/76 在 MidiConverter 处理），保留参数面向未来
        void idiom?.attackSoftness;

        const [veloLo, veloHi] = velocityRange;
        const clampedIntensity = intensityScale < 0 ? 0 : (intensityScale > 1 ? 1 : intensityScale);
        const veloInt = Math.floor(veloLo + (veloHi - veloLo) * clampedIntensity + 0.5);
        const veloClamped = veloInt < 0 ? 0 : (veloInt > MIDI_MAX ? MIDI_MAX : veloInt);
        const velocity = veloClamped / MIDI_MAX;

        // ----------------------------------------------------------------
        // 每和弦发射 voiceCount 个长音
        // ----------------------------------------------------------------
        for (let i = 0; i < chords.length; i++) {
            const c = chords[i];
            const dur = c.endBeat - c.startBeat;
            if (dur < EPSILON) continue;
            if (!c.voicing || c.voicing.length === 0) continue;

            // 掐头：丢掉 voicing[0]（bass voice），取 voicing[1..] ≥ C3
            const padVoicing: number[] = [];
            for (let v = 1; v < c.voicing.length && padVoicing.length < voiceCount; v++) {
                if (c.voicing[v] >= ATMOSPHERE_MIN_PITCH) {
                    padVoicing.push(c.voicing[v]);
                }
            }
            if (padVoicing.length === 0) continue;

            // 可选：在最低 voice 下方再叠一个八度，增加厚度感
            // 仅当 voicing[0] - 12 仍 ≥ MIDI 0 (实际：voicing[0] 通常在 C3 附近，-12 = C2 = 36，安全)
            if (octaveLayering && c.voicing[0] !== undefined) {
                const lowOct = c.voicing[0] - 12;
                if (lowOct >= 0) padVoicing.push(lowOct);
            }

            // 计算实际 duration（releaseRatio + 可选 crossfade）
            let extendedDur: number;
            if (crossfade && i < chords.length - 1) {
                // crossfade 模式：延伸到下和弦 head + CROSSFADE_OVERLAP_BEATS
                extendedDur = (chords[i + 1].startBeat - c.startBeat) + CROSSFADE_OVERLAP_BEATS;
            } else {
                extendedDur = dur * releaseRatio;
            }
            if (extendedDur <= EPSILON) continue;

            for (let v = 0; v < padVoicing.length; v++) {
                out.push({
                    pitch: padVoicing[v],
                    onset: c.startBeat,
                    duration: extendedDur,
                    velocity,
                });
            }
        }

        // D-3：onset ASC, pitch ASC
        out.sort((a, b) => {
            const d = a.onset - b.onset;
            if (Math.abs(d) > EPSILON) return d;
            return a.pitch - b.pitch;
        });

        return out;
    }
}

// ============================================================
// Error
// ============================================================

export class AtmosphereRendererError extends Error {
    public readonly context: Record<string, unknown>;
    constructor(message: string, context: Record<string, unknown>) {
        super(message);
        this.name = 'AtmosphereRendererError';
        this.context = context;
    }
}
