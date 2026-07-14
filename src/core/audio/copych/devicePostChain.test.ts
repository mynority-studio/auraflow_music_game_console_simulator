// SPDX-License-Identifier: GPL-3.0-only
// 设备后链 DSP 单测（听感排查批2）——对 public/copych/device_postchain.mjs
// 逐语义证伪：mono 折叠抵消 / EQ 差分方程 / softclip 手算锚点 / 量化截断 /
// 非 24k 只跳过 EQ 不跳过增益 / 终级饱和恒在 / EQ 重开清状态 / masterLift 链内。
// 当前 SF2 调平阶段默认 enabled=false，测试里显式 enabled=true 覆盖 DSP 行为。
import { describe, expect, it } from 'vitest';
import { createDevicePostChain, softClipS16, hardClipS16, EQ_COEF_24K, DEVICE_GAIN_DEFAULT, DEFAULT_MASTER_LIFT, DEVICE_POSTCHAIN_DEFAULT_PRESET, MASTER_LIFT_MAX, MASTER_LIFT_MIN } from '../../../../public/copych/device_postchain.mjs';
import { COPYCH_DEFAULT_MASTER_LIFT, COPYCH_DEVICE_POSTCHAIN_PRESET, COPYCH_MASTER_LIFT_MAX, COPYCH_MASTER_LIFT_MIN } from './CopychSynthFacade';

const mk = (sr = 24000) => createDevicePostChain(sr);
const buf = (vals: number[]) => new Float32Array(vals);

function eqMagnitudeDb(freqHz: number): number {
    const w = -2 * Math.PI * freqHz / 24000;
    const z1 = { re: Math.cos(w), im: Math.sin(w) };
    const z2 = { re: Math.cos(2 * w), im: Math.sin(2 * w) };
    let h = { re: 1, im: 0 };
    for (const c of EQ_COEF_24K as Array<{ b0: number; b1: number; b2: number; a1: number; a2: number }>) {
        const n = {
            re: c.b0 + c.b1 * z1.re + c.b2 * z2.re,
            im: c.b1 * z1.im + c.b2 * z2.im,
        };
        const d = {
            re: 1 - c.a1 * z1.re - c.a2 * z2.re,
            im: -c.a1 * z1.im - c.a2 * z2.im,
        };
        const inv = d.re * d.re + d.im * d.im;
        const stage = {
            re: (n.re * d.re + n.im * d.im) / inv,
            im: (n.im * d.re - n.re * d.im) / inv,
        };
        h = {
            re: h.re * stage.re - h.im * stage.im,
            im: h.re * stage.im + h.im * stage.re,
        };
    }
    return 20 * Math.log10(Math.hypot(h.re, h.im) + 1e-12);
}

describe('devicePostChain', () => {
    it('默认是 SF2 直出审计 bypass，facade 与 worklet 预设保持同源', () => {
        expect(DEVICE_POSTCHAIN_DEFAULT_PRESET).toEqual(COPYCH_DEVICE_POSTCHAIN_PRESET);
        expect(MASTER_LIFT_MIN).toBe(COPYCH_MASTER_LIFT_MIN);
        expect(MASTER_LIFT_MAX).toBe(COPYCH_MASTER_LIFT_MAX);
        expect(DEFAULT_MASTER_LIFT).toBe(COPYCH_DEFAULT_MASTER_LIFT);
        const c = mk();
        expect(c.config()).toMatchObject(COPYCH_DEVICE_POSTCHAIN_PRESET);
        expect(c.isActive()).toBe(false);
    });

    it('enabled=false 时全链 passthrough：用于 SF2 raw 直出调平', () => {
        const c = mk();
        c.set({ enabled: false, gain: false, eq: false, softclip: false, quantize: false });
        expect(c.config().enabled).toBe(false);
        expect(c.isActive()).toBe(false);
        const L = buf([0.25]), R = buf([-0.5]);
        c.process(L, R, 1);
        expect(L[0]).toBe(0.25);
        expect(R[0]).toBe(-0.5);
    });

    it('mono 折叠：L=1/R=-1 → 全链输出 0（计划门 R2-P1 合同）', () => {
        const c = mk();
        c.set({ enabled: true, gain: false, eq: false, softclip: false, quantize: false, masterLift: 1 });
        const L = buf([1]), R = buf([-1]);
        c.process(L, R, 1);
        expect(L[0]).toBe(0);
        expect(R[0]).toBe(0);
    });

    it('softClipS16 手算锚点：32767→28671（既有文档值）/24577→24576/膝下透传/负对称', () => {
        expect(softClipS16(32767, true)).toBe(28671);
        expect(softClipS16(24577, true)).toBe(24576);
        expect(softClipS16(12345, true)).toBe(12345);
        expect(softClipS16(-32767, true)).toBe(-28671);
    });

    it('hardClipS16：clamp [-32768,32767]（固件逐语义）', () => {
        expect(hardClipS16(40000)).toBe(32767);
        expect(hardClipS16(-40000)).toBe(-32768);
        expect(hardClipS16(123)).toBe(123);
    });

    it('EQ 差分方程：impulse 前 8 样本 == 独立复算（float64 逐值）', () => {
        const c = mk();
        c.set({ enabled: true, gain: false, eq: true, softclip: false, quantize: false, masterLift: 1 });
        const N = 8;
        const L = new Float32Array(N), R = new Float32Array(N);
        L[0] = 1000 / 32767; R[0] = 1000 / 32767;
        // 独立复算：同输入走同差分方程（测试内自建状态，不用被测代码）
        const st = (EQ_COEF_24K as Array<{ b0: number; b1: number; b2: number; a1: number; a2: number }>)
            .map(() => ({ x1: 0, x2: 0, y1: 0, y2: 0 }));
        const expected: number[] = [];
        for (let i = 0; i < N; i++) {
            const lf = Math.fround(L[i]);            // Float32Array 读出=f32 值
            let x = (lf * 32767 + lf * 32767) / 2;   // gain off=×1，mono 折叠（float 路径）
            for (let s = 0; s < EQ_COEF_24K.length; s++) {
                const co = EQ_COEF_24K[s], t = st[s];
                const y = co.b0 * x + co.b1 * t.x1 + co.b2 * t.x2 + co.a1 * t.y1 + co.a2 * t.y2;
                t.x2 = t.x1; t.x1 = x; t.y2 = t.y1; t.y1 = y;
                x = y;
            }
            expected.push(Math.fround(hardClipS16(x) / 32767));   // 写回 Float32Array=f32
        }
        c.process(L, R, N);
        for (let i = 0; i < N; i++) expect(L[i]).toBeCloseTo(expected[i], 10);
    });

    it('YD3411 EQ 小喇叭 Harman-like：保护 sub，轻补 body，大幅压 5-10k 刺耳峰', () => {
        expect(eqMagnitudeDb(50)).toBeLessThanOrEqual(-6.0);
        expect(eqMagnitudeDb(70)).toBeLessThanOrEqual(-1.6);
        expect(eqMagnitudeDb(75)).toBeGreaterThanOrEqual(-1.5);
        expect(eqMagnitudeDb(80)).toBeGreaterThanOrEqual(-1);
        expect(eqMagnitudeDb(100)).toBeGreaterThanOrEqual(0.8);
        expect(eqMagnitudeDb(100)).toBeLessThanOrEqual(1.6);
        expect(eqMagnitudeDb(120)).toBeGreaterThanOrEqual(1.8);
        expect(eqMagnitudeDb(150)).toBeGreaterThanOrEqual(2.4);
        expect(eqMagnitudeDb(150)).toBeLessThanOrEqual(3.2);
        expect(eqMagnitudeDb(200)).toBeGreaterThanOrEqual(2.3);
        expect(eqMagnitudeDb(200)).toBeLessThanOrEqual(3.1);
        expect(eqMagnitudeDb(250)).toBeGreaterThanOrEqual(1.7);
        expect(eqMagnitudeDb(250)).toBeLessThanOrEqual(2.4);
        expect(eqMagnitudeDb(450)).toBeLessThanOrEqual(-0.5);
        expect(eqMagnitudeDb(580)).toBeLessThanOrEqual(-1.1);
        expect(eqMagnitudeDb(3000)).toBeGreaterThanOrEqual(-1.1);
        expect(eqMagnitudeDb(4000)).toBeGreaterThanOrEqual(-2.5);
        expect(eqMagnitudeDb(5200)).toBeLessThanOrEqual(-5.7);
        expect(eqMagnitudeDb(5800)).toBeLessThanOrEqual(-7.0);
        expect(eqMagnitudeDb(6500)).toBeLessThanOrEqual(-6.4);
        expect(eqMagnitudeDb(8000)).toBeLessThanOrEqual(-5.0);
        expect(eqMagnitudeDb(10000)).toBeLessThanOrEqual(-5.0);
    });

    it('量化：非整 s16 值向零截断（Copych C cast 语义）', () => {
        const c = mk();
        c.set({ enabled: true, gain: false, eq: false, softclip: false, quantize: true, masterLift: 1 });
        const x = 1000.7 / 32767;
        const L = buf([x]), R = buf([x]);
        c.process(L, R, 1);
        expect(L[0]).toBeCloseTo(1000 / 32767, 6);
    });

    it('非 24k ctx 不再丢掉后链响度：gain/clip/mono 仍生效，只跳过 24k EQ', () => {
        const c = mk(48000);
        c.set({ enabled: true, gain: true, quantize: true, masterLift: 1 });
        expect(c.isActive()).toBe(true);
        expect(c.srOk()).toBe(true);
        expect(c.eqRateOk()).toBe(false);
        const L = buf([0.01]), R = buf([0.01]);
        c.process(L, R, 1);
        const expected = Math.trunc(Math.fround(0.01) * 32767 * DEVICE_GAIN_DEFAULT) / 32767;
        expect(L[0]).toBeCloseTo(expected, 6);
    });

    it('copych 默认预设保持 raw bypass；48k 只影响 EQ 可用性状态', () => {
        const c24 = mk(24000);
        c24.set(COPYCH_DEVICE_POSTCHAIN_PRESET);
        expect(c24.isActive()).toBe(false);
        expect(c24.eqRateOk()).toBe(true);
        expect(c24.config()).toMatchObject({
            enabled: false,
            gain: false,
            eq: false,
            softclip: false,
            quantize: false,
            masterLift: DEFAULT_MASTER_LIFT,
        });

        const c48 = mk(48000);
        c48.set(COPYCH_DEVICE_POSTCHAIN_PRESET);
        expect(c48.isActive()).toBe(false);
        expect(c48.srOk()).toBe(true);
        expect(c48.eqRateOk()).toBe(false);
    });

    it('终级饱和恒在：超幅输入被 clamp（softclip off 时=Copych hard→物理边界）', () => {
        const c = mk();
        c.set({ enabled: true, gain: false, eq: false, softclip: false, quantize: false });
        const L = buf([2]), R = buf([2]);
        c.process(L, R, 1);
        expect(L[0]).toBe(1);   // 32767/32767
    });

    it('gain 级：保守硬件校准增益（off 时 ×1≡ne gain 100）', () => {
        const c = mk();
        c.set({ enabled: true, gain: true, eq: false, softclip: false, quantize: false, masterLift: 1 });
        const L = buf([0.01]), R = buf([0.01]);
        c.process(L, R, 1);
        expect(L[0]).toBeCloseTo(Math.fround(0.01) * DEVICE_GAIN_DEFAULT, 6);
    });

    it('默认 gain 只是硬件校准螺丝，不再用大增益替代 masterLift', () => {
        expect(DEVICE_GAIN_DEFAULT).toBeCloseTo(1.8, 6);
        expect(DEVICE_GAIN_DEFAULT).toBeLessThan(2.0);
    });

    it('masterLift 在设备保护链之前生效：超幅 lift 仍被终级 clamp 接住', () => {
        const c = mk();
        c.set({ enabled: true, gain: false, eq: false, softclip: false, quantize: false, masterLift: 2.2 });
        const L = buf([0.6]), R = buf([0.6]);
        c.process(L, R, 1);
        expect(L[0]).toBe(1);
        const m = c.flushMeters();
        expect(m.prePeak).toBe(1);
    });

    it('meters report soft-knee and hard-clamp hit rates for output-chain audit', () => {
        const soft = mk();
        soft.set({ enabled: true, gain: false, eq: false, softclip: true, quantize: true });
        soft.process(buf([1]), buf([1]), 1);
        const sm = soft.flushMeters();
        expect(sm.samples).toBe(1);
        expect(sm.softKnee).toBe(2);
        expect(sm.softKneeRate).toBe(1);
        expect(sm.hardClip).toBe(0);
        expect(sm.prePeakDb).toBeLessThanOrEqual(0);
        expect(sm.preRmsDb).toBeLessThanOrEqual(0);
        expect(sm.headroomDb).toBeGreaterThanOrEqual(0);
        expect(sm.crestDb).toBeGreaterThanOrEqual(0);
        expect(sm.driveState).toBe('overdriven');

        const hard = mk();
        hard.set({ enabled: true, gain: false, eq: false, softclip: false, quantize: false });
        hard.process(buf([2]), buf([2]), 1);
        const hm = hard.flushMeters();
        expect(hm.hardClip).toBe(1);
        expect(hm.hardClipRate).toBe(1);
        expect(hm.driveState).toBe('hard-clipping');
    });

    it('meters classify quiet and healthy output windows for listening audit', () => {
        const quiet = mk();
        quiet.set({ enabled: true, gain: false, eq: false, softclip: true, quantize: false, masterLift: 1 });
        quiet.process(buf([0.04]), buf([0.04]), 1);
        expect(quiet.flushMeters().driveState).toBe('quiet');

        const healthy = mk();
        healthy.set({ enabled: true, gain: false, eq: false, softclip: true, quantize: false, masterLift: 1 });
        healthy.process(buf([0.2]), buf([0.2]), 1);
        const m = healthy.flushMeters();
        expect(m.driveState).toBe('healthy');
        expect(m.preRmsDb).toBeCloseTo(-13.98, 1);
    });

    it('EQ 重开清滤波状态（镜像固件 s_eq_reset_req 语义）', () => {
        const c = mk();
        c.set({ enabled: true, gain: false, eq: true, softclip: false, quantize: false });
        const L = buf([0.5, 0.5, 0.5, 0.5]), R = buf([0.5, 0.5, 0.5, 0.5]);
        c.process(L, R, 4);                        // 灌入信号留下滤波状态
        c.set({ eq: false });
        c.set({ eq: true });                       // 重开 → 状态应清零
        const Z = buf([0, 0, 0, 0]), Z2 = buf([0, 0, 0, 0]);
        c.process(Z, Z2, 4);
        for (let i = 0; i < 4; i++) expect(Z[i]).toBe(0);   // 无残留瞬态
    });

    it('pre/post meters 都报告后链输出，不再存在链外音量放大', () => {
        const c = mk();
        c.set({ enabled: true, gain: false, eq: false, softclip: false, quantize: false, masterLift: 0.5 });
        const x = 1000 / 32767;
        const L = buf([x]), R = buf([x]);
        c.process(L, R, 1);
        expect(L[0]).toBeCloseTo(x * 0.5, 4);
        const m = c.flushMeters();
        expect(m.postPeak).toBeCloseTo(m.prePeak, 6);
    });

    it('masterLift clamps to the user fader range', () => {
        const c = mk();
        c.set({ masterLift: -1 });
        expect(c.config().masterLift).toBe(MASTER_LIFT_MIN);
        c.set({ masterLift: 24 });
        expect(c.config().masterLift).toBe(MASTER_LIFT_MAX);
        c.set({ masterLift: Number.NaN });
        expect(c.config().masterLift).toBe(DEFAULT_MASTER_LIFT);
    });
});
