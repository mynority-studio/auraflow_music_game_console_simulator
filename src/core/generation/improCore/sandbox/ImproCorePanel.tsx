// ============================================================
// ImproCore sandbox — Q+I 控制板 (Phase 3)
// ============================================================
//
// 独立沙盒 UI:同时按住 Q + I 调出 / Esc 关闭。
// 完全不走 AuraFlow 主系统,只在播放时把音符送进 spessasynth。
//
// Phase 3:键入和弦 + 选 grammar → grammar 加权随机推导出抽象旋律 →
//   LickGen 按和弦上下文落成具体音高 → 发声(第一段真·即兴 solo)。
//   "▶ Play 和弦" 仍保留(Phase 1 block chord,可与 solo 对照)。
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Chord, PITCH_CLASSES, ChordPart, realize, getGrammar, ALL_GRAMMAR_NAMES,
    DEFAULT_PARAMS, getStyle, ALL_STYLE_NAMES, renderComping, pickBest, applySwing,
    rectify, inferKey, rectifyToKey,
    getTransform, ALL_TRANSFORM_NAMES, applyTransform, type Grammar,
    type GrammarChordContext, type LickGenParams,
    generateLstmMelody, getConnectome, ALL_CONNECTOME_NAMES,
} from '../engine';
import { playSlotNotes, playTracks, stopPlayback, type SlotNote } from './audioOut';
import { smartGen, getMgContext, renderMgTexture } from './smartGen';
import { useDevPanelChannel } from '../../../../components/devPanels';

// Phase 6:生成 N 条 solo,按 Expectancy 平均期待择优(更平滑连贯)
const SOLO_CANDIDATES = 4;
function bestSolo(g: Grammar, cp: ChordPart, params: LickGenParams): SlotNote[] {
    const ctx: GrammarChordContext = {
        familyAtSlot: (slot) => cp.getCurrentChord(slot)?.getFamily() ?? null,
        brickNameAtSlot: () => null,
    };
    const cands: SlotNote[][] = [];
    for (let i = 0; i < SOLO_CANDIDATES; i++) cands.push(realize(g.run(cp.getTotalSlots(), ctx), cp, params));
    return pickBest(cands, cp);
}

// 从 grammar 参数取音域/音程(缺省回退 DEFAULT_PARAMS)
function paramsFromGrammar(g: ReturnType<typeof getGrammar>): LickGenParams {
    if (!g) return DEFAULT_PARAMS;
    const p = g.getParameters();
    const num = (k: string, d: number) => { const v = p.get(k); return typeof v === 'number' ? v : d; };
    return {
        minPitch: num('min-pitch', DEFAULT_PARAMS.minPitch),
        maxPitch: num('max-pitch', DEFAULT_PARAMS.maxPitch),
        minInterval: num('min-interval', DEFAULT_PARAMS.minInterval),
        maxInterval: num('max-interval', DEFAULT_PARAMS.maxInterval),
    };
}

// 和弦音名预览(输入框下方的 chip)
function chordSpellNames(token: string): string[] | null {
    const chord = Chord.makeChord(token);
    if (!chord || chord.isNOCHORD()) return null;
    return chord.getSpell().map(ns => PITCH_CLASSES[ns.pcIndex!]!.name.toUpperCase());
}

// 常用 GM 音色(program 号)
const GM_INSTRUMENTS: ReadonlyArray<{ program: number; name: string }> = [
    { program: 0, name: 'Acoustic Piano' },
    { program: 1, name: 'Bright Piano' },
    { program: 4, name: 'E-Piano' },
    { program: 11, name: 'Vibraphone' },
    { program: 24, name: 'Nylon Guitar' },
    { program: 26, name: 'Jazz Guitar' },
    { program: 32, name: 'Acoustic Bass' },
    { program: 33, name: 'Finger Bass' },
    { program: 38, name: 'Synth Bass' },
    { program: 56, name: 'Trumpet' },
    { program: 57, name: 'Trombone' },
    { program: 64, name: 'Soprano Sax' },
    { program: 65, name: 'Alto Sax' },
    { program: 66, name: 'Tenor Sax' },
    { program: 71, name: 'Clarinet' },
    { program: 73, name: 'Flute' },
];

// GM 鼓组(channel 9 的 program 选鼓组;soundfont 缺某组时回退 Standard)
const DRUM_KITS: ReadonlyArray<{ program: number; name: string }> = [
    { program: 0, name: 'Standard' },
    { program: 8, name: 'Room' },
    { program: 16, name: 'Power' },
    { program: 24, name: 'Electronic' },
    { program: 25, name: 'TR-808' },
    { program: 32, name: 'Jazz' },
    { program: 40, name: 'Brush' },
    { program: 48, name: 'Orchestra' },
];

function parseChordTokens(text: string): string[] {
    return text
        .split(/[\s,]+/)
        .map(t => t.trim())
        .filter(Boolean);
}

export function ImproCorePanel(): React.ReactElement | null {
    const [open, setOpen] = useState(false);
    const [chordText, setChordText] = useState('CM7 Am7 Dm7 G7');
    const [bpm, setBpm] = useState(140);
    const [genMode, setGenMode] = useState<'grammar' | 'lstm'>('grammar'); // solo 来源:语法 / 深度学习
    const [connectome, setConnectome] = useState(ALL_CONNECTOME_NAMES[0] ?? '');
    const [grammar, setGrammar] = useState(ALL_GRAMMAR_NAMES.includes('ArtFarmer') ? 'ArtFarmer' : (ALL_GRAMMAR_NAMES[0] ?? ''));
    const [style, setStyle] = useState(ALL_STYLE_NAMES.includes('swing') ? 'swing' : (ALL_STYLE_NAMES[0] ?? ''));
    const [compMode, setCompMode] = useState<'style' | 'mg'>('style'); // 伴奏织体:ImproCore Style / mg engine
    const [embellish, setEmbellish] = useState(false);
    const [transform, setTransform] = useState(ALL_TRANSFORM_NAMES[0] ?? '');
    const [rectifyMode, setRectifyMode] = useState<'off' | 'chord' | 'key'>('chord'); // IV 默认吸附和弦音阶

    const [melodyProgram, setMelodyProgram] = useState(65); // Alto Sax
    const [compProgram, setCompProgram] = useState(0);      // Piano
    const [bassProgram, setBassProgram] = useState(32);     // Acoustic Bass
    const [drumKit, setDrumKit] = useState(0);              // Standard Kit
    const [status, setStatus] = useState('就绪');
    const heldKeys = useRef<Set<string>>(new Set());
    const lastSmartGenTokens = useRef<string>(''); // 最近一次 SmartGen 填入的串(判断 mg texture 是否仍同源)

    // 左侧 DevDock 入口(点击切换 + 高亮同步);Q+I 键盘逻辑仍保留在下方
    useDevPanelChannel('improcore', open, setOpen);

    // 全局 Q+I 调出 / Esc 关闭
    useEffect(() => {
        const isTyping = () => {
            const el = document.activeElement;
            return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
        };
        const onKeyDown = (e: KeyboardEvent) => {
            const k = e.key.toLowerCase();
            heldKeys.current.add(k);
            if (!open && heldKeys.current.has('q') && heldKeys.current.has('i') && !isTyping()) {
                e.preventDefault();
                setOpen(true);
            } else if (open && k === 'escape') {
                setOpen(false);
            }
        };
        const onKeyUp = (e: KeyboardEvent) => {
            heldKeys.current.delete(e.key.toLowerCase());
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
        };
    }, [open]);

    const tokens = parseChordTokens(chordText);
    // leadsheet 文本 → ChordPart(支持 | 分小节 / 重复;空串退回 CM7)
    const buildChordPart = (text: string) => ChordPart.fromText(text.trim() || 'CM7');
    // 解析预览:实际 span(名 + 拍数),反映 | 分小节后的时值
    const chordPreview = React.useMemo(() => {
        try {
            return buildChordPart(chordText).getSpans().map(s => ({
                name: s.chord.getName(),
                beats: Math.round((s.end - s.start) / 120),
            }));
        } catch { return []; }
    }, [chordText]);

    // mg texture 仅在 SmartGen 生成后可用(需 mg 原生同源和弦);手输和弦时不可用
    const mgAvailable = getMgContext() !== null && chordText.trim() === lastSmartGenTokens.current;

    // 统一构建伴奏轨:Style 织体 或 mg texture(chord+bass)+ Style 鼓。
    // 返回已 applySwing 的三轨 + 标签;mg texture 不可用时回退 Style。
    const buildComp = (cp: ChordPart) => {
        const st = getStyle(style);
        if (compMode === 'mg' && mgAvailable && getMgContext()) {
            const tex = renderMgTexture(getMgContext()!);
            const drums = st ? renderComping(cp, st).drums : [];
            const sw = st?.compSwing ?? 0.5;
            return {
                label: `mg texture(${getMgContext()!.style})+${style}鼓`,
                bass: applySwing(tex.bass, sw),
                chords: applySwing(tex.chords, sw),
                drums: applySwing(drums, sw),
            };
        }
        if (!st) return null;
        const comp = renderComping(cp, st);
        return {
            label: `${style} 伴奏`,
            bass: applySwing(comp.bass, st.compSwing),
            chords: applySwing(comp.chords, st.compSwing),
            drums: applySwing(comp.drums, st.compSwing),
        };
    };

    // 只播伴奏织体(bass + chords + drums),与 ▶ 全部 的伴奏一致
    const handlePlay = useCallback(async () => {
        const cp = buildChordPart(chordText);
        const comp = buildComp(cp);
        if (!comp) { setStatus(`style 未找到:${style}`); return; }
        setStatus(`${comp.label} 生成中…`);
        try {
            await playTracks([
                { notes: comp.bass, channel: 1, program: bassProgram },
                { notes: comp.chords, channel: 2, program: compProgram },
                { notes: comp.drums, channel: 9, program: drumKit },
            ], bpm);
            setStatus(`▶ ${comp.label} · bass ${comp.bass.length} / chord ${comp.chords.length} / drum ${comp.drums.length} @ ${bpm}bpm`);
        } catch (err) {
            setStatus(`发声失败:${String(err)}`);
        }
    }, [chordText, style, compMode, mgAvailable, bpm, compProgram, bassProgram, drumKit]);

    // 生成原始 solo —— 按 genMode 分流:grammar 加权推导 / LSTM connectome 神经网络
    const genRawSolo = useCallback(async (cp: ChordPart): Promise<SlotNote[]> => {
        if (genMode === 'lstm') {
            if (!connectome) throw new Error('未选择 connectome');
            const model = await getConnectome(connectome);
            // 某些乐手(如 Lee Morgan)风格留白,偶尔整段休止 —— 换种子重试避免哑炮
            let notes: SlotNote[] = [];
            for (let attempt = 0; attempt < 6; attempt++) {
                notes = generateLstmMelody(cp.getSpans(), model, { seed: (Math.random() * 0x7fffffff) | 0 });
                if (notes.some(n => n.pitch >= 0)) break;
            }
            return notes;
        }
        const g = getGrammar(grammar);
        if (!g) throw new Error(`grammar 未找到:${grammar}`);
        return bestSolo(g, cp, paramsFromGrammar(g));
    }, [genMode, connectome, grammar]);

    const soloLabel = genMode === 'lstm' ? `${connectome}(神经网络)` : grammar;

    const handleSolo = useCallback(async () => {
        const cp = buildChordPart(chordText);
        setStatus(`${soloLabel} 生成中…`);
        try {
            const swing = getStyle(style)?.swing ?? 0.5;
            let solo = await genRawSolo(cp);
            if (embellish) { const subs = getTransform(transform); if (subs) solo = applyTransform(solo, cp, subs); }
            if (rectifyMode === 'chord') solo = rectify(solo, cp);
            else if (rectifyMode === 'key') solo = rectifyToKey(solo, inferKey(cp));
            const notes = applySwing(solo, swing);
            const sounding = notes.filter(n => n.pitch >= 0).length;
            await playSlotNotes(notes, bpm, { channel: 0, program: melodyProgram });
            setStatus(`▶ ${soloLabel} solo · ${sounding} 音 / ${notes.length} 事件 @ ${bpm}bpm`);
        } catch (err) {
            setStatus(`生成失败:${String(err)}`);
        }
    }, [chordText, genRawSolo, soloLabel, style, bpm, embellish, transform, rectifyMode, melodyProgram]);

    const handleAll = useCallback(async () => {
        const cp = buildChordPart(chordText);
        const comp = buildComp(cp);
        if (!comp) { setStatus(`style 未找到:${style}`); return; }
        const swing = getStyle(style)?.swing ?? 0.5;
        setStatus(`${soloLabel} + ${comp.label} 生成中…`);
        try {
            let soloRaw = await genRawSolo(cp);
            if (embellish) { const subs = getTransform(transform); if (subs) soloRaw = applyTransform(soloRaw, cp, subs); }
            if (rectifyMode === 'chord') soloRaw = rectify(soloRaw, cp);
            else if (rectifyMode === 'key') soloRaw = rectifyToKey(soloRaw, inferKey(cp));
            const solo = applySwing(soloRaw, swing);
            await playTracks([
                { notes: solo, channel: 0, program: melodyProgram },   // 旋律音色
                { notes: comp.bass, channel: 1, program: bassProgram },
                { notes: comp.chords, channel: 2, program: compProgram }, // 伴奏音色
                { notes: comp.drums, channel: 9, program: drumKit },      // Drums
            ], bpm);
            setStatus(`▶ ${soloLabel} solo + ${comp.label} · bass ${comp.bass.length} / chord ${comp.chords.length} / drum ${comp.drums.length} @ ${bpm}bpm`);
        } catch (err) {
            setStatus(`生成失败:${String(err)}`);
        }
    }, [chordText, genRawSolo, soloLabel, style, compMode, mgAvailable, bpm, embellish, transform, rectifyMode, melodyProgram, compProgram, bassProgram, drumKit]);

    const handleSmartGen = useCallback(() => {
        try {
            const r = smartGen();
            setChordText(r.tokens);
            lastSmartGenTokens.current = r.tokens; // 记录同源串,mg texture 据此判可用
            setCompMode('mg');                     // 自动切到 mg texture(随 SmartGen 风格演绎)
            setStatus(`✨ SmartGen · ${r.style} / ${r.key}调 · ${r.count} 和弦 · 伴奏=mg texture`);
        } catch (err) {
            setStatus(`SmartGen 失败:${String(err)}`);
        }
    }, []);

    const handleStop = useCallback(() => {
        stopPlayback();
        setStatus('已停止');
    }, []);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onPointerDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
            <div className="w-[min(640px,92vw)] rounded-xl border border-cyan-500/40 bg-zinc-900 text-zinc-100 shadow-2xl">
                {/* 标题栏 */}
                <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold tracking-wide text-cyan-300">ImproCore</span>
                        <span className="rounded bg-cyan-500/15 px-2 py-0.5 text-[10px] text-cyan-300">Impro-Visor 移植沙盒 · 完整</span>
                    </div>
                    <button
                        className="rounded px-2 text-zinc-400 hover:text-white"
                        onClick={() => setOpen(false)}
                        aria-label="关闭"
                    >
                        ✕
                    </button>
                </div>

                <div className="space-y-4 px-5 py-4">
                    <p className="text-[11px] leading-relaxed text-zinc-400">
                        独立沙盒,不走主系统。<span className="text-cyan-300">▶ 全部</span> = grammar solo + Style 伴奏
                        (Walking Bass + 钢琴 comping + 鼓)四轨同步;<span className="text-cyan-300">伴奏</span>键单播 Style 织体。
                        旋律 / 伴奏音色可分别选。和弦用 <code className="text-cyan-300">|</code> 分小节(节内平分),支持经过和弦。
                    </p>

                    {/* 和弦输入 */}
                    <label className="block">
                        <span className="mb-1 flex items-center justify-between text-xs text-zinc-400">
                            <span>和弦(<code className="text-cyan-300">|</code> 分小节,节内多和弦平分;<code className="text-cyan-300">/</code> 重复;无 <code className="text-cyan-300">|</code> 时每和弦一 bar)</span>
                            <button
                                type="button"
                                onClick={handleSmartGen}
                                title="调用 mg engine 随机风格生成一条和弦进行,自动填入"
                                className="rounded-md border border-fuchsia-400/40 bg-fuchsia-500/15 px-2 py-0.5 text-[11px] text-fuchsia-200 transition hover:bg-fuchsia-500/25"
                            >
                                ✨ SmartGen
                            </button>
                        </span>
                        <input
                            type="text"
                            value={chordText}
                            onChange={(e) => setChordText(e.target.value)}
                            className="w-full rounded-md border border-white/10 bg-zinc-800 px-3 py-2 font-mono text-sm outline-none focus:border-cyan-400"
                            placeholder="Dm7 G7 | CM7 | Am7  (或 Amaj7 Dmaj7 …)"
                        />
                    </label>

                    {/* 解析预览:按实际 ChordPart span 显示(含 | 分小节后的时值)*/}
                    <div className="flex flex-wrap gap-1.5">
                        {chordPreview.map((s, i) => (
                            <span
                                key={i}
                                className="rounded bg-white/5 px-2 py-0.5 font-mono text-xs text-cyan-200"
                                title={`${s.beats} 拍`}
                            >
                                {s.name}{s.beats !== 4 ? <span className="text-cyan-500/70"> ·{s.beats}拍</span> : null}
                            </span>
                        ))}
                        {chordPreview.length === 0 && <span className="text-xs text-zinc-500">(空 → 默认 CM7)</span>}
                        {tokens.some(t => t !== '|' && t !== '/' && !chordSpellNames(t)) && (
                            <span className="rounded bg-red-500/15 px-2 py-0.5 font-mono text-xs text-red-300">⚠ 有无法解析的和弦</span>
                        )}
                    </div>

                    {/* Solo 引擎切换:语法推导 / 深度学习 connectome */}
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-400">Solo 引擎</span>
                        <div className="flex overflow-hidden rounded-md border border-white/10">
                            {(['grammar', 'lstm'] as const).map(m => (
                                <button
                                    key={m}
                                    onClick={() => setGenMode(m)}
                                    disabled={m === 'lstm' && ALL_CONNECTOME_NAMES.length === 0}
                                    className={`px-3 py-1 text-xs transition ${genMode === m ? 'bg-cyan-500/20 text-cyan-200' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'} disabled:opacity-40`}
                                >
                                    {m === 'grammar' ? 'Grammar 语法' : 'LSTM 深度学习'}
                                </button>
                            ))}
                        </div>
                        {genMode === 'lstm' && (
                            <span className="text-[10px] text-zinc-500">乐手神经网络 · 复刻其乐句习语</span>
                        )}
                    </div>

                    {/* grammar/connectome + style 选择 */}
                    <div className="flex items-center gap-3">
                        {genMode === 'lstm' ? (
                            <label className="flex flex-1 items-center gap-2 text-xs text-zinc-400">
                                乐手
                                <select
                                    value={connectome}
                                    onChange={(e) => setConnectome(e.target.value)}
                                    className="min-w-0 flex-1 rounded-md border border-white/10 bg-zinc-800 px-2 py-1 text-sm outline-none focus:border-cyan-400"
                                >
                                    {ALL_CONNECTOME_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
                                </select>
                            </label>
                        ) : (
                            <label className="flex flex-1 items-center gap-2 text-xs text-zinc-400">
                                Grammar
                                <select
                                    value={grammar}
                                    onChange={(e) => setGrammar(e.target.value)}
                                    className="min-w-0 flex-1 rounded-md border border-white/10 bg-zinc-800 px-2 py-1 text-sm outline-none focus:border-cyan-400"
                                >
                                    {ALL_GRAMMAR_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
                                </select>
                            </label>
                        )}
                        <label className="flex flex-1 items-center gap-2 text-xs text-zinc-400">
                            {compMode === 'mg' ? '鼓(Style)' : 'Style'}
                            <select
                                value={style}
                                onChange={(e) => setStyle(e.target.value)}
                                className="min-w-0 flex-1 rounded-md border border-white/10 bg-zinc-800 px-2 py-1 text-sm outline-none focus:border-cyan-400"
                            >
                                {ALL_STYLE_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
                            </select>
                        </label>
                        <label className="flex items-center gap-1.5 text-xs text-zinc-400">
                            <input
                                type="number"
                                min={40}
                                max={300}
                                value={bpm}
                                onChange={(e) => setBpm(Math.max(40, Math.min(300, Number(e.target.value) || 120)))}
                                className="w-16 rounded-md border border-white/10 bg-zinc-800 px-2 py-1 text-sm outline-none focus:border-cyan-400"
                            />
                            bpm
                        </label>
                    </div>

                    {/* 伴奏织体:ImproCore Style / mg engine texture */}
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-400">伴奏织体</span>
                        <div className="flex overflow-hidden rounded-md border border-white/10">
                            {([['style', 'Style 织体'], ['mg', 'mg texture']] as const).map(([m, label]) => (
                                <button
                                    key={m}
                                    onClick={() => setCompMode(m)}
                                    disabled={m === 'mg' && !mgAvailable}
                                    title={m === 'mg' ? 'mg engine 按 SmartGen 风格演绎和声织体(+Style 鼓);需先 SmartGen' : 'ImproCore .sty 织体'}
                                    className={`px-3 py-1 text-xs transition ${compMode === m ? 'bg-fuchsia-500/20 text-fuchsia-200' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'} disabled:opacity-40`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        {compMode === 'mg' && mgAvailable && getMgContext() && (
                            <span className="text-[10px] text-fuchsia-300/80">{getMgContext()!.style} 织体 · 随 SmartGen 风格自动切换</span>
                        )}
                        {compMode === 'mg' && !mgAvailable && (
                            <span className="text-[10px] text-zinc-500">改了和弦 → 已回退 Style(重按 SmartGen 恢复)</span>
                        )}
                    </div>

                    {/* Rectify + 装饰(Transform) */}
                    <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-xs text-zinc-400" title="把 solo 吸附进音阶:和弦音阶(IV 默认)/ 全曲调性(更统一)">
                            Rectify
                            <select
                                value={rectifyMode}
                                onChange={(e) => setRectifyMode(e.target.value as 'off' | 'chord' | 'key')}
                                className="rounded-md border border-white/10 bg-zinc-800 px-2 py-1 text-sm outline-none focus:border-cyan-400"
                            >
                                <option value="chord">和弦音阶</option>
                                <option value="key">全曲调性</option>
                                <option value="off">关</option>
                            </select>
                        </label>
                        <label className="flex items-center gap-2 text-xs text-zinc-400">
                            <input type="checkbox" checked={embellish} onChange={(e) => setEmbellish(e.target.checked)} className="accent-cyan-500" />
                            装饰
                        </label>
                        <select
                            value={transform}
                            onChange={(e) => setTransform(e.target.value)}
                            disabled={!embellish}
                            className="min-w-0 flex-1 rounded-md border border-white/10 bg-zinc-800 px-2 py-1 text-sm outline-none focus:border-cyan-400 disabled:opacity-40"
                        >
                            {ALL_TRANSFORM_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                    </div>

                    {/* 音色(GM program):旋律 / 伴奏 各自独立 */}
                    <div className="flex items-center gap-3">
                        <label className="flex flex-1 items-center gap-2 text-xs text-zinc-400">
                            旋律音色
                            <select
                                value={melodyProgram}
                                onChange={(e) => setMelodyProgram(Number(e.target.value))}
                                className="min-w-0 flex-1 rounded-md border border-white/10 bg-zinc-800 px-2 py-1 text-sm outline-none focus:border-cyan-400"
                            >
                                {GM_INSTRUMENTS.map(g => <option key={g.program} value={g.program}>{g.name}</option>)}
                            </select>
                        </label>
                        <label className="flex flex-1 items-center gap-2 text-xs text-zinc-400">
                            伴奏音色
                            <select
                                value={compProgram}
                                onChange={(e) => setCompProgram(Number(e.target.value))}
                                className="min-w-0 flex-1 rounded-md border border-white/10 bg-zinc-800 px-2 py-1 text-sm outline-none focus:border-cyan-400"
                            >
                                {GM_INSTRUMENTS.map(g => <option key={g.program} value={g.program}>{g.name}</option>)}
                            </select>
                        </label>
                    </div>

                    {/* 音色:贝斯 / 鼓 各自独立 */}
                    <div className="flex items-center gap-3">
                        <label className="flex flex-1 items-center gap-2 text-xs text-zinc-400">
                            贝斯音色
                            <select
                                value={bassProgram}
                                onChange={(e) => setBassProgram(Number(e.target.value))}
                                className="min-w-0 flex-1 rounded-md border border-white/10 bg-zinc-800 px-2 py-1 text-sm outline-none focus:border-cyan-400"
                            >
                                {GM_INSTRUMENTS.map(g => <option key={g.program} value={g.program}>{g.name}</option>)}
                            </select>
                        </label>
                        <label className="flex flex-1 items-center gap-2 text-xs text-zinc-400">
                            鼓组
                            <select
                                value={drumKit}
                                onChange={(e) => setDrumKit(Number(e.target.value))}
                                className="min-w-0 flex-1 rounded-md border border-white/10 bg-zinc-800 px-2 py-1 text-sm outline-none focus:border-cyan-400"
                            >
                                {DRUM_KITS.map(k => <option key={k.program} value={k.program}>{k.name}</option>)}
                            </select>
                        </label>
                    </div>

                    {/* 传输控制 */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleAll}
                            className="rounded-md bg-cyan-500 px-5 py-1.5 text-sm font-semibold text-black hover:bg-cyan-400"
                        >
                            ▶ 全部(Solo+伴奏)
                        </button>
                        <button
                            onClick={handleSolo}
                            className="rounded-md border border-cyan-500/40 px-3 py-1.5 text-sm text-cyan-200 hover:bg-cyan-500/10"
                        >
                            Solo
                        </button>
                        <button
                            onClick={handlePlay}
                            className="rounded-md border border-cyan-500/40 px-3 py-1.5 text-sm text-cyan-200 hover:bg-cyan-500/10"
                        >
                            伴奏
                        </button>
                        <div className="flex-1" />
                        <button
                            onClick={handleStop}
                            className="rounded-md border border-white/15 px-4 py-1.5 text-sm hover:bg-white/5"
                        >
                            ■ Stop
                        </button>
                    </div>

                    {/* 状态 */}
                    <div className="border-t border-white/10 pt-3 text-xs text-zinc-400">
                        状态:<span className="text-zinc-200">{status}</span>
                        <span className="ml-3 text-zinc-600">Esc 关闭 · 同时按 Q+I 调出</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
