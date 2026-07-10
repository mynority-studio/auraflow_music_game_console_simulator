// SPDX-License-Identifier: GPL-3.0-only
// 设备后链 DSP 单测（听感排查批2）——对 public/copych/device_postchain.mjs
// 逐语义证伪：mono 折叠抵消 / EQ 差分方程 / softclip 手算锚点 / 量化截断 /
// 24k 硬约束 / 终级饱和恒在 / EQ 重开清状态 / trim 链外。
import { describe, expect, it } from 'vitest';
import { createDevicePostChain, softClipS16, hardClipS16, EQ_COEF_24K, DEVICE_GAIN_DEFAULT } from '../../../../public/copych/device_postchain.mjs';

const mk = (sr = 24000) => createDevicePostChain(sr);
const buf = (vals: number[]) => new Float32Array(vals);

describe('devicePostChain', () => {
    it('mono 折叠：L=1/R=-1 → 全链输出 0（计划门 R2-P1 合同）', () => {
        const c = mk();
        c.set({ enabled: true, gain: false, eq: false, softclip: false, quantize: false });
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
        c.set({ enabled: true, gain: false, eq: true, softclip: false, quantize: false });
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

    it('量化：非整 s16 值向零截断（backend C cast 语义）', () => {
        const c = mk();
        c.set({ enabled: true, gain: false, eq: false, softclip: false, quantize: true });
        const x = 1000.7 / 32767;
        const L = buf([x]), R = buf([x]);
        c.process(L, R, 1);
        expect(L[0]).toBeCloseTo(1000 / 32767, 6);
    });

    it('24k 硬约束：非 24k ctx 全链 bypass（缓冲逐位不动）', () => {
        const c = mk(48000);
        c.set({ enabled: true });
        expect(c.isActive()).toBe(false);
        expect(c.srOk()).toBe(false);
        const L = buf([0.5]), R = buf([0.5]);
        c.process(L, R, 1);
        expect(L[0]).toBeCloseTo(0.5, 7);
    });

    it('终级饱和恒在：超幅输入被 clamp（softclip off 时=backend hard→物理边界）', () => {
        const c = mk();
        c.set({ enabled: true, gain: false, eq: false, softclip: false, quantize: false });
        const L = buf([2]), R = buf([2]);
        c.process(L, R, 1);
        expect(L[0]).toBe(1);   // 32767/32767
    });

    it('gain 级：×4.28（off 时 ×1≡ne gain 100）', () => {
        const c = mk();
        c.set({ enabled: true, gain: true, eq: false, softclip: false, quantize: false });
        const L = buf([0.01]), R = buf([0.01]);
        c.process(L, R, 1);
        expect(L[0]).toBeCloseTo(Math.fround(0.01) * DEVICE_GAIN_DEFAULT, 6);
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

    it('audition trim：链外 ×dB，pre/post meters 分离', () => {
        const c = mk();
        c.set({ enabled: true, gain: false, eq: false, softclip: false, quantize: false, trimDb: -6 });
        const x = 1000 / 32767;
        const L = buf([x]), R = buf([x]);
        c.process(L, R, 1);
        const lin = Math.pow(10, -6 / 20);
        expect(L[0]).toBeCloseTo(x * lin, 4);
        const m = c.flushMeters();
        expect(m.postPeak).toBeCloseTo(m.prePeak * lin, 6);
    });
});
