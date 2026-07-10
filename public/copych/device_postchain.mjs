// SPDX-License-Identifier: GPL-3.0-only
// ============================================================
// device_postchain — 固件输出后链的 web 镜像（听感排查批2）
// ------------------------------------------------------------
// 忠实复刻固件 synth-PCM 之后的完整处理链（s16 整数域逐级仿真），使 Mac 上
// 听到的 = 固件送进 ES8388 DAC 的字节（唯一剩余差异=DAC/模拟/喇叭）。
//
// 固件链（纯合成路径，无 MikuTap PCM；参数同源锚）：
//   ① Copych 合成核心转换（audio_rander_copych.cpp ar_sf2_render 末段）：
//      v = (int32)(x × masterLift × global_vol × 32767 × g_ar_synth_gain[4.28])   ← C cast=向零截断
//      v = soft_clip_s16(v)（默认）或 hard_clip_s16(v)（ne clip hard）
//   ② 输出级（audio_rander.c render loop）：
//      m = (L+R)/2                       ← C 整数除法=向零截断
//      f = eq_process_sample((float)m)   ← 6 段级联 biquad，y=b0x+b1x1+b2x2+a1y1+a2y2
//      m = round-half-away(f)            ← (f>=0 ? f+0.5 : f-0.5) 再截断
//      o = hard_clip_s16(m)              ← 物理输出边界（纯合成路径 sc_en=false）
//   soft_clip_s16：K=24576, R=8191；|m|>K → K + trunc(R·e/(e+R))（整数除法）
//   hard_clip_s16：clamp [-32768, 32767]
//   EQ 24k 系数：audio_rander.c s_eq_coef（YD3411 小喇叭校正：70Hz HP 保护 + 145/225Hz body + 5-10k 抑制）
//
// 开关语义（每个组合尽量对应真实设备态）：
//   enabled  固定 true：Copych-only 正式输出不允许 raw synth 直出；兼容字段会被强制回 true
//   gain     off = ×1.0            ≡ 板上 `ne gain 100`
//   softclip off = Copych 走 hard ≡ 板上 `ne clip hard`
//   eq       off = 跳过 EQ         ≡ 板上 `ne eq off`
//   quantize off = 跳过全部整数格截断/舍入（纯 float 链）——★非设备真实路径，仅诊断
//   mono 折叠 + 终级 hard 饱和：链启用时恒执行（设备物理边界，非开关）
//   masterLift（风格/用户响度补偿）：链内，位于 soft/hard clip 与终级饱和之前
//
// parity 口径=听感级复刻非逐位（固件 float32 vs JS float64 的 EQ 运算差 << 可闻阈；
// 整数格/截断/舍入语义逐一照抄）。gain/clip/mono/clamp 对所有浏览器 ctx 采样率生效；
// 6 段 EQ 仅 sampleRate==24000 时启用（系数绑 24k）。这样真实声卡返回 48k 时不会丢掉
// 设备增益导致“几乎没声”，但也不会误把 24k EQ 系数套到 48k。
// worklet 线程合同：逐样本处理路径零分配（状态构造期建好）；电平表 ~250ms 低频
// flush/postMessage 会分配小对象——非硬实时零 GC 合同（codex P3 口径）。
// ============================================================

/* 24k EQ 系数（需与固件 main/audio_rander/audio_rander.c s_eq_coef @24000 同步）。
 * 2026-07-10: YD3411-H-YC16-8B(34×11×4mm, 4Ω, 2W, F0≈630Hz@4CC) 小喇叭口径。
 * 旧 v3 已恢复 120/200Hz 鼓身，但实测 REW 红线 5-10kHz 高峰仍会放大刺耳/滋滋，
 * 主观上反而显得低频薄。2026-07-10 v4 采用“小喇叭 Harman-like”安全曲线：
 * 50Hz 仍保护，145/225Hz 只轻补身体感，580Hz 轻削纸盒感，5.8k/7k+ 大幅压高频峰。
 * 不硬推 100Hz 以下，遵守 YD3411 34×11×4mm / 4cc / F0≈630Hz 的物理极限。 */
export const EQ_COEF_24K = [
    { b0: 0.9871232795306327, b1: -1.9742465590612654, b2: 0.9871232795306327,
      a1: 1.9740807916935565, a2: -0.9744123264289741 },  /* HP2 ~70Hz Q0.707: sub/over-excursion protection */
    { b0: 1.0064418293061508, b1: -1.9581063401864138, b2: 0.9530762042451866,
      a1: 1.9581063401864138, a2: -0.9595180335513372 },  /* PK +2.4dB ~145Hz Q0.8: safe kick/bass body */
    { b0: 1.0043881557625178, b1: -1.9373960477614829, b2: 0.9363739299943913,
      a1: 1.9373960477614829, a2: -0.9407620857569091 },  /* PK +1.2dB ~225Hz Q0.9: drum/bass warmth */
    { b0: 0.9855140376537236, b1: -1.8239790145999057, b2: 0.8596961745091007,
      a1: 1.8239790145999057, a2: -0.8452102121628244 },  /* PK -1.8dB ~580Hz Q1.0: box/cardboard control */
    { b0: 0.9011737822179814, b1: 0.07908853201967374, b2: 0.6099963137776717,
      a1: -0.07908853201967374, a2: -0.5111700959956531 }, /* PK -4.5dB ~6.2kHz Q2.0: harsh peak / FM fizz */
    { b0: 0.7630971118034126, b1: 0.3528365355030781, b2: 0.11992893085810055,
      a1: -0.11858579787427957, a2: -0.11727678029031158 }, /* HS -5.5dB ~7kHz S0.8: Harman-like treble roll-off */
];

export const DEVICE_GAIN_DEFAULT = 4.28;   /* AR_SYNTH_GAIN_DEFAULT（板测定值，global_vol=1.0 口径） */
export const MASTER_LIFT_MIN = 0.05;
export const MASTER_LIFT_MAX = 4;
export const DEVICE_POSTCHAIN_DEFAULT_PRESET = Object.freeze({
    enabled: true,
    gain: true,
    eq: true,
    softclip: true,
    quantize: true,
    masterLift: 1,
});

const K_SOFT = 24576;   /* soft_clip knee = 75% 满幅 */
const R_SOFT = 8191;    /* 渐近余量 32767-K */
const DB_FLOOR = -120;

function dbfs(linear) {
    return linear > 1e-12 ? 20 * Math.log10(linear) : DB_FLOOR;
}

function classifyDrive(preRmsDb, softKneeRate, hardClipRate) {
    if (hardClipRate >= 0.0005) return 'hard-clipping';
    if (softKneeRate >= 0.08) return 'overdriven';
    if (softKneeRate >= 0.01) return 'soft-knee';
    if (preRmsDb < -30) return 'very-quiet';
    if (preRmsDb < -24) return 'quiet';
    return 'healthy';
}

/* soft_clip_s16 逐语义复刻（入参 s16 域数值；quantized=true 时含固件整数除法截断） */
export function softClipS16(m, quantized) {
    if (m > K_SOFT) {
        const e = m - K_SOFT;
        const t = (R_SOFT * e) / (e + R_SOFT);
        return K_SOFT + (quantized ? Math.trunc(t) : t);
    }
    if (m < -K_SOFT) {
        const e = -K_SOFT - m;
        const t = (R_SOFT * e) / (e + R_SOFT);
        return -K_SOFT - (quantized ? Math.trunc(t) : t);
    }
    return m;
}

/* hard_clip_s16 复刻（clamp [-32768, 32767]） */
export function hardClipS16(m) {
    if (m > 32767) return 32767;
    if (m < -32768) return -32768;
    return m;
}

export function createDevicePostChain(contextSampleRate) {
    const eqRateOk = contextSampleRate === 24000;
    /* EQ 级联状态（6 段 ×{x1,x2,y1,y2}，构造期一次分配） */
    const st = EQ_COEF_24K.map(() => ({ x1: 0, x2: 0, y1: 0, y2: 0 }));

    const cfg = { ...DEVICE_POSTCHAIN_DEFAULT_PRESET };

    /* 电平表（pre/post 均为链输出真值；保留 post 字段兼容 UI/测试，不再做链外音量）。
     * 归一域（/32767 后）。累计窗由调用方 flush。 */
    const meters = { prePeak: 0, preRms2: 0, postPeak: 0, postRms2: 0, softKnee: 0, hardClip: 0, n: 0 };

    function eqReset() {
        for (const s of st) { s.x1 = 0; s.x2 = 0; s.y1 = 0; s.y2 = 0; }
    }

    function eqSample(x) {
        for (let i = 0; i < EQ_COEF_24K.length; i++) {
            const c = EQ_COEF_24K[i], s = st[i];
            const y = c.b0 * x + c.b1 * s.x1 + c.b2 * s.x2 + c.a1 * s.y1 + c.a2 * s.y2;
            s.x2 = s.x1; s.x1 = x;
            s.y2 = s.y1; s.y1 = y;
            x = y;
        }
        return x;
    }

    return {
        /** 实际生效态：Copych-only 正式输出恒经设备后链；非 24k 只跳过 EQ。 */
        isActive() { return true; },
        srOk() { return true; },
        eqRateOk() { return eqRateOk; },
        config() { return { ...cfg }; },

        set(partial) {
            const wasEqOn = eqRateOk && cfg.eq;
            Object.assign(cfg, partial);
            cfg.enabled = true;
            if (!Number.isFinite(cfg.masterLift)) cfg.masterLift = 1;
            cfg.masterLift = Math.max(MASTER_LIFT_MIN, Math.min(MASTER_LIFT_MAX, cfg.masterLift));
            const nowEqOn = eqRateOk && cfg.eq;
            if (nowEqOn && !wasEqOn) eqReset();   /* 重开清滤波状态（镜像固件 s_eq_reset_req 语义） */
        },

        /** 电平表快照并清窗（RMS=sqrt(mean(x²))） */
        flushMeters() {
            const n = meters.n || 1;
            const preRms = Math.sqrt(meters.preRms2 / n);
            const postRms = Math.sqrt(meters.postRms2 / n);
            const softKneeRate = meters.softKnee / (n * 2);
            const hardClipRate = meters.hardClip / n;
            const prePeakDb = dbfs(meters.prePeak);
            const preRmsDb = dbfs(preRms);
            const postPeakDb = dbfs(meters.postPeak);
            const postRmsDb = dbfs(postRms);
            const out = {
                prePeak: meters.prePeak, preRms,
                postPeak: meters.postPeak, postRms,
                prePeakDb, preRmsDb,
                postPeakDb, postRmsDb,
                headroomDb: Math.max(0, -prePeakDb),
                crestDb: Math.max(0, prePeakDb - preRmsDb),
                softKnee: meters.softKnee,
                hardClip: meters.hardClip,
                samples: meters.n,
                softKneeRate,
                hardClipRate,
                driveState: classifyDrive(preRmsDb, softKneeRate, hardClipRate),
            };
            meters.prePeak = 0; meters.preRms2 = 0;
            meters.postPeak = 0; meters.postRms2 = 0;
            meters.softKnee = 0; meters.hardClip = 0; meters.n = 0;
            return out;
        },

        /** 就地处理（L/R Float32Array，len 样本）。零分配。 */
        process(L, R, len) {
            const g = 32767 * cfg.masterLift * (cfg.gain ? DEVICE_GAIN_DEFAULT : 1.0);
            const q = cfg.quantize;
            const eqActive = cfg.eq && eqRateOk;
            for (let i = 0; i < len; i++) {
                /* ① Copych：float→s16 域（C cast=向零截断）→ soft/hard clip */
                let l = L[i] * g, r = R[i] * g;
                let hardClipped = false;
                if (q) { l = Math.trunc(l); r = Math.trunc(r); }
                if (cfg.softclip) {
                    if (l > K_SOFT || l < -K_SOFT) meters.softKnee++;
                    if (r > K_SOFT || r < -K_SOFT) meters.softKnee++;
                } else {
                    if (l > 32767 || l < -32768 || r > 32767 || r < -32768) hardClipped = true;
                }
                l = cfg.softclip ? softClipS16(l, q) : hardClipS16(l);
                r = cfg.softclip ? softClipS16(r, q) : hardClipS16(r);
                /* ② 输出级：mono 折叠（C 整除向零截断）→ EQ → round-half-away → 终级饱和 */
                let m = (l + r) / 2;
                if (q) m = Math.trunc(m);
                if (eqActive) {
                    const f = eqSample(m);
                    m = q ? Math.trunc(f >= 0 ? f + 0.5 : f - 0.5) : f;
                }
                if (m > 32767 || m < -32768) hardClipped = true;
                m = hardClipS16(m);   /* 物理输出边界，恒执行 */
                if (hardClipped) meters.hardClip++;
                let o = m / 32767;
                /* meters（链输出；无链外音量） */
                const ao = o < 0 ? -o : o;
                if (ao > meters.prePeak) meters.prePeak = ao;
                meters.preRms2 += o * o;
                const ap = o < 0 ? -o : o;
                if (ap > meters.postPeak) meters.postPeak = ap;
                meters.postRms2 += o * o;
                meters.n++;
                L[i] = o; R[i] = o;   /* 双声道同值写回（镜像固件 s_sf2_buf L=R） */
            }
        },
    };
}
