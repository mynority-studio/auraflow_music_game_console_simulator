import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Headphones, Play, Square } from 'lucide-react';
import {
    AudioEngine,
    SOUND_FONT_BANKS,
    getLoadedSoundFontBank,
    getSelectedSoundFontBank,
    startAudioContext,
    subscribeSoundFontBank,
    type SoundFontBankId,
} from '../core/audio/AudioEngine';
import { Dream5504MidiOutput } from '../core/audio/Dream5504MidiOutput';
import {
    GM128_CATALOG_COUNTS,
    GM128_FULL_AUDITION_INSTRUMENTS,
    type GM128CatalogItem,
} from '../core/sound/GMBK5X128Catalog';
import { parseSMF } from '../core/audio/smfParser';
import { globalMidiScheduler } from '../core/audio/MidiScheduler';
import { sendMidiPolyphonyAudition } from '../core/generation/midiOutSandbox/midiOut';

/* 曲终复位上传播放态（codex P3）：globalMidiScheduler.onTrackEnd 无 unsubscribe →
 * 模块级只注册一次 + 可变回调间接层（防 dev StrictMode 双挂载重复注册；组件卸载
 * 置空即哑）。对生成曲的曲终也会触发——彼时 midiUploadPlaying 本为 false，置 false 幂等。 */
let _midiUploadEndCb: (() => void) | null = null;
let _midiUploadEndRegistered = false;

const AUDITION_CHANNEL = 8;
const DRUM_CHANNEL = 9;
/** 主键盘（AuraJam/AuraBar 按键）所在的自由演奏通道——镜像设备 ch0。 */
const KEYBOARD_CHANNEL = 0;
type AuditionItem = {
    bank: number;
    program: number;
    role: GM128CatalogItem['role'];
    name: string;
    note: number;
    sampleSizeBytes: number;
    sampleSizeLabel: string;
};
type DiagnosticAuditionCase = {
    id: string;
    label: string;
    role: AuditionItem['role'];
    bank: number;
    program: number;
    notes: readonly number[];
    velocity: number;
    durationMs: number;
};
type DiagnosticAuditionVariant = {
    id: string;
    label: string;
    title: string;
};
const auditionItemsForBank = (_bankId: string): readonly AuditionItem[] => GM128_FULL_AUDITION_INSTRUMENTS;
/** UI 检查用全乐器列表：旋律走 ch0，鼓组走 ch9。 */
const ALL_INSTRUMENTS = GM128_FULL_AUDITION_INSTRUMENTS;
/** 初始乐器 = 列表首项（GM 0:0 大钢琴，与合成器 GMReset 默认一致——无需占位"默认"项）。 */
const DEFAULT_INSTRUMENT_KEY = `${ALL_INSTRUMENTS[0].role}:${ALL_INSTRUMENTS[0].bank}:${ALL_INSTRUMENTS[0].program}`;
const NOTE_OFF_CC = 123;
const ELECTRIC_KEY_PROGRAM = 5;
const FOLK_GUITAR_PROGRAM = 25;
const DIAGNOSTIC_POLYPHONY = 10;

const auditionKey = (item: Pick<AuditionItem, 'bank' | 'program' | 'role'>): string => `${item.role}:${item.bank}:${item.program}`;
const auditionChannelFor = (item: Pick<AuditionItem, 'role'>): number => item.role === 'drum' ? DRUM_CHANNEL : KEYBOARD_CHANNEL;
const selectPresetRaw = (channel: number, item: Pick<AuditionItem, 'bank' | 'program' | 'role'>): void => {
    if (item.role !== 'drum') {
        const bank = Math.max(0, Math.min(127, Math.round(item.bank)));
        AudioEngine.controllerChange(channel, 0, bank);
    }
    AudioEngine.programChange(channel, Math.max(0, Math.min(127, Math.round(item.program))));
};
const gm128Display = (item: Pick<AuditionItem, 'role' | 'bank' | 'program'>): string =>
    item.role === 'drum' ? `Drum PC ${item.program}` : item.bank === 0 ? `GM PC ${item.program}` : `CC0 ${item.bank} · PC ${item.program}`;
const clampMidiNote = (note: number): number => Math.max(0, Math.min(127, Math.round(note)));
const diagnosticNotesFor = (item: AuditionItem): readonly number[] => {
    if (item.role === 'drum') return [36, 38, 42, 46, 49, 36, 38, 42, 46, 49];
    if (item.role === 'bass') return [item.note, item.note + 7, item.note + 12, item.note + 15, item.note + 19, item.note + 24, item.note + 28, item.note + 31, item.note + 36, item.note + 40].map(clampMidiNote);
    // Pad 试听只验证音色/复音，不硬编码大三度或 maj7。开放 1-2-5 跨八度排列
    // 保持调性中性，避免把固定的“平行三度和声感”误听成这个合成器音色本身。
    if (item.role === 'pad') return [item.note, item.note + 7, item.note + 12, item.note + 14, item.note + 19, item.note + 24, item.note + 26, item.note + 31, item.note + 36, item.note + 38].map(clampMidiNote);
    if (item.program === 24 || item.program === FOLK_GUITAR_PROGRAM) return [52, 57, 61, 64, 68, 70, 72, 76, 80, 88];
    if (item.program === 66 || item.program === 67) return [43, 47, 50, 54, 57, 62, 66, 69, 72, 72];
    if (item.program === 108) return [60, 64, 67, 71, 74, 76, 79, 81, 84, 88];
    if (item.program === 0 || item.program === 4 || item.program === ELECTRIC_KEY_PROGRAM) return [52, 55, 60, 64, 67, 71, 74, 78, 83, 88];
    return [item.note, item.note + 4, item.note + 7, item.note + 11, item.note + 14, item.note + 16, item.note + 19, item.note + 23, item.note + 26, item.note + 28].map(clampMidiNote);
};
const diagnosticVelocityFor = (item: AuditionItem): number => {
    if (item.role === 'drum') return 94;
    if (item.role === 'pad') return 62;
    if (item.role === 'bass') return 72;
    if (item.program === ELECTRIC_KEY_PROGRAM) return 74;
    if (item.program === 0) return 78;
    return 76;
};
const diagnosticDurationFor = (item: AuditionItem): number => {
    if (item.role === 'drum') return 900;
    if (item.role === 'pad') return 2600;
    if (item.role === 'bass') return 2000;
    return 2200;
};
const DIAGNOSTIC_AUDITION_CASES: readonly DiagnosticAuditionCase[] = GM128_FULL_AUDITION_INSTRUMENTS.map(item => ({
    id: `${item.bank}-${item.program}-${item.role}`,
    label: item.role === 'pad'
      ? `${item.name} 开放 1·2·5 ${DIAGNOSTIC_POLYPHONY}复音`
      : `${item.name} ${DIAGNOSTIC_POLYPHONY}${item.role === 'drum' ? '击' : '复音'}`,
    role: item.role,
    bank: item.bank,
    program: item.program,
    notes: diagnosticNotesFor(item),
    velocity: diagnosticVelocityFor(item),
    durationMs: diagnosticDurationFor(item),
}));
const DIAGNOSTIC_AUDITION_VARIANTS: readonly DiagnosticAuditionVariant[] = [
    {
        id: 'midi',
        label: 'MIDI',
        title: '通过 MIDI 输出面板当前连接的设备只发送 Bank/Program 与复音 Note On/Off。',
    },
];

export const SoundFontSelector: React.FC = () => {
    const [selectedId, setSelectedId] = useState<SoundFontBankId>(() => getSelectedSoundFontBank().id);
    const [loadedId, setLoadedId] = useState<SoundFontBankId | null>(() => getLoadedSoundFontBank()?.id ?? null);
    const [pendingId, setPendingId] = useState<SoundFontBankId | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [auditionOpen, setAuditionOpen] = useState(false);
    const [auditioning, setAuditioning] = useState<string | null>(null);
    const [instrumentKey, setInstrumentKey] = useState<string>(DEFAULT_INSTRUMENT_KEY);
    const [midiOutState, setMidiOutState] = useState(() => Dream5504MidiOutput.getState());
    const auditionTimers = useRef<number[]>([]);
    const instrumentKeyRef = useRef<string>(DEFAULT_INSTRUMENT_KEY);   // subscribe 闭包用（避免 stale state）

    useEffect(() => Dream5504MidiOutput.subscribe(() => setMidiOutState(Dream5504MidiOutput.getState())), []);
    /* 上传 MIDI 播放：file input ref + 状态行；播放走 Dream 5504 MIDI 输出。 */
    const midiFileRef = useRef<HTMLInputElement>(null);
    const [midiUploadStatus, setMidiUploadStatus] = useState<string | null>(null);
    const [midiUploadPlaying, setMidiUploadPlaying] = useState(false);
    const handleMidiFile = async (file: File) => {
        /* 上传语义=「替换当前播放」（codex P2）：选文件即先停当前播放并复位 UI——
         * 失败路径由此不会出现「上一首还响但停止钮消失」的状态分叉。 */
        AudioEngine.stop();
        setMidiUploadPlaying(false);
        try {
            const parsed = parseSMF(await file.arrayBuffer());
            if (parsed.noteCount === 0) { setMidiUploadStatus(`${file.name}：无音符事件`); return; }
            await AudioEngine.playUploadedMidi(parsed.events, parsed.bpm);
            setMidiUploadPlaying(true);
            const warn = parsed.warnings.length ? ` ⚠${parsed.warnings.join('；')}` : '';
            setMidiUploadStatus(`▶ ${file.name} · ${Math.round(parsed.bpm)}BPM · ${parsed.noteCount}音 · fmt${parsed.format}/${parsed.trackCount}轨${warn}`);
        } catch (err) {
            setMidiUploadStatus(`✗ ${file.name}：${err instanceof Error ? err.message : String(err)}`);
        }
    };
    const stopUploadedMidi = () => {
        AudioEngine.stop();
        setMidiUploadPlaying(false);
        setMidiUploadStatus(null);
    };
    useEffect(() => {
        _midiUploadEndCb = () => { setMidiUploadPlaying(false); setMidiUploadStatus(null); }; // 曲终清状态行（与手动 ■ 停止一致，不残留 ▶）
        if (!_midiUploadEndRegistered) {
            _midiUploadEndRegistered = true;
            globalMidiScheduler.onTrackEnd(() => { _midiUploadEndCb?.(); });
        }
        return () => { _midiUploadEndCb = null; };
    }, []);
    useEffect(() => {
        return subscribeSoundFontBank(() => {
            setSelectedId(getSelectedSoundFontBank().id);
            setLoadedId(getLoadedSoundFontBank()?.id ?? null);
            // 合成器实例重建（bank/采样率切换）会回 GM 默认——重发当前检查乐器选择（不发确认音）
            const key = instrumentKeyRef.current;
            if (key) {
                const items = auditionItemsForBank(getSelectedSoundFontBank().id);
                const item = items.find(i => auditionKey(i) === key) ?? items[0];
                if (item) selectPresetRaw(auditionChannelFor(item), item);
            }
        });
    }, []);

    useEffect(() => () => {
        clearAuditionTimers();
        stopAudition();
    }, []);

    const clearAuditionTimers = (): void => {
        auditionTimers.current.forEach(timer => window.clearTimeout(timer));
        auditionTimers.current = [];
    };

    const schedule = (fn: () => void, delayMs: number): void => {
        auditionTimers.current.push(window.setTimeout(fn, delayMs));
    };

    const stopAudition = (): void => {
        clearAuditionTimers();
        AudioEngine.controllerChange(AUDITION_CHANNEL, NOTE_OFF_CC, 0);
        AudioEngine.controllerChange(DRUM_CHANNEL, NOTE_OFF_CC, 0);
        setAuditioning(null);
    };

    const melodicPhrase = (item: AuditionItem): void => {
        const root = item.note;
        const electricKey = item.program === ELECTRIC_KEY_PROGRAM;
        const notes = item.program === 66 || item.program === 67
            ? [root, root + 2, root + 5, root + 7]
            : item.program === 32 || item.program === 38
                ? [root, root + 7, root + 12, root + 7]
                : item.role === 'pad'
                    ? [root, root + 7, root + 12]
                    : [root, root + 4, root + 7, root + 12];
        const dur = item.role === 'pad' ? 760 : item.program === 66 || item.program === 67 ? 420 : electricKey ? 360 : 260;
        const isGuitar = item.program === 24 || item.program === FOLK_GUITAR_PROGRAM;
        const velocity = item.role === 'pad' ? 76 : electricKey || item.program === 66 || item.program === 67 || isGuitar ? 84 : 96;
        notes.forEach((note, index) => {
            const at = index * (dur + 45);
            schedule(() => AudioEngine.playNote(AUDITION_CHANNEL, note, velocity, dur), at);
        });
    };

    const drumPhrase = (): void => {
        const hits = [
            [36, 0, 120], [42, 120, 82], [38, 240, 112], [42, 360, 78],
            [36, 480, 118], [46, 600, 78], [38, 720, 112], [42, 840, 78],
        ] as const;
        hits.forEach(([note, at, velocity]) => {
            schedule(() => AudioEngine.playNote(DRUM_CHANNEL, note, velocity, 90), at);
        });
    };

    const audition = async (item: AuditionItem): Promise<void> => {
        const key = auditionKey(item);
        stopAudition();
        setAuditioning(key);
        setError(null);
        try {
            await startAudioContext();
            const channel = item.role === 'drum' ? DRUM_CHANNEL : AUDITION_CHANNEL;
            selectPresetRaw(channel, item);
            if (item.role === 'drum') drumPhrase();
            else melodicPhrase(item);
            schedule(() => setAuditioning(null), item.role === 'drum' ? 1060 : item.role === 'pad' ? 2500 : 1500);
        } catch (err) {
            console.error('SoundFont audition failed', err);
            setError('试听失败');
            setAuditioning(null);
        }
    };

    const diagnosticAudition = async (testCase: DiagnosticAuditionCase, variant: DiagnosticAuditionVariant): Promise<void> => {
        const key = `diag:${testCase.id}:${variant.id}`;
        stopAudition();
        setAuditioning(key);
        setError(null);
        try {
            const item = GM128_FULL_AUDITION_INSTRUMENTS.find(candidate =>
                candidate.role === testCase.role && candidate.bank === testCase.bank && candidate.program === testCase.program
            );
            const sent = sendMidiPolyphonyAudition({
                role: item?.role ?? testCase.role,
                bank: testCase.bank,
                program: testCase.program,
                notes: testCase.notes,
                velocity: testCase.velocity,
                durationMs: testCase.durationMs,
            });
            if (!sent) throw new Error('请先在 MIDI 输出面板打开并选择设备');
            schedule(() => {
                setAuditioning(null);
            }, testCase.durationMs + 250);
        } catch (err) {
            console.error('MIDI diagnostic audition failed', err);
            setError(err instanceof Error ? err.message : 'MIDI 复音测试发送失败');
            setAuditioning(null);
        }
    };

    const handleChange = async (event: React.ChangeEvent<HTMLSelectElement>): Promise<void> => {
        const nextId = event.target.value as SoundFontBankId;
        const previousId = getSelectedSoundFontBank().id;
        stopAudition();
        setSelectedId(nextId);
        setPendingId(nextId);
        setError(null);
        try {
            await AudioEngine.setSoundFontBank(nextId);
        } catch (err) {
            console.error('SoundFont switch failed', err);
            setError('加载失败');
            if (previousId !== nextId) {
                try { await AudioEngine.setSoundFontBank(previousId); } catch { /* keep failed state visible */ }
            }
        } finally {
            setPendingId(null);
        }
    };

    /** 全乐器检查切换：旋律乐器同步到自由演奏通道 ch0；鼓组走 ch9 只触发鼓试听。 */
    const handleInstrumentChange = async (event: React.ChangeEvent<HTMLSelectElement>): Promise<void> => {
        const key = event.target.value;
        stopAudition();
        setInstrumentKey(key);
        instrumentKeyRef.current = key;
        const item = selectedInstrumentItems.find(i => auditionKey(i) === key);
        if (!item) return;
        setError(null);
        try {
            await startAudioContext();
            const channel = auditionChannelFor(item);
            selectPresetRaw(channel, item);
            AudioEngine.playNote(channel, item.note, item.role === 'drum' ? 112 : 100, item.role === 'drum' ? 120 : 220);
        } catch (err) {
            console.error('Instrument switch failed', err);
            setError('乐器切换失败');
        }
    };

    const selectedBank = SOUND_FONT_BANKS.find(bank => bank.id === selectedId) ?? SOUND_FONT_BANKS[0];
    const selectedAuditionItems = auditionItemsForBank(selectedId);
    const selectedInstrumentItems = selectedAuditionItems;
    const status =
        pendingId ? '切换中'
            : loadedId === selectedId ? '已加载'
                : '待启动';
    const effectiveInstrumentKey = selectedInstrumentItems.some(item => auditionKey(item) === instrumentKey)
        ? instrumentKey
        : auditionKey(selectedInstrumentItems[0] ?? ALL_INSTRUMENTS[0]);
    useEffect(() => {
        if (instrumentKey === effectiveInstrumentKey) return;
        setInstrumentKey(effectiveInstrumentKey);
        instrumentKeyRef.current = effectiveInstrumentKey;
    }, [effectiveInstrumentKey, instrumentKey]);

    return (
        <div
            className="fixed left-3 top-3 z-[60] w-[min(38rem,calc(100vw_-_1.5rem))] text-zinc-300"
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
        >
            <div
                className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/90 px-3 py-2
                           shadow-[0_8px_30px_rgba(0,0,0,0.55)] backdrop-blur-md"
            >
                <label htmlFor="soundfont-bank-select" className="text-[11px] font-semibold tracking-widest text-zinc-400">
                    MIDI目标
                </label>
                <select
                    id="soundfont-bank-select"
                    value={selectedId}
                    onChange={handleChange}
                    disabled={!!pendingId}
                    title={selectedBank.hint}
                    className="h-7 min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-[11px] text-zinc-100
                               outline-none transition-colors hover:border-zinc-500 focus:border-cyan-400
                               disabled:cursor-wait disabled:opacity-70"
                >
                    {SOUND_FONT_BANKS.map(bank => (
                        <option key={bank.id} value={bank.id}>
                            {bank.label} · {bank.sizeLabel}
                        </option>
                    ))}
                </select>
                <span className={`shrink-0 text-[10px] ${error ? 'text-rose-300' : pendingId ? 'text-cyan-300' : 'text-zinc-500'}`}>
                    {error ?? status}
                </span>
                <button
                    type="button"
                    onClick={() => setAuditionOpen(open => !open)}
                    title="展开音色试听"
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors
                        ${auditionOpen ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-200' : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-100'}`}
                >
                    <Headphones size={14} />
                </button>
            </div>

            <div
                className="mt-1.5 flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/90 px-3 py-2
                           shadow-[0_8px_30px_rgba(0,0,0,0.55)] backdrop-blur-md"
            >
                <label htmlFor="instrument-select" className="shrink-0 text-[11px] font-semibold tracking-widest text-zinc-400">
                    全乐器
                </label>
                <select
                    id="instrument-select"
                    value={effectiveInstrumentKey}
                    onChange={handleInstrumentChange}
                    title={`全量检查 GM128 乐器对齐：${GM128_CATALOG_COUNTS.mainPrograms} GM + ${GM128_CATALOG_COUNTS.variations} variation + ${GM128_CATALOG_COUNTS.drumKits} 鼓组；旋律写入自由演奏 ch0，鼓组走 ch10`}
                    className="h-7 min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-[11px] text-zinc-100
                               outline-none transition-colors hover:border-zinc-500 focus:border-cyan-400"
                >
                    {selectedInstrumentItems.map(item => (
                        <option key={auditionKey(item)} value={auditionKey(item)}>
                            {item.name} · {gm128Display(item)}
                        </option>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={() => {
                        void (async () => {
                            try {
                                await startAudioContext();
                                const item = selectedInstrumentItems.find(i => auditionKey(i) === effectiveInstrumentKey)
                                    ?? selectedInstrumentItems[0]
                                    ?? ALL_INSTRUMENTS[0];
                                const channel = auditionChannelFor(item);
                                selectPresetRaw(channel, item);
                                AudioEngine.playNote(channel, item.note, item.role === 'drum' ? 112 : 100, item.role === 'drum' ? 120 : 220);
                            } catch { /* 静默：音频未就绪时下一次点击再试 */ }
                        })();
                    }}
                    title="试一下当前乐器"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900
                               text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-100"
                >
                    <Play size={12} fill="currentColor" />
                </button>
            </div>

            <div
                className="mt-1.5 flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/90 px-3 py-2
                           shadow-[0_8px_30px_rgba(0,0,0,0.55)] backdrop-blur-md"
            >
                <span className="shrink-0 text-[11px] font-semibold tracking-widest text-zinc-400">
                    硬件输出
                </span>
                <span
                    title="浏览器不再发声；所有音符通过 Web MIDI 发到 Dream 5504 EK。未连接时保持静音。"
                    className={`h-7 min-w-0 flex-1 rounded-md border px-2 py-1.5 text-[11px]
                        ${midiOutState.armed ? 'border-emerald-800 bg-emerald-950/35 text-emerald-100' : 'border-amber-900/70 bg-amber-950/25 text-amber-200'}`}
                >
                    Dream 5504 EK · {midiOutState.armed ? `ON · ${midiOutState.eventCount} events` : '静音'}
                </span>
                <button
                    type="button"
                    onClick={() => midiOutState.armed ? Dream5504MidiOutput.disableOutput() : void Dream5504MidiOutput.enableOutput()}
                    className={`rounded px-2 py-0.5 text-[10px] text-white transition ${midiOutState.armed ? 'bg-rose-700 hover:bg-rose-600' : 'bg-emerald-700 hover:bg-emerald-600'}`}
                    title="打开/关闭 Dream 5504 EK MIDI 输出。详细路由按 Q+M。"
                >
                    {midiOutState.armed ? '关闭' : '开启'}
                </button>
                <button
                    type="button"
                    onClick={() => Dream5504MidiOutput.refreshOutputs()}
                    className="rounded bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-400 transition hover:text-zinc-200"
                    title="刷新 MIDI 输出设备"
                >
                    刷新
                </button>
                <input
                    ref={midiFileRef}
                    type="file"
                    accept=".mid,.midi,audio/midi"
                    className="hidden"
                    onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleMidiFile(f);
                        e.target.value = '';   /* 允许重复选同一文件 */
                    }}
                />
                <button
                    type="button"
                    onClick={() => midiFileRef.current?.click()}
                    className="rounded bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-400 transition hover:text-zinc-200"
                    title="上传 .mid 并通过 Dream 5504 EK 播放；未连接时保持静音并提示。"
                >
                    上传MIDI
                </button>
                {midiUploadPlaying && (
                    <button
                        type="button"
                        onClick={stopUploadedMidi}
                        className="rounded bg-rose-900/60 px-1.5 py-0.5 text-[10px] text-rose-200 transition hover:bg-rose-800/60"
                        title="停止上传曲播放"
                    >
                        ■
                    </button>
                )}
                {midiOutState.silentReason && (
                    <span className="max-w-[20rem] truncate rounded bg-amber-950/40 px-1.5 py-0.5 text-[10px] text-amber-200" title={midiOutState.silentReason}>
                        {midiOutState.silentReason}
                    </span>
                )}
                {midiUploadStatus && (
                    <span className="max-w-[24rem] truncate rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-500" title={midiUploadStatus}>
                        {midiUploadStatus}
                    </span>
                )}
            </div>

            {auditionOpen && (
                <div
                    className="mt-2 max-h-[min(25rem,calc(100vh_-_14.5rem))] overflow-hidden rounded-xl border border-zinc-800
                               bg-zinc-950/94 shadow-[0_14px_36px_rgba(0,0,0,0.6)] backdrop-blur-md"
                >
                    <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
                        <ChevronDown size={14} className="text-cyan-300" />
                        <span className="text-[11px] font-semibold tracking-widest text-zinc-300">试听列表</span>
                        <span className="ml-auto text-[10px] text-zinc-500">
                            {selectedAuditionItems.length} presets · GM {GM128_CATALOG_COUNTS.mainPrograms} / Var {GM128_CATALOG_COUNTS.variations} / Drum {GM128_CATALOG_COUNTS.drumKits}
                        </span>
                        <button
                            type="button"
                            onClick={stopAudition}
                            title="停止试听"
                            className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-100"
                        >
                            <Square size={12} />
                        </button>
                    </div>
                    <div className="max-h-[min(22rem,calc(100vh_-_17rem))] overflow-y-auto p-2">
                        <div className="mb-2 rounded-lg border border-zinc-800 bg-zinc-950/80 p-2">
                            <div className="mb-2 flex items-center justify-between gap-2">
                                <span className="text-[10px] font-semibold tracking-widest text-zinc-400">复音诊断</span>
                                <span className="text-[9px] text-zinc-600">{DIAGNOSTIC_AUDITION_CASES.length} presets</span>
                            </div>
                            <div className="space-y-1.5">
                                {DIAGNOSTIC_AUDITION_CASES.map(testCase => (
                                    <div key={testCase.id} className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-1.5">
                                        <span className="truncate text-[10px] text-zinc-500" title={`${testCase.notes.join('+')} · ${gm128Display(testCase)} · vel ${testCase.velocity}`}>
                                            {testCase.label}
                                        </span>
                                        {DIAGNOSTIC_AUDITION_VARIANTS.map(variant => {
                                            const key = `diag:${testCase.id}:${variant.id}`;
                                            const active = auditioning === key;
                                            return (
                                                <button
                                                    key={variant.id}
                                                    type="button"
                                                    onClick={() => diagnosticAudition(testCase, variant)}
                                                    title={variant.title}
                                                    className={`min-w-0 rounded-md border px-1.5 py-1 text-[10px] transition-colors ${active
                                                        ? 'border-amber-400/70 bg-amber-500/15 text-amber-100'
                                                        : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-600 hover:text-zinc-100'}`}
                                                >
                                                    {variant.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>
                        </div>
                        {selectedAuditionItems.map(item => {
                            const key = auditionKey(item);
                            const active = auditioning === key;
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => audition(item)}
                                    className={`mb-1 grid w-full grid-cols-[1.75rem_4.25rem_minmax(0,1fr)_4.5rem] items-center gap-2 rounded-lg border px-2 py-2 text-left transition-colors last:mb-0
                                        ${active
                                            ? 'border-cyan-400/70 bg-cyan-500/15 text-cyan-100'
                                            : 'border-transparent text-zinc-300 hover:border-zinc-700 hover:bg-white/5'}`}
                                >
                                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-900 text-zinc-400">
                                        <Play size={12} fill="currentColor" />
                                    </span>
                                    <span className="text-[10px] text-zinc-500">{gm128Display(item)}</span>
                                    <span className="min-w-0 truncate text-[12px] font-medium">{item.name}</span>
                                    <span
                                        className="justify-self-end rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400"
                                        title="引用采样大小"
                                    >
                                        {item.sampleSizeLabel}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};
