// ============================================================
// motifCore — 实时播放头(面板层 hook,只读 scheduler,不碰生成)
// ============================================================
//
// 用 requestAnimationFrame 轮询 globalMidiScheduler.getCurrentTick(),
// 换算成当前 bar / 当前 slot,驱动面板的实时 bar 条。纯只读。
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { globalMidiScheduler } from '../../audio/MidiScheduler';
import { slotsToTicks } from '../improCore/engine';

const WHOLE = 480; // 一小节 slot

export interface Playhead {
    /** 当前播放 slot(整曲绝对);未播放 = -1 */
    slot: number;
    /** 当前 bar 下标;未播放 = -1 */
    bar: number;
    playing: boolean;
}

const TICKS_PER_BAR = slotsToTicks(WHOLE); // 480 slot × 4 = 1920 tick

/** 实时播放头;totalBars 用于到尾后归位 */
export function usePlayhead(totalBars: number): Playhead {
    const [head, setHead] = useState<Playhead>({ slot: -1, bar: -1, playing: false });
    const raf = useRef<number | null>(null);

    useEffect(() => {
        const tick = () => {
            const sched = globalMidiScheduler;
            const playing = sched.isPlaying;
            if (playing) {
                const t = sched.getCurrentTick();
                const bar = Math.min(totalBars - 1, Math.floor(t / TICKS_PER_BAR));
                const slot = Math.floor(t / 4);
                setHead(prev => (prev.bar === bar && prev.playing ? prev : { slot, bar, playing: true }));
            } else {
                setHead(prev => (prev.playing ? { slot: -1, bar: -1, playing: false } : prev));
            }
            raf.current = requestAnimationFrame(tick);
        };
        raf.current = requestAnimationFrame(tick);
        return () => { if (raf.current !== null) cancelAnimationFrame(raf.current); };
    }, [totalBars]);

    return head;
}
