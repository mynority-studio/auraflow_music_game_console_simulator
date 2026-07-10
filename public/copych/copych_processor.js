// SPDX-License-Identifier: GPL-3.0-only
// ============================================================
// copych_processor — copych WASM AudioWorklet processor（M1 批2）
// ------------------------------------------------------------
// 放 public/（vite 原样拷贝，不进打包管线）：AudioWorklet.addModule 直接吃
// 本文件 URL，内部静态 import 同目录 SINGLE_FILE glue（copych_synth.mjs，
// vendored 见 PROVENANCE.md）。纯 JS（worklet 不走 TS 管线，同 spessasynth
// 的 min.js 资产方式）。
//
// 事件时序（E3 口径）：主线程 postMessage {type:'ev', when=ctx 秒}；本端
// 时间戳队列（when+seq 稳定序），到期事件（when ≤ 本 quantum 起点）在
// quantum 头应用——{time} 未来事件正确排程，不承诺消除主线程 tick jitter。
//
// panic 合同（计划修订2）：先清 pending 队列（防 stop 后未来事件复触发），
// 再调 C 层 copych_wasm_panic（CC64=0→soundOff→delay resetLine）。
// ============================================================
import createCopychModule from './copych_synth.mjs';
import { createDevicePostChain } from './device_postchain.mjs';

class CopychProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.M = null;
        this.ready = false;
        this.pL = 0;
        this.pR = 0;
        this.queue = [];   // {when, seq, kind, ch, a, b}，按 (when, seq) 升序
        this.seq = 0;
        /* 设备后链（听感排查批2）：仅 24k ctx 有效；状态每次 set 后回报主线程防分叉 */
        this.postchain = createDevicePostChain(sampleRate);
        this.meterCountdown = 0;   // 采样计数：每 ~250ms 上报一次电平表
        this.port.onmessage = (e) => { void this.onMessage(e.data); };
    }

    async onMessage(msg) {
        switch (msg.type) {
            case 'init': {
                try {
                    const M = await createCopychModule();
                    const sf2 = new Uint8Array(msg.sf2);
                    const p = M._malloc(sf2.length);
                    M.HEAPU8.set(sf2, p);
                    const rc = M._copych_wasm_init(p, sf2.length, sampleRate);
                    M._free(p);   // 内存合同：init 后 wasm 侧自持拷贝，暂存区即释放
                    if (rc !== 0) { this.port.postMessage({ type: 'error', msg: 'copych init rc=' + rc }); return; }
                    this.pL = M._malloc(128 * 4);   // 渲染缓冲一次分配常驻（合同：绝不 per-quantum malloc）
                    this.pR = M._malloc(128 * 4);
                    this.M = M;
                    this.ready = true;
                    this.port.postMessage({ type: 'ready', sr: sampleRate });
                } catch (err) {
                    this.port.postMessage({ type: 'error', msg: String((err && err.stack) || err) });
                }
                break;
            }
            case 'ev': {
                if (!this.ready) return;
                const ev = { when: msg.when || 0, seq: this.seq++, kind: msg.kind, ch: msg.ch | 0, a: msg.a | 0, b: msg.b | 0 };
                const q = this.queue;
                let i = q.length;   // 尾部插入排序（事件基本有序）；同 when 保投递序
                while (i > 0 && q[i - 1].when > ev.when) i--;
                q.splice(i, 0, ev);
                break;
            }
            case 'panic': {
                this.queue.length = 0;                       // ★先清 pending
                if (this.ready) this.M._copych_wasm_panic(); // 再硬静音
                break;
            }
            case 'postchain': {
                /* {enabled?, gain?, eq?, softclip?, quantize?, trimDb?} 局部合并；
                 * 非 24k ctx 请求 enable → 实际保持 bypass，回报 reason 供 UI 对齐。 */
                this.postchain.set(msg.cfg || {});
                this.port.postMessage({
                    type: 'postchain-state',
                    active: this.postchain.isActive(),
                    srOk: this.postchain.srOk(),
                    cfg: this.postchain.config(),
                    reason: (!this.postchain.srOk() && msg.cfg && msg.cfg.enabled) ? 'sampleRate!=24000' : null,
                });
                break;
            }
            case 'space': {
                if (!this.ready) return;
                if (msg.reverb) this.M._copych_wasm_set_song_reverb(msg.reverb.time, msg.reverb.level, msg.reverb.predelayMs, msg.reverb.damping);
                if (msg.chorus) this.M._copych_wasm_set_song_chorus(msg.chorus.lfoHz, msg.chorus.depthS, msg.chorus.baseDelayS);
                if (msg.delay) this.M._copych_wasm_set_song_delay(msg.delay.seconds, msg.delay.feedback, msg.delay.enabled ? 1 : 0);
                break;
            }
        }
    }

    applyEvent(ev) {
        const M = this.M;
        if (ev.kind === 'on') M._copych_wasm_note_on(ev.ch, ev.a, ev.b);
        else if (ev.kind === 'off') M._copych_wasm_note_off(ev.ch, ev.a);
        else if (ev.kind === 'cc') M._copych_wasm_cc(ev.ch, ev.a, ev.b);
        else if (ev.kind === 'prog') M._copych_wasm_program(ev.ch, ev.a);
        else if (ev.kind === 'bend') M._copych_wasm_pitch_bend(ev.ch, ev.a);
    }

    process(_inputs, outputs) {
        if (!this.ready) return true;
        const q = this.queue;
        let n = 0;
        while (n < q.length && q[n].when <= currentTime) n++;
        if (n > 0) {
            for (let i = 0; i < n; i++) this.applyEvent(q[i]);
            q.splice(0, n);
        }
        const out = outputs[0];
        const len = out[0].length;
        this.M._copych_wasm_render(this.pL, this.pR, len);
        out[0].set(this.M.HEAPF32.subarray(this.pL >> 2, (this.pL >> 2) + len));
        if (out[1]) out[1].set(this.M.HEAPF32.subarray(this.pR >> 2, (this.pR >> 2) + len));
        /* 设备后链（active 时就地处理 L/R；零分配）+ 电平表 ~250ms 上报 */
        if (this.postchain.isActive()) {
            this.postchain.process(out[0], out[1] || out[0], len);
            this.meterCountdown -= len;
            if (this.meterCountdown <= 0) {
                this.meterCountdown = sampleRate / 4;
                this.port.postMessage({ type: 'postchain-meters', m: this.postchain.flushMeters() });
            }
        }
        return true;
    }
}

registerProcessor('copych-processor', CopychProcessor);
