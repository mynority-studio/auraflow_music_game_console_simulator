// ============================================================
// motifCore sandbox — Q+M 听感验证控制板(A 阶段)
// ============================================================
//
// 平行于 improCore 的独立浮层:同时按 Q + M 调出 / Esc 关闭。
// 只为「试听 motif 经济」服务,不走主系统、不碰 improCore。
// 验证假设:一个 motif → 随和声 applyTransform 模进 + rectify → 成句。
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ALL_TRANSFORM_NAMES } from '../improCore/engine';
import { TOPLINE_GRAMMARS, DEFAULT_GRAMMAR } from './grammarPalette';
import { buildPhrase, buildGroove, type MotifSource } from './motifDemo';
import { buildDefaultSong, smartGenSong, type Song } from './songSource';
import { routeFor } from './stylePalette';
import { diagnoseHarmony, type HarmonyReport } from './harmonyDoctor';
import { playTracks, stopPlayback, type DemoTrack } from './audioOut';
import { withSeed, makeSeed } from './seededRng';
import { analyzeChord, viewFromMg, KIND_COLOR, FUNC_COLOR, type ChordKind } from './roman';
import { usePlayhead } from './usePlayhead';

// 主旋律可选 GM 音色(program 号),按音色族分组
const MELODY_INSTRUMENTS: ReadonlyArray<{ group: string; items: ReadonlyArray<[number, string]> }> = [
    { group: '钢琴 / 键盘', items: [[0, 'Acoustic Piano'], [1, 'Bright Piano'], [4, 'E-Piano'], [5, 'E-Piano 2'], [11, 'Vibraphone'], [16, 'Drawbar Organ']] },
    { group: '吹奏 — 木管', items: [[73, 'Flute'], [75, 'Pan Flute'], [72, 'Piccolo'], [71, 'Clarinet'], [68, 'Oboe'], [79, 'Ocarina']] },
    { group: '吹奏 — 萨克斯 / 铜管', items: [[64, 'Soprano Sax'], [65, 'Alto Sax'], [66, 'Tenor Sax'], [56, 'Trumpet'], [57, 'Trombone'], [60, 'French Horn']] },
    { group: '合成 Lead', items: [[80, 'Square Lead'], [81, 'Saw Lead'], [82, 'Calliope'], [83, 'Chiff Lead'], [84, 'Charang'], [85, 'Voice Lead']] },
    { group: '合成 Pad', items: [[88, 'New Age Pad'], [89, 'Warm Pad'], [90, 'Polysynth'], [91, 'Choir Pad'], [94, 'Halo Pad'], [54, 'Synth Voice']] },
    { group: '拨弦 / 吉他', items: [[24, 'Nylon Guitar'], [25, 'Steel Guitar'], [26, 'Jazz Guitar'], [27, 'Clean Guitar'], [46, 'Harp'], [108, 'Kalimba']] },
    { group: '弦乐 / 人声', items: [[40, 'Violin'], [42, 'Cello'], [48, 'String Ensemble'], [49, 'Slow Strings'], [52, 'Choir Aahs'], [85, 'Voice Oohs']] },
];

// 贝斯音色(GM program)
const BASS_INSTRUMENTS: ReadonlyArray<[number, string]> = [
    [32, 'Acoustic Bass'], [33, 'Finger Bass'], [34, 'Pick Bass'], [35, 'Fretless Bass'],
    [36, 'Slap Bass'], [38, 'Synth Bass 1'], [39, 'Synth Bass 2'], [43, 'Contrabass'],
];

// 伴奏织体音色(GM program;键盘/吉他/弦垫)
const COMP_INSTRUMENTS: ReadonlyArray<[number, string]> = [
    [4, 'E-Piano'], [0, 'Acoustic Piano'], [1, 'Bright Piano'], [5, 'E-Piano 2'],
    [11, 'Vibraphone'], [16, 'Drawbar Organ'], [24, 'Nylon Guitar'], [26, 'Jazz Guitar'],
    [89, 'Warm Pad'], [88, 'New Age Pad'], [48, 'String Ensemble'],
];

// 鼓组(channel 9 的 program 选 GM 鼓组;soundfont 缺则回退 Standard)
const DRUM_KITS: ReadonlyArray<[number, string]> = [
    [0, 'Standard Kit'], [8, 'Room Kit'], [16, 'Power Kit'], [24, 'Electronic Kit'],
    [25, 'TR-808'], [32, 'Jazz Kit'], [40, 'Brush Kit'], [48, 'Orchestra Kit'],
];

const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 99999,
    background: 'rgba(8,10,16,0.82)', backdropFilter: 'blur(6px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#e6e9ef',
};
const card: React.CSSProperties = {
    width: 920, maxWidth: '95vw', maxHeight: '92vh', overflow: 'auto', background: '#141925',
    border: '1px solid #2a3346', borderRadius: 12, padding: 28,
    boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
};
const btn: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px', marginBottom: 8,
    background: '#1d2433', border: '1px solid #313c52', borderRadius: 8,
    color: '#e6e9ef', cursor: 'pointer', fontSize: 14,
};

// 音阶名缩写(bar 卡省地方):Mixolydian→Mixo, Lydian Dominant→LydDom 等
const SCALE_ABBR: Record<string, string> = {
    Ionian: 'Ion', Dorian: 'Dor', Phrygian: 'Phr', Lydian: 'Lyd', Mixolydian: 'Mixo',
    Aeolian: 'Aeo', Locrian: 'Loc', 'Lydian Dominant': 'LydDom', Altered: 'Alt',
    'Phrygian Dominant': 'PhrDom', 'Harmonic Minor': 'HarmMin', 'Melodic Minor': 'MelMin',
    'Whole Tone': 'WT', Diminished: 'Dim', 'Half-Whole Diminished': 'HWDim',
};
function abbrevScale(name: string): string {
    return SCALE_ABBR[name] ?? name.slice(0, 6);
}

function Legend({ color, text }: { color: string; text: string }): React.ReactElement {
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block' }} />
            {text}
        </span>
    );
}

export function MotifCorePanel(): React.ReactElement | null {
    const [open, setOpen] = useState(false);
    const [srcKind, setSrcKind] = useState<'grammar' | 'guidetone'>('guidetone');
    const [grammar, setGrammar] = useState(DEFAULT_GRAMMAR);
    const [gtColor, setGtColor] = useState(true);      // GuideTone 允许色彩音(起始音级=加权随机,见 motifDemo)
    const [transformOn, setTransformOn] = useState(true); // Transform 后处理(默认开,随机用一个风格库)
    const [divideOn, setDivideOn] = useState(true);    // Divide 后处理(默认开,概率触发 ×1)
    const [bpm, setBpm] = useState(84);
    // 三轨独立 mute(伴奏每次都生成,这里只控制是否发声)
    const [melodyOn, setMelodyOn] = useState(true); // 主旋律(可 mute 单独听伴奏)
    const [compOn, setCompOn] = useState(true);   // 和弦织体(drop2 voicing 铺底)
    const [bassOn, setBassOn] = useState(true);   // 贝斯(IMP walking / mg)
    const [drumsOn, setDrumsOn] = useState(true); // 鼓(IMP style 流派鼓)
    const [resolveEnd, setResolveEnd] = useState(true);
    const [pedalOn, setPedalOn] = useState(true);  // CC64 延音踏板(织体整句/旋律半句)
    const [melodyProgram, setMelodyProgram] = useState(73); // 默认 Flute
    const [bassProgram, setBassProgram] = useState(32);     // 默认 Acoustic Bass
    const [compProgram, setCompProgram] = useState(4);      // 默认 E-Piano
    const [drumKit, setDrumKit] = useState(0);              // 默认 Standard Kit
    const [song, setSong] = useState<Song>(() => buildDefaultSong());
    const [seed, setSeed] = useState('');            // 当前旋律种子(每段生成唯一,可输入重听)
    const [status, setStatus] = useState('就绪 — 按生成试听整曲');
    const [diag, setDiag] = useState<HarmonyReport | null>(null); // 和声诊断报告
    const heldKeys = useRef<Set<string>>(new Set());

    // 和弦显示模块:按 bar 分组。优先用 mg 权威分析(SmartGen),无则回退启发式。
    const { chordBars, mgPowered } = useMemo(() => {
        type Cell = {
            token: string; roman: string; kind: ChordKind; note: string; outOfKey: boolean;
            func?: 'T' | 'S' | 'D'; funcOverridden?: boolean; localRoman?: string; mustResolve?: boolean;
            scaleName?: string; scaleForced?: boolean;
        };
        const out: Array<{ bar: number; chords: Cell[] }> = [];
        const spans = song.cp.getSpans();
        const ana = song.analysis;
        spans.forEach((s, i) => {
            const bar = Math.floor(s.start / 480);
            let g = out.find(x => x.bar === bar);
            if (!g) { g = { bar, chords: [] }; out.push(g); }
            // mg 分析按顺序与 spans 一一对应(同源 leadsheet);优先取之
            const a = ana?.[i];
            if (a) {
                const v = viewFromMg(a, song.keyRoot);
                g.chords.push({
                    token: s.chord.getName(), roman: v.roman, kind: v.kind, note: v.note, outOfKey: v.outOfKey,
                    func: v.func, funcOverridden: v.funcOverridden,
                    localRoman: v.showLocal ? v.localRoman : undefined, mustResolve: v.mustResolve,
                    scaleName: a.scaleName, scaleForced: a.scaleSource === 'forced',
                });
            } else {
                const info = analyzeChord(s.chord, song.keyRoot);
                g.chords.push({ token: s.chord.getName(), roman: info.label, kind: info.kind, note: info.note, outOfKey: info.outOfKey });
            }
        });
        return { chordBars: out, mgPowered: !!ana && ana.length > 0 };
    }, [song]);

    const head = usePlayhead(song.barCount);

    useEffect(() => {
        const isTyping = () => {
            const el = document.activeElement;
            return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
        };
        const onKeyDown = (e: KeyboardEvent) => {
            const k = e.key.toLowerCase();
            heldKeys.current.add(k);
            if (!open && heldKeys.current.has('q') && heldKeys.current.has('m') && !isTyping()) {
                e.preventDefault();
                setOpen(true);
            } else if (open && k === 'escape') {
                setOpen(false);
                stopPlayback();
            }
        };
        const onKeyUp = (e: KeyboardEvent) => heldKeys.current.delete(e.key.toLowerCase());
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
        };
    }, [open]);

    const play = useCallback((useSeedArg?: string) => {
        try {
            const s = useSeedArg && useSeedArg.trim() ? useSeedArg.trim() : makeSeed();
            setSeed(s);
            const source: MotifSource =
                srcKind === 'grammar' ? { grammar }
                : { guidetone: { startDegree: 'random', allowColor: gtColor, direction: 0 } }; // 起始音级加权随机,密度默认 HALF
            // 在 seed 控制的随机流下生成整曲 → 同一 seed 完全可复现。
            // Transform 默认开 → 随机选一个乐手风格库(不分类);放进 withSeed 闭包保证可复现。
            const phrase = withSeed(s, () => {
                const tf = transformOn ? (ALL_TRANSFORM_NAMES[Math.floor(Math.random() * ALL_TRANSFORM_NAMES.length)] ?? 'off') : 'off';
                return buildPhrase(source, song, { transform: tf, divideProb: divideOn ? 0.5 : 0, resolveEnd });
            });
            const g = buildGroove(song);
            // 踏板边界 = 和弦段起始 slot(每和弦换抬一下,参考 mg);风格 usePedal + 面板 pedalOn 双控
            const route = routeFor(song.macro);
            const chordBoundaries = (route.usePedal && pedalOn)
                ? song.cp.getSpans().map(sp => sp.start)
                : undefined;
            // 轨间音量均衡(gain × note.velocity)。踏板只给织体(旋律不踩 → 不糊,同 mg melody 不踩)
            // 音量均衡:各轨归一到目标 velocity(mix),主旋律最突出 > bass > 织体 > 鼓
            const tracks: DemoTrack[] = [];
            if (melodyOn) tracks.push({ notes: phrase.melody, channel: 0, program: melodyProgram, mix: 96 }); // 主旋律:最响
            if (compOn) tracks.push({ notes: phrase.chords, channel: 1, program: compProgram, mix: 74, pedalBoundaries: chordBoundaries }); // 织体:中等铺底
            if (bassOn) tracks.push({ notes: g.bass, channel: 2, program: bassProgram, mix: 80 });   // bass:支撑
            if (compOn && g.comp.length) tracks.push({ notes: g.comp, channel: 3, program: compProgram, mix: 74 });
            if (drumsOn) tracks.push({ notes: g.drums, channel: 9, program: drumKit, mix: 70 });      // 鼓:律动不抢
            void playTracks(tracks, bpm);
            // 和声诊断:核 bass/织体/旋律骨干位的和声合规
            setDiag(diagnoseHarmony(song, { melody: phrase.melody, bass: g.bass, comp: phrase.chords }));
            const srcLabel = srcKind === 'grammar' ? grammar : 'GuideTone';
            setStatus(`▶ ${s} · ${song.macro} · ${srcLabel} · ${phrase.pitches.length} 音`);
        } catch (err) {
            setStatus('✗ ' + (err as Error).message);
        }
    }, [srcKind, grammar, gtColor, transformOn, divideOn, bpm, melodyOn, compOn, bassOn, drumsOn, resolveEnd, pedalOn, melodyProgram, bassProgram, compProgram, drumKit, song]);

    const regen = useCallback(() => {
        try {
            const s = smartGenSong();
            setSong(s);
            stopPlayback();
            setStatus('🎲 新和声:' + s.label + ' — 按发展模式试听');
        } catch (err) {
            setStatus('✗ SmartGen 失败:' + (err as Error).message);
        }
    }, []);

    if (!open) return null;

    return (
        <div style={overlay} onClick={() => { setOpen(false); stopPlayback(); }}>
            <div style={card} onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                    <strong style={{ fontSize: 16 }}>motifCore · 听感沙盒</strong>
                    <span style={{ fontSize: 12, opacity: 0.6 }}>Esc 关闭</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>{song.label}</span>
                    <button
                        style={{ ...btn, width: 'auto', margin: 0, padding: '5px 12px', fontSize: 12 }}
                        onClick={regen}>🎲 SmartGen 和声</button>
                    <button
                        style={{ ...btn, width: 'auto', margin: 0, padding: '5px 12px', fontSize: 12 }}
                        onClick={() => { setSong(buildDefaultSong()); stopPlayback(); setStatus('已回到默认 ii-V'); }}>默认</button>
                </div>
                {/* 实时 bar 条 — 每格一小节:bar 号 + 和弦名 + 级数(离调配色)+ TSD + 播放头高亮 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, opacity: 0.6 }}>
                        和弦进行 · 共 {song.barCount} 小节{head.playing ? ` · ▶ Bar ${head.bar + 1}` : ''}
                        {mgPowered
                            ? <span style={{ color: '#5fb3a3', marginLeft: 6 }}>· mg 权威分析</span>
                            : <span style={{ opacity: 0.5, marginLeft: 6 }}>· 启发式(默认进行)</span>}
                    </span>
                    <span style={{ fontSize: 10, opacity: 0.6, display: 'flex', gap: 10 }}>
                        <Legend color={KIND_COLOR.diatonic} text="自然音级" />
                        <Legend color={KIND_COLOR.secondary} text="副属" />
                        <Legend color={KIND_COLOR.borrowed} text="借用" />
                        <Legend color={KIND_COLOR.chromatic} text="半音" />
                    </span>
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 18 }}>
                    {chordBars.map(b => {
                        const active = head.playing && head.bar === b.bar;
                        return (
                            <div key={b.bar} style={{
                                position: 'relative', minWidth: 56, flex: '0 0 auto',
                                border: '1px solid ' + (active ? '#5b7cff' : '#2a3346'),
                                borderRadius: 6, padding: '4px 6px 5px', textAlign: 'center',
                                background: active ? '#243056' : '#0f131c',
                                boxShadow: active ? '0 0 0 1px #5b7cff, 0 0 12px rgba(91,124,255,0.4)' : 'none',
                                transition: 'background 80ms, box-shadow 80ms',
                            }}>
                                <div style={{ fontSize: 9, opacity: 0.45, marginBottom: 1 }}>{b.bar + 1}</div>
                                {b.chords.map((c, i) => (
                                    <div key={i} style={{ lineHeight: 1.25 }} title={c.note}>
                                        <div style={{ fontSize: 12, color: '#e6e9ef' }}>{c.token}</div>
                                        <div style={{ display: 'flex', gap: 3, justifyContent: 'center', alignItems: 'baseline' }}>
                                            <span style={{ fontSize: 11, color: KIND_COLOR[c.kind], fontWeight: 600 }}>
                                                {c.roman}{c.outOfKey ? '*' : ''}
                                            </span>
                                            {c.func && (
                                                <span style={{ fontSize: 8, color: FUNC_COLOR[c.func], fontWeight: 700 }}>
                                                    {c.func}{c.funcOverridden ? '*' : ''}
                                                </span>
                                            )}
                                        </div>
                                        {c.scaleName && (
                                            <div style={{ fontSize: 8, color: c.scaleForced ? '#f2994a' : '#5fb3a3', opacity: 0.95 }}
                                                 title={c.scaleForced ? 'planner 盖的离调色彩音阶' : 'chordScaleFor 功能推导'}>
                                                {abbrevScale(c.scaleName)}
                                            </div>
                                        )}
                                        {c.localRoman && (
                                            <div style={{ fontSize: 8, color: '#9c7b3f' }}>loc:{c.localRoman}</div>
                                        )}
                                        {c.mustResolve && (
                                            <div style={{ fontSize: 8, color: '#e06b6b', opacity: 0.85 }}>↳须解决</div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        );
                    })}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 10 }}>
                    <span style={{ opacity: 0.7, whiteSpace: 'nowrap' }}>motif 来源</span>
                    {([
                        ['guidetone', 'GuideTone', '导音骨架(确定·平滑·贴和声;起始音级加权随机 3/7 优先)'],
                        ['grammar', 'Grammar', 'Impro-Visor 语法 lick(随机)'],
                    ] as ReadonlyArray<[typeof srcKind, string, string]>).map(([k, label, tip]) => (
                        <button key={k} title={tip} onClick={() => setSrcKind(k)}
                            style={{
                                padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                                border: '1px solid ' + (srcKind === k ? '#5b7cff' : '#313c52'),
                                background: srcKind === k ? '#26314f' : '#1d2433',
                                color: srcKind === k ? '#cdd9ff' : '#9aa6bd',
                            }}>{label}</button>
                    ))}
                    {srcKind === 'grammar' && (
                        <select value={grammar} onChange={e => setGrammar(e.target.value)}
                            style={{ marginLeft: 'auto', background: '#0f131c', color: '#e6e9ef', border: '1px solid #313c52', borderRadius: 6, padding: '3px 6px' }}>
                            {TOPLINE_GRAMMARS.map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                    )}
                    {srcKind === 'guidetone' && (
                        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input type="checkbox" checked={gtColor} onChange={e => setGtColor(e.target.checked)} />色彩音
                        </label>
                    )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12, marginBottom: 12 }}>
                    <span style={{ opacity: 0.7, whiteSpace: 'nowrap' }}>后处理</span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5 }} title="真人即兴习语装饰(默认开,随机用一个风格库)">
                        <input type="checkbox" checked={transformOn} onChange={e => setTransformOn(e.target.checked)} />
                        Transform <span style={{ opacity: 0.5 }}>(随机风格库)</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5 }} title="Fractal 概率细分成更活跃的线(每段 50% 触发 ×1)">
                        <input type="checkbox" checked={divideOn} onChange={e => setDivideOn(e.target.checked)} />
                        Divide <span style={{ opacity: 0.5 }}>(概率 ×1)</span>
                    </label>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 8 }}>
                    <span style={{ opacity: 0.7, width: 56 }}>主旋律</span>
                    <select value={melodyProgram} onChange={e => setMelodyProgram(Number(e.target.value))}
                        style={{ flex: 1, background: '#0f131c', color: '#e6e9ef', border: '1px solid #313c52', borderRadius: 6, padding: '5px 8px' }}>
                        {MELODY_INSTRUMENTS.map(g => (
                            <optgroup key={g.group} label={g.group}>
                                {g.items.map(([prog, name]) => <option key={prog} value={prog}>{name}</option>)}
                            </optgroup>
                        ))}
                    </select>
                </label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, fontSize: 12 }}>
                        <span style={{ opacity: 0.7, width: 30 }}>织体</span>
                        <select value={compProgram} onChange={e => setCompProgram(Number(e.target.value))}
                            style={{ flex: 1, background: '#0f131c', color: '#e6e9ef', border: '1px solid #313c52', borderRadius: 6, padding: '4px 6px' }}>
                            {COMP_INSTRUMENTS.map(([p, n]) => <option key={p} value={p}>{n}</option>)}
                        </select>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, fontSize: 12 }}>
                        <span style={{ opacity: 0.7, width: 30 }}>Bass</span>
                        <select value={bassProgram} onChange={e => setBassProgram(Number(e.target.value))}
                            style={{ flex: 1, background: '#0f131c', color: '#e6e9ef', border: '1px solid #313c52', borderRadius: 6, padding: '4px 6px' }}>
                            {BASS_INSTRUMENTS.map(([p, n]) => <option key={p} value={p}>{n}</option>)}
                        </select>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, fontSize: 12 }}>
                        <span style={{ opacity: 0.7, width: 18 }}>鼓</span>
                        <select value={drumKit} onChange={e => setDrumKit(Number(e.target.value))}
                            style={{ flex: 1, background: '#0f131c', color: '#e6e9ef', border: '1px solid #313c52', borderRadius: 6, padding: '4px 6px' }}>
                            {DRUM_KITS.map(([p, n]) => <option key={p} value={p}>{n}</option>)}
                        </select>
                    </label>
                </div>

                {/* 种子监控 — 每段生成唯一种子,可输入重听 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 12 }}>
                    <span style={{ opacity: 0.7, whiteSpace: 'nowrap' }}>旋律种子</span>
                    <input value={seed} onChange={e => setSeed(e.target.value)} spellCheck={false}
                        placeholder="生成后出现 · 可粘贴重听"
                        style={{ flex: 1, background: '#0f131c', color: '#9ad1ff', border: '1px solid #313c52', borderRadius: 6, padding: '5px 8px', fontFamily: 'inherit', fontSize: 12 }} />
                    <button onClick={() => play(seed)}
                        style={{ ...btn, width: 'auto', margin: 0, padding: '5px 12px', fontSize: 12 }}>🔁 重听</button>
                </div>

                <button style={{ ...btn, textAlign: 'center', fontWeight: 700, fontSize: 15, padding: '14px', background: '#26314f', borderColor: '#5b7cff', color: '#cdd9ff' }}
                    onClick={() => play()}>
                    ▶ 生成整曲旋律
                    <div style={{ fontSize: 11, fontWeight: 400, opacity: 0.6, marginTop: 2 }}>
                        在整首 changes 上跑 {srcKind === 'grammar' ? grammar : 'GuideTone'} → Transform/Divide → 选音
                    </div>
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 14, fontSize: 13 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="主旋律(关掉可单独听伴奏)">
                        <input type="checkbox" checked={melodyOn} onChange={e => setMelodyOn(e.target.checked)} />
                        主旋律
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="和弦织体(drop2/宽排 voicing)">
                        <input type="checkbox" checked={compOn} onChange={e => setCompOn(e.target.checked)} />
                        织体
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="贝斯(IMP walking / mg)">
                        <input type="checkbox" checked={bassOn} onChange={e => setBassOn(e.target.checked)} />
                        Bass
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="鼓(IMP style 流派鼓组)">
                        <input type="checkbox" checked={drumsOn} onChange={e => setDrumsOn(e.target.checked)} />
                        鼓
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="checkbox" checked={resolveEnd} onChange={e => setResolveEnd(e.target.checked)} />
                        曲尾落主音
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="CC64 延音踏板(织体整句/旋律半句)">
                        <input type="checkbox" checked={pedalOn} onChange={e => setPedalOn(e.target.checked)} />
                        踏板
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                        bpm {bpm}
                        <input type="range" min={60} max={140} value={bpm} onChange={e => setBpm(Number(e.target.value))} style={{ flex: 1 }} />
                    </label>
                    <button style={{ ...btn, width: 'auto', margin: 0, padding: '6px 12px' }} onClick={() => { stopPlayback(); setStatus('已停止'); }}>停止</button>
                </div>

                <div style={{ marginTop: 14, fontSize: 12, opacity: 0.8, minHeight: 18 }}>{status}</div>

                {/* 和声诊断报告 */}
                {diag && (
                    <div style={{ marginTop: 10, padding: '8px 10px', background: '#0f131c', border: '1px solid #2a3346', borderRadius: 8, fontSize: 11, lineHeight: 1.6 }}>
                        <div style={{ fontWeight: 700, color: '#9ee8d4', marginBottom: 4 }}>🩺 和声诊断</div>
                        {diag.summary.map((line, i) => {
                            const bad = line.includes('✗') || /:\s*[0-8]?[0-9]%/.test(line) && !line.includes('100%');
                            return <div key={i} style={{ color: bad ? '#f2994a' : '#9aa6bd' }}>{line}</div>;
                        })}
                        {/* 违规明细(最多 6 条)*/}
                        {(() => {
                            const vios = [
                                ...(diag.bass?.violations ?? []).map(v => ({ ...v, t: 'bass' })),
                                ...(diag.comp?.violations ?? []).map(v => ({ ...v, t: '织体' })),
                                ...(diag.melody?.violations ?? []).map(v => ({ ...v, t: '旋律' })),
                            ].slice(0, 6);
                            return vios.length > 0 ? (
                                <div style={{ marginTop: 4, color: '#e06b6b', opacity: 0.85 }}>
                                    {vios.map((v, i) => <div key={i}>· bar{v.bar + 1} [{v.t}] {v.reason}</div>)}
                                </div>
                            ) : <div style={{ marginTop: 4, color: '#5fb3a3' }}>✓ 无违规</div>;
                        })()}
                        {/* 和弦拆解异常 */}
                        {diag.chords.filter(c => c.issues.length).map((c, i) => (
                            <div key={'c' + i} style={{ color: '#e06b6b' }}>· bar{c.bar + 1} {c.name}: {c.issues.join('; ')}</div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
