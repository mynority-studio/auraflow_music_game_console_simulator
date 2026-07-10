// ============================================================
// Copych-only 调度合同
// ------------------------------------------------------------
// loadTrack 保留 normalize+sort；CC95 原样进 Copych 真 FxDelay。
// ============================================================
import { describe, expect, it } from 'vitest';
import { MidiScheduler } from './MidiScheduler';

describe('Copych-only 调度', () => {
    it('loadTrack 无 echo 展开、CC95 保留、normalize+sort 仍生效', () => {
        const s = new MidiScheduler();
        // 故意乱序投入（noteOff 在前）——copych 分支必须仍走 normalize+sort
        s.loadTrack([
            { ticks: 240, type: 'noteOff', channel: 1, data1: 64, data2: 0 },
            { ticks: 0, type: 'cc', channel: 1, data1: 95, data2: 30 },
            { ticks: 0, type: 'noteOn', channel: 1, data1: 64, data2: 100 },
        ], 120);
        const evs = s.getChannelEvents(1);
        // 无 echo：CC95 只作为 Copych FX send。
        expect(evs.filter(e => e.type === 'noteOn')).toHaveLength(1);
        expect(evs.filter(e => e.type === 'noteOff')).toHaveLength(1);
        // CC95 原样保留（供 dispatch 直通真 FxDelay）
        expect(evs.filter(e => e.type === 'cc' && e.data1 === 95)).toHaveLength(1);
        // 排序生效：同 tick cc 先于 noteOn（compareMidiEvents 序），noteOff 落尾
        expect(evs.map(e => [e.ticks, e.type])).toEqual([
            [0, 'cc'], [0, 'noteOn'], [240, 'noteOff'],
        ]);
    });
});
