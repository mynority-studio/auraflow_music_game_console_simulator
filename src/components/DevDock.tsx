// ============================================================
// DevDock — 左侧竖排开发面板入口
// ============================================================
//
// 把原本只能靠 Q+H / Q+N 组合键调出的隐藏沙盒做成可见菜单。
// 点击某项 = 翻转对应面板;面板用键盘组合键开关时,这里高亮也会同步
// (经 devPanels.ts 的 state 广播)。可折叠成左缘细 tab。
// ============================================================

import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Settings2, ChevronLeft } from 'lucide-react';
import {
    DEV_PANELS, toggleDevPanel, requestPanelStates, subscribePanelState,
    type DevPanelId,
} from './devPanels';

export const DevDock: React.FC = () => {
    // 初值:PipelineMonitor 默认可见,其余隐藏(挂载后会被各面板回报覆盖)
    const [openMap, setOpenMap] = useState<Record<DevPanelId, boolean>>({
        pipeline: true, midiAnalysis: false, motif: false, midiOut: false, takeover: false,
    });
    const [collapsed, setCollapsed] = useState(false);

    useEffect(() => {
        const unsub = subscribePanelState((id, open) => {
            setOpenMap(prev => (prev[id] === open ? prev : { ...prev, [id]: open }));
        });
        requestPanelStates(); // 让各面板回报当前状态,消除挂载竞态
        return unsub;
    }, []);

    if (collapsed) {
        return (
            <motion.button
                type="button"
                onClick={() => setCollapsed(false)}
                title="展开开发面板"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="fixed left-0 top-1/2 -translate-y-1/2 z-[60] flex flex-col items-center gap-1.5
                           rounded-r-xl border border-l-0 border-zinc-800 bg-zinc-900/90 backdrop-blur-md
                           px-1.5 py-3 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/90 transition-colors
                           shadow-[0_8px_30px_rgba(0,0,0,0.6)]"
            >
                <Settings2 size={16} />
                <span className="text-[9px] font-semibold tracking-widest [writing-mode:vertical-rl]">DEV</span>
            </motion.button>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="fixed left-3 top-1/2 -translate-y-1/2 z-[60] w-44 select-none
                       rounded-2xl border border-zinc-800 bg-zinc-900/90 backdrop-blur-md
                       shadow-[0_8px_30px_rgba(0,0,0,0.6)] overflow-hidden"
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
        >
            {/* 头部 */}
            <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
                <Settings2 size={14} className="text-zinc-400" />
                <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-300">开发面板</span>
                <button
                    type="button"
                    onClick={() => setCollapsed(true)}
                    title="折叠"
                    className="ml-auto text-zinc-500 hover:text-zinc-200 transition-colors"
                >
                    <ChevronLeft size={15} />
                </button>
            </div>

            <div className="h-px bg-zinc-800" />

            {/* 面板项 */}
            <div className="flex flex-col gap-1 p-2">
                {DEV_PANELS.map(p => {
                    const active = !!openMap[p.id];
                    const Icon = p.icon;
                    return (
                        <button
                            key={p.id}
                            type="button"
                            onClick={() => toggleDevPanel(p.id)}
                            title={`${p.hint} · ${p.combo}`}
                            className={`group flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors
                                ${active
                                    ? `${p.activeRing} ${p.activeText}`
                                    : 'border-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-100'}`}
                        >
                            <Icon
                                size={16}
                                className={active ? p.activeText : 'text-zinc-500 group-hover:text-zinc-300'}
                            />
                            <span className="flex flex-col leading-tight">
                                <span className="text-[13px] font-medium">{p.label}</span>
                                <span className="text-[10px] tracking-wider text-zinc-500">{p.combo}</span>
                            </span>
                            <span
                                className={`ml-auto h-1.5 w-1.5 rounded-full ${active ? p.dot : 'bg-zinc-700'}`}
                            />
                        </button>
                    );
                })}
            </div>

            <div className="px-3 pb-2 text-[9px] leading-tight text-zinc-600">
                点击或按组合键切换 · 亮点=已打开
            </div>
        </motion.div>
    );
};
