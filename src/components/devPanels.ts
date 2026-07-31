// ============================================================
// 开发面板通道 — 把隐藏开发面板暴露给左侧 DevDock
// ============================================================
//
// 沙盒面板各自封装(自管 isVisible + 自己的键盘组合键监听)。
// 这里用三个 window CustomEvent 做松耦合通道,DevDock 与面板都不需要
// 互相 import / prop drilling:
//
//   toggle  : DevDock 点击某项 → 派发 → 对应面板翻转 visible
//   state   : 面板 visible 变化(键盘组合键也算)→ 广播 → DevDock 同步高亮
//   request : DevDock 挂载时请求一次 → 面板各自回报当前 state(解决挂载竞态)
//
// Q+N 诊断能力收口到 Q+H 音乐生成链路(含 Debug 区)。
// (2026-06-12:Q+I 即兴沙盒 / Q+E 调音台功能模块已收口。2026-07-01:Q+N 独立诊断通道收口。)
// ============================================================

import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Activity, Cable, FileSearch, Hand, Piano } from 'lucide-react';

export type DevPanelId = 'pipeline' | 'midiAnalysis' | 'motif' | 'midiOut' | 'takeover';

export interface DevPanelMeta {
    id: DevPanelId;
    label: string;
    hint: string;
    combo: string;
    icon: LucideIcon;
    // 静态 class 串(供 Tailwind 扫描;勿动态拼接颜色)
    dot: string;
    activeRing: string;
    activeText: string;
}

export const DEV_PANELS: DevPanelMeta[] = [
    {
        id: 'pipeline', label: '音乐生成', hint: 'Music generation', combo: 'Q+H',
        icon: Activity,
        dot: 'bg-sky-400', activeRing: 'border-sky-400/50 bg-sky-500/10', activeText: 'text-sky-300',
    },
    {
        id: 'midiAnalysis', label: 'MIDI 分析', hint: 'Read-only MIDI analysis monitor', combo: 'Q+A',
        icon: FileSearch,
        dot: 'bg-cyan-400', activeRing: 'border-cyan-400/50 bg-cyan-500/10', activeText: 'text-cyan-300',
    },
    {
        id: 'motif', label: 'Motif 沙盒', hint: 'Motif weaver', combo: 'Q+R',
        icon: Piano,
        dot: 'bg-fuchsia-400', activeRing: 'border-fuchsia-400/50 bg-fuchsia-500/10', activeText: 'text-fuchsia-300',
    },
    {
        id: 'midiOut', label: 'MIDI 输出', hint: '5-track MIDI out', combo: 'Q+M',
        icon: Cable,
        dot: 'bg-emerald-400', activeRing: 'border-emerald-400/50 bg-emerald-500/10', activeText: 'text-emerald-300',
    },
    {
        id: 'takeover', label: '用户接管沙盒', hint: 'Lead takeover', combo: 'Q+T',
        icon: Hand,
        dot: 'bg-teal-400', activeRing: 'border-teal-400/50 bg-teal-500/10', activeText: 'text-teal-300',
    },
];

const TOGGLE_EVENT = 'auraflow:dev-toggle';
const STATE_EVENT = 'auraflow:dev-state';
const REQUEST_EVENT = 'auraflow:dev-request-state';

// ---- DevDock 侧 API ----

/** 请求某面板翻转显示(DevDock 点击调用)。 */
export function toggleDevPanel(id: DevPanelId): void {
    window.dispatchEvent(new CustomEvent(TOGGLE_EVENT, { detail: { id } }));
}

/** 请所有面板各自回报当前 state(DevDock 挂载时调用一次)。 */
export function requestPanelStates(): void {
    window.dispatchEvent(new Event(REQUEST_EVENT));
}

/** 订阅面板 state 广播;返回退订函数。 */
export function subscribePanelState(
    cb: (id: DevPanelId, open: boolean) => void,
): () => void {
    const handler = (e: Event) => {
        const detail = (e as CustomEvent<{ id?: DevPanelId; open?: boolean }>).detail;
        if (detail?.id != null && typeof detail.open === 'boolean') cb(detail.id, detail.open);
    };
    window.addEventListener(STATE_EVENT, handler);
    return () => window.removeEventListener(STATE_EVENT, handler);
}

// ---- 面板侧 hook ----

/**
 * 面板挂这个 hook 即接入 DevDock:
 *   - 监听 DevDock 的 toggle / 状态请求,
 *   - visible 一变就广播 state 给 DevDock 高亮。
 * 一行接入,不改动面板原有 Q+x 键盘逻辑。
 */
export function useDevPanelChannel(
    id: DevPanelId,
    isOpen: boolean,
    setOpen: Dispatch<SetStateAction<boolean>>,
): void {
    const openRef = useRef(isOpen);
    openRef.current = isOpen;

    useEffect(() => {
        const onToggle = (e: Event) => {
            if ((e as CustomEvent<{ id?: DevPanelId }>).detail?.id === id) setOpen(v => !v);
        };
        const onRequest = () => {
            window.dispatchEvent(new CustomEvent(STATE_EVENT, { detail: { id, open: openRef.current } }));
        };
        window.addEventListener(TOGGLE_EVENT, onToggle);
        window.addEventListener(REQUEST_EVENT, onRequest);
        return () => {
            window.removeEventListener(TOGGLE_EVENT, onToggle);
            window.removeEventListener(REQUEST_EVENT, onRequest);
        };
    }, [id, setOpen]);

    useEffect(() => {
        window.dispatchEvent(new CustomEvent(STATE_EVENT, { detail: { id, open: isOpen } }));
    }, [id, isOpen]);
}
