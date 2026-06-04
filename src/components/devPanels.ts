// ============================================================
// 开发面板通道 — 把隐藏的 Q+I / Q+H / Q+E 面板暴露给左侧 DevDock
// ============================================================
//
// 三个沙盒面板各自封装(自管 isVisible + 自己的键盘组合键监听)。
// 这里用三个 window CustomEvent 做松耦合通道,DevDock 与面板都不需要
// 互相 import / prop drilling:
//
//   toggle  : DevDock 点击某项 → 派发 → 对应面板翻转 visible
//   state   : 面板 visible 变化(键盘组合键也算)→ 广播 → DevDock 同步高亮
//   request : DevDock 挂载时请求一次 → 面板各自回报当前 state(解决挂载竞态)
//
// 键盘组合键(Q+I 等)原样保留,本通道只是多一个可见入口。
// ============================================================

import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Music, Activity, SlidersHorizontal, Boxes } from 'lucide-react';

export type DevPanelId = 'improcore' | 'pipeline' | 'volume' | 'newengine';

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
        id: 'newengine', label: '新引擎', hint: 'newEngine generate', combo: 'Q+N',
        icon: Boxes,
        dot: 'bg-emerald-400', activeRing: 'border-emerald-400/50 bg-emerald-500/10', activeText: 'text-emerald-300',
    },
    {
        id: 'improcore', label: '即兴沙盒', hint: 'ImproCore solo', combo: 'Q+I',
        icon: Music,
        dot: 'bg-cyan-400', activeRing: 'border-cyan-400/50 bg-cyan-500/10', activeText: 'text-cyan-300',
    },
    {
        id: 'pipeline', label: '管道监视', hint: 'Pipeline monitor', combo: 'Q+H',
        icon: Activity,
        dot: 'bg-sky-400', activeRing: 'border-sky-400/50 bg-sky-500/10', activeText: 'text-sky-300',
    },
    {
        id: 'volume', label: '调音台', hint: 'Marshall mixer', combo: 'Q+E',
        icon: SlidersHorizontal,
        dot: 'bg-amber-400', activeRing: 'border-amber-400/50 bg-amber-500/10', activeText: 'text-amber-300',
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
