// ============================================================
// RenderContext — 多维气象参数与渲染上下文统一抽象(Phase 0)
// ============================================================
//
// 设计动机:
//   引擎从"决策一次性下发 + Realizer 渲染整段"模式,演进为
//   "决策 + 调制(beat 级)"模式。所有 Idiom 接收统一的 RenderContext,
//   通过 WeatherSampler 在 render 时按 beat 取多维参数(K/T/S/R/G)。
//
// Phase 0 范围(本文件):
//   - 仅引入类型与 ConstantWeatherSampler 占位实现
//   - 各 Idiom 接受 context 但不消费(bit-exact 保证)
//   - 为 Phase 1 信息遮罩 / Phase 2 weather 真接入 / Phase 5+ Live 模式
//     一次性铺好接口轨道
//
// 三种 sampler 实现的时间线:
//   - Phase 0(now): ConstantWeatherSampler — 常量返回,行为零变化
//   - Phase 2:       CurveWeatherSampler — 离线全曲曲线采样(per-section anchor + 插值)
//   - Phase 5+:      RollingWeatherSampler — Live 模式滚动窗口估计
//
// 约束:
//   - WeatherSampler.at(beat) 必须是 O(1) 或近似 O(1) 查询 — Idiom 内会高频调用
//   - 不持有可变状态(确定性) — 同一 sampler 实例多次 at(beat) 必须返回同值
//   - 实时模式的"滚动估计"也用 deterministic 实现,session seed 派生
//
// 与现有架构关系:
//   - 不替代 BandPlan / PianoAccompParams 等 section 级决策
//   - 而是叠加一层"per-beat 微调"维度
//   - Phase 2+ 各 Idiom 在 render 循环内调 context.weather.at(currentBeat),
//     调制节奏算子概率 / voicing 偏好 / velocity / ornament 等
//
// ============================================================

/**
 * 多维气象瞬时快照 — 同一 beat 上各维度的标量值。
 *
 * 维度时间线:
 *   Phase 0/1: 三维(K/T/S)+ r/g 可选(占位,ConstantSampler 不填)
 *   Phase 2:   **五维齐全(K/T/S/R/G)全必填** — CurveWeatherSampler 接入
 *              消费者 Phase 2 唯一:VoicingMask.computeChordMask 用 T 硬切档
 *   Phase 3:   Idiom 算法层全面消费(K → rhythm topology mutator / T → voicing
 *              register / S → sustain ratio / R → chromatic approach / G → microtiming)
 *
 * 取值范围: 全部 [0, 1] float(clamp01 保证)
 *
 * 维度语义(用户讨论确认):
 *   K (Kinetic)       — 时间密度 / 忙碌度。高 → 16th 涌现;低 → 长音休止
 *   T (Timbral)       — 色彩明暗。高 → 上行 ext / 9-13 / register 上抬;低 → guide-tone shell
 *   S (Spatial)       — 心理距离 / sustain。高 → 长 pedal / release ratio 大;低 → 干 staccato
 *   R (Risk)          — 调外 / chromatic / 冒险度。pop 强制 ≤ 0.2,jazz 0.3-0.7
 *   G (Groove)        — 微观律动 / 人性。高 → push/lay-back 微偏移大、swing 深、velocity 波动大
 */
export interface WeatherSnapshot {
    /** Kinetic — 时间密度 [0,1] */
    k: number;
    /** Timbral — 色彩明暗 [0,1] */
    t: number;
    /** Spatial — 心理距离 / sustain [0,1] */
    s: number;
    /** Risk — 调外 / chromatic 概率 [0,1] */
    r: number;
    /** Groove — 微观律动人性化 [0,1] */
    g: number;
}

/**
 * 多维气象采样器 — 按 beat 取 WeatherSnapshot。
 *
 * 接口契约:
 *   - at(beat) 必须是确定性 — 同 beat 必返回同 snapshot
 *   - O(1) 或近似 O(1) — Idiom 在 render 循环内高频调用
 *   - 不持有可变状态
 *
 * 实现策略(按 phase):
 *   - ConstantWeatherSampler(Phase 0): 返回固定 snapshot
 *   - CurveWeatherSampler(Phase 2): 离线预算曲线 + 插值
 *   - RollingWeatherSampler(Phase 5+): Live 模式滚动估计 + session seed 确定性
 */
export interface WeatherSampler {
    at(beat: number): WeatherSnapshot;
}

/**
 * 常量采样器 — 任意 beat 返回构造时传入的固定 snapshot。
 *
 * Phase 0-1b 主用;Phase 2 起 Conductor 用 CurveWeatherSampler 替代,
 * 本类保留作:
 *   - scripts/* dev 校验脚本(createDefaultRenderContext)
 *   - 单元测试 fixture
 *   - Live 模式(Phase 5+)初始 warm-up 期占位
 */
export class ConstantWeatherSampler implements WeatherSampler {
    private readonly snapshot: WeatherSnapshot;

    constructor(snapshot: WeatherSnapshot) {
        this.snapshot = snapshot;
    }

    public at(_beat: number): WeatherSnapshot {
        return this.snapshot;
    }
}

/**
 * Idiom 渲染态(跨调用保留) — Phase 0 空接口占位。
 *
 * Phase 5+ Live 模式时各 Idiom 扩展具体字段:
 *   - BassIdiomState:    { lastBass: number | undefined }
 *   - PianoAccompState:  { lastLhBass: number | undefined; chordIdx: number }
 *   - DrumIdiomState:    { stepCarry: number }
 *   等等
 *
 * 离线模式下 prevState 始终 undefined,Idiom 内部状态在单次 render 调用
 * 内完成。Live 模式下 LiveAccompanist 维护 state 跨 bar 调用,实现连贯
 * voice leading。
 */
export interface IdiomRenderState {
    // Phase 0: 空接口占位。
    // 后续按需扩展(参见 file header)。
    readonly _placeholder?: never;
}

/**
 * 渲染上下文 — 所有 Idiom render(input) 的统一上下文字段。
 *
 * 集成在各 Idiom 自己的 Input 接口中(如 BassIdiomInput.context),
 * 而非作为 realize() 第二参数 — 这是为了保持
 * InstrumentRealizer<TInput> 单参泛型接口的简洁。
 *
 * Phase 0 各 Idiom 接受 context 但不消费,行为完全不变。
 *
 * Phase 2+ Idiom 在 render 循环内通过 context.weather.at(beat) 取气象,
 *   用于调制节奏算子 / voicing 选择 / velocity 缩放等。
 *
 * Phase 5+ Live 模式 prevState 携带跨 bar voice-leading 状态。
 */
export interface RenderContext {
    /**
     * 多维气象采样器。Phase 0 是 ConstantWeatherSampler({k:0.5,t:0.5,s:0.5})。
     * Phase 2 起切换为 CurveWeatherSampler。
     */
    weather: WeatherSampler;

    /**
     * 允许 Idiom 向前看的最大拍数。
     *
     * 离线模式: 大数(默认 9999)— Idiom 实际只看 i+1 chord,远未触及上限。
     * Live 模式: 8(2 小节 @ 4/4)— Idiom 必须自我约束 lookahead ≤ 此值。
     *
     * Phase 0 实测各 Idiom 都只看 nextChord(i+1),约 1-2 拍,远小于
     * 默认值。本字段是契约文档,Phase 5+ Live 模式收紧时不需要改 Idiom 代码。
     */
    lookaheadLimit: number;

    /**
     * 跨 render 调用保留的渲染态(可选)。
     *
     * Phase 0: 永远 undefined。
     * Phase 5+ Live 模式: 由 LiveAccompanist 维护,bar-by-bar 传入。
     */
    prevState?: IdiomRenderState;
}

// ============================================================
// 便捷工厂(Phase 0 唯一入口)
// ============================================================

/**
 * 构造默认 RenderContext(5 维 ConstantSampler 占位)。
 *
 * Phase 0-1b 期间 Conductor 唯一入口;Phase 2 起 Conductor 改用
 * CurveWeatherSampler 直接构造,本工厂留作 scripts / 测试 / Live 暖机用。
 *
 * 默认值含义:K/T/S 中庸 0.5,R 偏低 0.3(默认偏保守),G 中庸 0.5。
 */
export function createDefaultRenderContext(): RenderContext {
    return {
        weather: new ConstantWeatherSampler({
            k: 0.5, t: 0.5, s: 0.5, r: 0.3, g: 0.5,
        }),
        lookaheadLimit: 9999,
        prevState: undefined,
    };
}
