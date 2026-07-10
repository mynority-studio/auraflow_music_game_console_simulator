// ============================================================
// M1 批2 · copych 后端分流（计划修订1 机器门）
// ------------------------------------------------------------
// copych（2026-07-09 起默认后端）：loadTrack 跳过 echo 展开（真 FxDelay 代偿）
//         但保留 normalize+sort；CC95 保留在事件流（dispatch 直通）。
// spessa 路径行为（echo 展开）由 MidiScheduler.test.ts 顶部显式 vi.mock 钉 spessa 守住。
// ============================================================
import { describe, expect, it, vi, afterEach } from 'vitest';

describe('M1 copych 后端分流', () => {
    afterEach(() => {
        vi.doUnmock('./synthBackend');
        vi.resetModules();
    });

    it('copych：loadTrack 无 echo 展开、CC95 保留、normalize+sort 仍生效', async () => {
        vi.doMock('./synthBackend', () => ({
            getSynthBackend: () => 'copych' as const,
            isCopychBackend: () => true,
        }));
        const { MidiScheduler } = await import('./MidiScheduler');
        const s = new MidiScheduler();
        // 故意乱序投入（noteOff 在前）——copych 分支必须仍走 normalize+sort
        s.loadTrack([
            { ticks: 240, type: 'noteOff', channel: 1, data1: 64, data2: 0 },
            { ticks: 0, type: 'cc', channel: 1, data1: 95, data2: 30 },
            { ticks: 0, type: 'noteOn', channel: 1, data1: 64, data2: 100 },
        ], 120);
        const evs = s.getChannelEvents(1);
        // 无 echo：spessa 路径会多出 240tick 的 echo noteOn/420tick echo noteOff
        expect(evs.filter(e => e.type === 'noteOn')).toHaveLength(1);
        expect(evs.filter(e => e.type === 'noteOff')).toHaveLength(1);
        // CC95 原样保留（供 dispatch 直通真 FxDelay）
        expect(evs.filter(e => e.type === 'cc' && e.data1 === 95)).toHaveLength(1);
        // 排序生效：同 tick cc 先于 noteOn（compareMidiEvents 序），noteOff 落尾
        expect(evs.map(e => [e.ticks, e.type])).toEqual([
            [0, 'cc'], [0, 'noteOn'], [240, 'noteOff'],
        ]);
    });

    it('synthBackend：无 flag 环境默认 copych（2026-07-09 拍板：默认=设备镜像）', async () => {
        const { getSynthBackend } = await import('./synthBackend');
        expect(getSynthBackend()).toBe('copych');
    });
});
