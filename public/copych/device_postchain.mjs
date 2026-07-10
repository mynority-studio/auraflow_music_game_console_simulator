// SPDX-License-Identifier: GPL-3.0-only
// ============================================================
// device_postchain — 固件输出后链的 web 镜像（听感排查批2）
// ------------------------------------------------------------
// 忠实复刻固件 synth-PCM 之后的完整处理链（s16 整数域逐级仿真），使 Mac 上
// 听到的 = 固件送进 ES8388 DAC 的字节（唯一剩余差异=DAC/模拟/喇叭）。
//
// 固件链（纯合成路径，无 MikuTap PCM；参数同源锚）：
//   ① backend 转换（audio_rander_copych.cpp ar_sf2_render 末段）：
//      v = (int32)(x × global_vol × 32767 × g_ar_synth_gain[4.28])   ← C cast=向零截断
//      v = soft_clip_s16(v)（默认）或 hard_clip_s16(v)（ne clip hard）
//   ② 输出级（audio_rander.c render loop）：
//      m = (L+R)/2                       ← C 整数除法=向零截断
//      f = eq_process_sample((float)m)   ← 6 段级联 biquad，y=b0x+b1x1+b2x2+a1y1+a2y2
//      m = round-half-away(f)            ← (f>=0 ? f+0.5 : f-0.5) 再截断
//      o = hard_clip_s16(m)              ← 物理输出边界（纯合成路径 sc_en=false）
//   soft_clip_s16：K=24576, R=8191；|m|>K → K + trunc(R·e/(e+R))（整数除法）
//   hard_clip_s16：clamp [-32768, 32767]
//   EQ 24k 系数：audio_rander.c s_eq_coef（miniDSP 小喇叭校正：213Hz HP²×2 + 4 峰值）
//
// 开关语义（每个组合尽量对应真实设备态）：
//   gain     off = ×1.0            ≡ 板上 `ne gain 100`
//   softclip off = backend 走 hard ≡ 板上 `ne clip hard`
//   eq       off = 跳过 EQ         ≡ 板上 `ne eq off`
//   quantize off = 跳过全部整数格截断/舍入（纯 float 链）——★非设备真实路径，仅诊断
//   mono 折叠 + 终级 hard 饱和：链启用时恒执行（设备物理边界，非开关）
//   audition trim（试听等响，dB）：链外，不属于设备镜像，不进 parity 测试
//
// parity 口径=听感级复刻非逐位（固件 float32 vs JS float64 的 EQ 运算差 << 可闻阈；
// 整数格/截断/舍入语义逐一照抄）。仅 sampleRate==24000 有效（系数绑 24k）。
// worklet 线程合同：逐样本处理路径零分配（状态构造期建好）；电平表 ~250ms 低频
// flush/postMessage 会分配小对象——非硬实时零 GC 合同（codex P3 口径）。
// ============================================================

/* 24k EQ 系数（逐值抄自主仓 main/audio_rander/audio_rander.c s_eq_coef @24000；
 * 来源 eq_config/2026年7月9日 minidsp 24k.txt）。改固件系数须同步此表。 */
export const EQ_COEF_24K = [
    { b0: 0.94597685600279,   b1: -1.89195371200558,   b2: 0.94597685600279,
      a1: 1.8890330793945247, a2: -0.8948743446166357 },   /* HP2 ~213Hz (1/2) */
    { b0: 0.94597685600279,   b1: -1.89195371200558,   b2: 0.94597685600279,
      a1: 1.8890330793945247, a2: -0.8948743446166357 },   /* HP2 ~213Hz (2/2) */
    { b0: 0.9906671431073918, b1: -1.9142689924816272, b2: 0.945421046046613,
      a1: 1.9142689924816272, a2: -0.9360881891540047 },   /* PK ~560Hz */
    { b0: 0.9909901053576943, b1: -1.783561912560695,  b2: 0.9284755613496762,
      a1: 1.783561912560695,  a2: -0.9194656667073703 },   /* PK ~1.44kHz */
    { b0: 0.9305853181376358, b1: -0.1560080480606909, b2: 0.7695466506751609,
      a1: 0.1560080480606909, a2: -0.7001319688127966 },   /* PK ~5.6kHz */
    { b0: 0.7415117894281078, b1: 0.8855201829854881,  b2: 0.5626551540212016,
      a1: -0.8855201829854881, a2: -0.3041669434493095 },  /* PK ~9.6kHz */
];

export const DEVICE_GAIN_DEFAULT = 4.28;   /* AR_SYNTH_GAIN_DEFAULT（板测定值，global_vol=1.0 口径） */

const K_SOFT = 24576;   /* soft_clip knee = 75% 满幅 */
const R_SOFT = 8191;    /* 渐近余量 32767-K */

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
    const srOk = contextSampleRate === 24000;
    /* EQ 级联状态（6 段 ×{x1,x2,y1,y2}，构造期一次分配） */
    const st = EQ_COEF_24K.map(() => ({ x1: 0, x2: 0, y1: 0, y2: 0 }));

    const cfg = {
        enabled: false,
        gain: true,       /* ×4.28（off=×1.0 ≡ ne gain 100） */
        eq: true,         /* off ≡ ne eq off */
        softclip: true,   /* off=backend hard clip ≡ ne clip hard */
        quantize: true,   /* off=纯 float 链（非设备路径，仅诊断） */
        trimDb: 0,        /* 试听等响（链外，非镜像） */
    };
    let trimLin = 1;

    /* 电平表（pre=trim 前=链输出真值[判断链是否推爆]；post=trim 后=耳朵等响用）。
     * 归一域（/32767 后）。累计窗由调用方 flush。 */
    const meters = { prePeak: 0, preRms2: 0, postPeak: 0, postRms2: 0, n: 0 };

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
        /** 实际生效态（enabled 请求 && 24k）——供 processor 回报主线程防状态分叉 */
        isActive() { return cfg.enabled && srOk; },
        srOk() { return srOk; },
        config() { return { ...cfg }; },

        set(partial) {
            const wasEqOn = cfg.enabled && srOk && cfg.eq;
            Object.assign(cfg, partial);
            trimLin = Math.pow(10, (cfg.trimDb || 0) / 20);
            const nowEqOn = cfg.enabled && srOk && cfg.eq;
            if (nowEqOn && !wasEqOn) eqReset();   /* 重开清滤波状态（镜像固件 s_eq_reset_req 语义） */
        },

        /** 电平表快照并清窗（RMS=sqrt(mean(x²))） */
        flushMeters() {
            const n = meters.n || 1;
            const out = {
                prePeak: meters.prePeak, preRms: Math.sqrt(meters.preRms2 / n),
                postPeak: meters.postPeak, postRms: Math.sqrt(meters.postRms2 / n),
            };
            meters.prePeak = 0; meters.preRms2 = 0;
            meters.postPeak = 0; meters.postRms2 = 0; meters.n = 0;
            return out;
        },

        /** 就地处理（L/R Float32Array，len 样本）。零分配。 */
        process(L, R, len) {
            if (!cfg.enabled || !srOk) return;
            const g = 32767 * (cfg.gain ? DEVICE_GAIN_DEFAULT : 1.0);
            const q = cfg.quantize;
            for (let i = 0; i < len; i++) {
                /* ① backend：float→s16 域（C cast=向零截断）→ soft/hard clip */
                let l = L[i] * g, r = R[i] * g;
                if (q) { l = Math.trunc(l); r = Math.trunc(r); }
                l = cfg.softclip ? softClipS16(l, q) : hardClipS16(l);
                r = cfg.softclip ? softClipS16(r, q) : hardClipS16(r);
                /* ② 输出级：mono 折叠（C 整除向零截断）→ EQ → round-half-away → 终级饱和 */
                let m = (l + r) / 2;
                if (q) m = Math.trunc(m);
                if (cfg.eq) {
                    const f = eqSample(m);
                    m = q ? Math.trunc(f >= 0 ? f + 0.5 : f - 0.5) : f;
                }
                m = hardClipS16(m);   /* 物理输出边界，恒执行 */
                let o = m / 32767;
                /* meters（pre=trim 前）+ trim（链外，试听等响） */
                const ao = o < 0 ? -o : o;
                if (ao > meters.prePeak) meters.prePeak = ao;
                meters.preRms2 += o * o;
                o *= trimLin;
                const ap = o < 0 ? -o : o;
                if (ap > meters.postPeak) meters.postPeak = ap;
                meters.postRms2 += o * o;
                meters.n++;
                L[i] = o; R[i] = o;   /* 双声道同值写回（镜像固件 s_sf2_buf L=R） */
            }
        },
    };
}
