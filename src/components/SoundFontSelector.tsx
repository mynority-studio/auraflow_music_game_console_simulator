import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Headphones, Play, Square } from 'lucide-react';
import {
    AudioEngine,
    SOUND_FONT_BANKS,
    activeSynth,
    getChannelModePref,
    getLoadedSoundFontBank,
    getSampleRatePref,
    getSelectedSoundFontBank,
    SAMPLE_RATE_OPTIONS,
    startAudioContext,
    subscribeSoundFontBank,
    type ChannelModePref,
    type SampleRatePref,
    type SoundFontBankId,
} from '../core/audio/AudioEngine';
import { AURA25_AUDITION_INSTRUMENTS } from '../core/sound/Aura25Palette';
import {
    COPYCH_DEFAULT_MASTER_LIFT,
    COPYCH_MASTER_LIFT_MAX,
    COPYCH_MASTER_LIFT_MIN,
    getCopychFxState,
    subscribeCopychFxState,
    type CopychFxState,
} from '../core/audio/copych/CopychSynthFacade';
import {
    getCopychPostChainMeters,
    getCopychPostChainState,
    subscribeCopychPostChain,
    type CopychPostChainCfg,
    type CopychPostChainMeters,
    type CopychPostChainState,
} from '../core/audio/copych/CopychSynthFacade';
import { setCopychDevicePostChain } from '../core/audio/AudioEngine';
import { parseSMF } from '../core/audio/smfParser';
import { globalMidiScheduler } from '../core/audio/MidiScheduler';

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
    role: 'lead' | 'comp' | 'pad' | 'bass' | 'drum';
    name: string;
    note: number;
    sampleSizeBytes: number;
    sampleSizeLabel: string;
};
type DiagnosticAuditionCase = {
    id: string;
    label: string;
    bank: number;
    program: number;
    notes: readonly number[];
    velocity: number;
    channelVolume: number;
    durationMs: number;
};
type DiagnosticAuditionVariant = {
    id: string;
    label: string;
    title: string;
    cfg: CopychPostChainCfg;
};
const auditionItemsForBank = (_bankId: string): readonly AuditionItem[] => AURA25_AUDITION_INSTRUMENTS;
/** 主键盘可切乐器（当前 SF2 包内旋律乐器；鼓组走 ch9 不在列）。 */
const KEYBOARD_INSTRUMENTS = AURA25_AUDITION_INSTRUMENTS.filter(item => item.role !== 'drum');
/** 初始键盘乐器 = 列表首项（GM 0:0 大钢琴，与合成器 GMReset 默认一致——无需占位"默认"项）。 */
const DEFAULT_INSTRUMENT_KEY = `${KEYBOARD_INSTRUMENTS[0].bank}:${KEYBOARD_INSTRUMENTS[0].program}`;
const NOTE_OFF_CC = 123;
const ELECTRIC_KEY_PROGRAM = 5;
const FOLK_GUITAR_PROGRAM = 25;
const MALLET_PROGRAMS = new Set([12, 107, 108]);
const DRIVE_STATE_LABEL: Record<CopychPostChainMeters['driveState'], string> = {
    'very-quiet': '很小',
    quiet: '偏小',
    healthy: '健康',
    'soft-knee': '软削',
    overdriven: '削多',
    'hard-clipping': '硬夹',
};
const DRIVE_STATE_CLASS: Record<CopychPostChainMeters['driveState'], string> = {
    'very-quiet': 'text-sky-300',
    quiet: 'text-cyan-300',
    healthy: 'text-emerald-300',
    'soft-knee': 'text-amber-300',
    overdriven: 'text-orange-300',
    'hard-clipping': 'text-red-300',
};

const meterDb = (db: number): string => db <= -119 ? '−∞' : db.toFixed(0);
const auditionKey = (item: Pick<AuditionItem, 'bank' | 'program'>): string => `${item.bank}:${item.program}`;
const selectPresetRaw = (channel: number, item: Pick<AuditionItem, 'bank' | 'program'>): void => {
    if (!activeSynth) return;
    const bank = Math.max(0, Math.min(16383, Math.round(item.bank)));
    activeSynth.controllerChange(channel, 0, (bank >> 7) & 0x7f);
    activeSynth.controllerChange(channel, 32, bank & 0x7f);
    activeSynth.programChange(channel, Math.max(0, Math.min(127, Math.round(item.program))));
};
const liftDb = (lift: number): number => 20 * Math.log10(Math.max(0.0001, lift));
const clampMasterLift = (lift: number): number =>
    Math.max(COPYCH_MASTER_LIFT_MIN, Math.min(COPYCH_MASTER_LIFT_MAX, Number.isFinite(lift) ? lift : 1));
const DIAGNOSTIC_AUDITION_CHANNEL = AUDITION_CHANNEL;
const clampMidiNote = (note: number): number => Math.max(0, Math.min(127, Math.round(note)));
const diagnosticNotesFor = (item: AuditionItem): readonly number[] => {
    if (item.role === 'drum') return [36, 38, 42, 46, 49];
    if (item.role === 'bass') return [item.note, item.note + 7, item.note + 12, item.note + 15, item.note + 19].map(clampMidiNote);
    if (item.role === 'pad') return [item.note, item.note + 7, item.note + 12, item.note + 16, item.note + 19].map(clampMidiNote);
    if (item.program === 0 || item.program === ELECTRIC_KEY_PROGRAM || item.program === 108) return [64, 67, 71, 74, 78];
    if (item.program === 24 || item.program === FOLK_GUITAR_PROGRAM) return [item.note, item.note + 5, item.note + 9, item.note + 12, item.note + 16].map(clampMidiNote);
    if (item.program === 67) return [43, 50, 54, 57, 62];
    return [item.note, item.note + 4, item.note + 7, item.note + 11, item.note + 14].map(clampMidiNote);
};
const diagnosticVelocityFor = (item: AuditionItem): number => {
    if (item.role === 'drum') return 94;
    if (item.role === 'pad') return 62;
    if (item.role === 'bass') return 72;
    if (item.program === ELECTRIC_KEY_PROGRAM) return 74;
    if (item.program === 0) return 78;
    return 76;
};
const diagnosticVolumeFor = (item: AuditionItem): number => {
    if (item.role === 'drum') return item.program === 8 ? 48 : 90;
    if (item.role === 'pad') return 78;
    if (item.role === 'bass') return 84;
    if (item.program === 67) return 64;
    if (item.program === 24 || item.program === FOLK_GUITAR_PROGRAM) return 56;
    if (item.program === ELECTRIC_KEY_PROGRAM) return 80;
    return 84;
};
const diagnosticDurationFor = (item: AuditionItem): number => {
    if (item.role === 'drum') return 260;
    if (item.role === 'pad') return 1100;
    if (item.role === 'bass') return 760;
    return 900;
};
const DIAGNOSTIC_AUDITION_CASES: readonly DiagnosticAuditionCase[] = AURA25_AUDITION_INSTRUMENTS.map(item => ({
    id: `${item.bank}-${item.program}-${item.role}`,
    label: `${item.name}${item.role === 'drum' ? ' 五件' : ' 五音'}`,
    bank: item.bank,
    program: item.program,
    notes: diagnosticNotesFor(item),
    velocity: diagnosticVelocityFor(item),
    channelVolume: diagnosticVolumeFor(item),
    durationMs: diagnosticDurationFor(item),
}));
const DIAGNOSTIC_AUDITION_VARIANTS: readonly DiagnosticAuditionVariant[] = [
    {
        id: 'raw',
        label: 'RAW',
        title: '近似 Copych raw：关闭设备增益/EQ/16bit，不额外放大。用于判断源头是否自带滋滋。',
        cfg: { enabled: true, gain: false, eq: false, softclip: true, quantize: false, masterLift: 1 },
    },
    {
        id: 'device',
        label: '设备',
        title: '设备镜像：校准 gain×1.8 + EQ + 软削 + 16bit。',
        cfg: { enabled: true, gain: true, eq: true, softclip: true, quantize: true, masterLift: COPYCH_DEFAULT_MASTER_LIFT },
    },
    {
        id: 'no-gain',
        label: '无增益',
        title: '保留 EQ/软削/16bit，但关闭校准 gain。用于判断是否是设备增益放大了瑕疵。',
        cfg: { enabled: true, gain: false, eq: true, softclip: true, quantize: true, masterLift: COPYCH_DEFAULT_MASTER_LIFT },
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
    const [sampleRate, setSampleRate] = useState<number | null>(null);
    const [ratePref, setRatePref] = useState<SampleRatePref>(() => getSampleRatePref());
    const [channelMode, setChannelModeState] = useState<ChannelModePref>(() => getChannelModePref());
    const [copychFx, setCopychFx] = useState<CopychFxState>(() => getCopychFxState());
    const auditionTimers = useRef<number[]>([]);
    const diagnosticPostChainRestore = useRef<CopychPostChainCfg | null>(null);
    const instrumentKeyRef = useRef<string>(DEFAULT_INSTRUMENT_KEY);   // subscribe 闭包用（避免 stale state）

    /** 只窥探已存在的全局 AudioContext（不提前创建——保持"首次用户操作才建 ctx"的生命周期）；
     *  ctx 未建时徽标显 "— kHz"，首次 startAudioContext 后经 subscribe 回调刷新。 */
    const readSampleRate = (): void => {
        try {
            const ctx = (window as unknown as { globalAudioContext?: AudioContext }).globalAudioContext;
            setSampleRate(ctx ? ctx.sampleRate : null);   // 无 ctx（采样率重建中）→ 清空防陈旧率残显
        } catch { /* 非浏览器/受限环境 */ }
    };

    useEffect(() => subscribeCopychFxState(() => setCopychFx(getCopychFxState())), []);
    /* 上传 MIDI 播放（上传播放批）：file input ref + 状态行；播放走 AudioEngine.playUploadedMidi
     * =与生成曲同一 Copych 调度路径（设备后链可叠加）。 */
    const midiFileRef = useRef<HTMLInputElement>(null);
    const [midiUploadStatus, setMidiUploadStatus] = useState<string | null>(null);
    const [midiUploadPlaying, setMidiUploadPlaying] = useState(false);
    const handleMidiFile = async (file: File) => {
        /* 上传语义=「替换当前播放」（codex P2）：选文件即先停旧播放并复位 UI——
         * 失败路径由此不会出现「旧曲还响但停止钮消失」的状态分叉。 */
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
    const [pcState, setPcState] = useState<CopychPostChainState>(() => getCopychPostChainState());
    const [pcMeters, setPcMeters] = useState<CopychPostChainMeters | null>(() => getCopychPostChainMeters());
    useEffect(() => subscribeCopychPostChain(() => {
        setPcState(getCopychPostChainState());
        setPcMeters(getCopychPostChainMeters());
    }), []);

    useEffect(() => {
        readSampleRate();
        return subscribeSoundFontBank(() => {
            setSelectedId(getSelectedSoundFontBank().id);
            setLoadedId(getLoadedSoundFontBank()?.id ?? null);
            setRatePref(getSampleRatePref());
            setChannelModeState(getChannelModePref());
            readSampleRate();
            // 合成器实例重建（bank/采样率切换）会回 GM 默认——重发主键盘乐器选择（不发确认音）
            const key = instrumentKeyRef.current;
            if (key) {
                const items = auditionItemsForBank(getSelectedSoundFontBank().id);
                const item = items.find(i => auditionKey(i) === key) ?? items.find(i => i.role !== 'drum');
                if (item) selectPresetRaw(KEYBOARD_CHANNEL, item);
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

    const restoreDiagnosticPostChain = (): void => {
        const cfg = diagnosticPostChainRestore.current;
        if (!cfg) return;
        diagnosticPostChainRestore.current = null;
        setCopychDevicePostChain(cfg);
    };

    const stopAudition = (): void => {
        clearAuditionTimers();
        AudioEngine.controllerChange(AUDITION_CHANNEL, NOTE_OFF_CC, 0);
        AudioEngine.controllerChange(AUDITION_CHANNEL, 72, 64);
        AudioEngine.controllerChange(AUDITION_CHANNEL, 74, 64);
        AudioEngine.controllerChange(AUDITION_CHANNEL, 95, 0);
        AudioEngine.controllerChange(DRUM_CHANNEL, NOTE_OFF_CC, 0);
        restoreDiagnosticPostChain();
        setAuditioning(null);
    };

    const melodicPhrase = (item: AuditionItem): void => {
        const root = item.note;
        const electricKey = item.program === ELECTRIC_KEY_PROGRAM;
        const notes = item.program === 67
            ? [root, root + 2, root + 5, root + 7]
            : item.program === 32 || item.program === 38
                ? [root, root + 7, root + 12, root + 7]
                : item.role === 'pad'
                    ? [root, root + 7, root + 12]
                    : [root, root + 4, root + 7, root + 12];
        const dur = item.role === 'pad' ? 760 : item.program === 67 ? 420 : electricKey ? 360 : 260;
        const isGuitar = item.program === 24 || item.program === FOLK_GUITAR_PROGRAM;
        const velocity = item.role === 'pad' ? 76 : electricKey || item.program === 67 || isGuitar ? 84 : 96;
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
            activeSynth?.controllerChange(channel, 7, diagnosticVolumeFor(item));
            activeSynth?.controllerChange(channel, 10, 64);
            activeSynth?.controllerChange(channel, 11, 127);
            activeSynth?.controllerChange(channel, 72, item.program === ELECTRIC_KEY_PROGRAM ? 68 : 64);
            activeSynth?.controllerChange(channel, 74, item.program === ELECTRIC_KEY_PROGRAM ? 54 : 64);
            activeSynth?.controllerChange(channel, 91, item.role === 'pad' ? 58 : item.program === ELECTRIC_KEY_PROGRAM ? 28 : item.program === FOLK_GUITAR_PROGRAM ? 38 : 30);
            activeSynth?.controllerChange(channel, 93, item.program === ELECTRIC_KEY_PROGRAM ? 20 : MALLET_PROGRAMS.has(item.program) ? 0 : 12);
            activeSynth?.controllerChange(channel, 95, 0);
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
            await startAudioContext();
            diagnosticPostChainRestore.current = { ...getCopychPostChainState().cfg };
            setCopychDevicePostChain(variant.cfg);
            const channel = testCase.bank === 128 ? DRUM_CHANNEL : DIAGNOSTIC_AUDITION_CHANNEL;
            activeSynth?.controllerChange(channel, NOTE_OFF_CC, 0);
            activeSynth?.controllerChange(channel, 7, testCase.channelVolume);
            activeSynth?.controllerChange(channel, 10, 64);
            activeSynth?.controllerChange(channel, 11, 127);
            activeSynth?.controllerChange(channel, 64, 0);
            activeSynth?.controllerChange(channel, 72, 64);
            activeSynth?.controllerChange(channel, 74, 64);
            activeSynth?.controllerChange(channel, 91, 0);
            activeSynth?.controllerChange(channel, 93, 0);
            activeSynth?.controllerChange(channel, 95, 0);
            selectPresetRaw(channel, testCase);
            for (const note of testCase.notes) {
                AudioEngine.noteOn(channel, note, testCase.velocity);
            }
            schedule(() => {
                for (const note of testCase.notes) AudioEngine.noteOff(channel, note);
            }, testCase.durationMs);
            schedule(() => {
                restoreDiagnosticPostChain();
                setAuditioning(null);
            }, testCase.durationMs + 450);
        } catch (err) {
            console.error('Copych diagnostic audition failed', err);
            restoreDiagnosticPostChain();
            setError('诊断试听失败');
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

    /** 主键盘乐器切换：对自由演奏通道（ch0——AuraJam/AuraBar 键盘按键所在通道，镜像设备
     *  "左旋钮切自由演奏乐器"）programChange，选中即生效，随后点键盘即新音色；
     *  附一记确认单音让切换立即可听。鼓组不在列（ch0 为旋律通道）。 */
    const handleInstrumentChange = async (event: React.ChangeEvent<HTMLSelectElement>): Promise<void> => {
        const key = event.target.value;
        setInstrumentKey(key);
        instrumentKeyRef.current = key;
        const item = selectedKeyboardInstruments.find(i => auditionKey(i) === key);
        if (!item) return;
        setError(null);
        try {
            await startAudioContext();
            selectPresetRaw(KEYBOARD_CHANNEL, item);
            AudioEngine.playNote(KEYBOARD_CHANNEL, item.note, 100, 220);   // 确认音
        } catch (err) {
            console.error('Keyboard instrument switch failed', err);
            setError('乐器切换失败');
        }
    };

    /** 采样率偏好切换：关旧 ctx 建新 + 重建合成器（先停播放）；失败回滚 previous 并强制重建。 */
    const handleRateChange = async (event: React.ChangeEvent<HTMLSelectElement>): Promise<void> => {
        const next = Number(event.target.value) as SampleRatePref;
        const previous = getSampleRatePref();
        if (next === previous) return;
        stopAudition();
        setRatePref(next);
        setError(null);
        try {
            await AudioEngine.setAudioSampleRate(next);
        } catch (err) {
            console.error('Sample rate switch failed', err);
            setError('采样率切换失败');
            try { await AudioEngine.setAudioSampleRate(previous, true); } catch { /* keep failed state visible */ }
            setRatePref(getSampleRatePref());
        }
    };

    /** 声道模式切换：末端下混开关，即时生效不打断播放。 */
    const handleChannelModeChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
        const mode = event.target.value as ChannelModePref;
        AudioEngine.setChannelMode(mode);
        setChannelModeState(mode);
    };

    const selectedBank = SOUND_FONT_BANKS.find(bank => bank.id === selectedId) ?? SOUND_FONT_BANKS[0];
    const selectedAuditionItems = auditionItemsForBank(selectedId);
    const selectedKeyboardInstruments = selectedAuditionItems.filter(item => item.role !== 'drum');
    const status =
        pendingId ? '切换中'
            : loadedId === selectedId ? '已加载'
                : '待启动';
    const effectiveInstrumentKey = selectedKeyboardInstruments.some(item => auditionKey(item) === instrumentKey)
        ? instrumentKey
        : auditionKey(selectedKeyboardInstruments[0] ?? KEYBOARD_INSTRUMENTS[0]);
    const masterLift = clampMasterLift(pcState.cfg.masterLift || 1);
    const masterLiftDb = liftDb(masterLift);
    const masterLiftLabel = `×${masterLift.toFixed(2)}`;
    const masterLiftTitle = `${masterLiftLabel} (${masterLiftDb >= 0 ? '+' : ''}${masterLiftDb.toFixed(1)}dB)`;

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
                    音色包
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
                    键盘乐器
                </label>
                <select
                    id="instrument-select"
                    value={effectiveInstrumentKey}
                    onChange={handleInstrumentChange}
                    title="切换主键盘（AuraJam/AuraBar 按键，自由演奏 ch0）的乐器——选中即 programChange 生效，点键盘就是新音色（镜像设备左旋钮切乐器）"
                    className="h-7 min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-[11px] text-zinc-100
                               outline-none transition-colors hover:border-zinc-500 focus:border-cyan-400"
                >
                    {selectedKeyboardInstruments.map(item => (
                        <option key={auditionKey(item)} value={auditionKey(item)}>
                            {item.name} · GM {item.bank}:{item.program}
                        </option>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={() => {
                        void (async () => {
                            try {
                                await startAudioContext();
                                const item = selectedKeyboardInstruments.find(i => auditionKey(i) === effectiveInstrumentKey)
                                    ?? selectedKeyboardInstruments[0]
                                    ?? KEYBOARD_INSTRUMENTS[0];
                                selectPresetRaw(KEYBOARD_CHANNEL, item);
                                AudioEngine.playNote(KEYBOARD_CHANNEL, item.note, 100, 220);
                            } catch { /* 静默：音频未就绪时下一次点击再试 */ }
                        })();
                    }}
                    title="试一下当前键盘音色（单音）"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900
                               text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-100"
                >
                    <Play size={12} fill="currentColor" />
                </button>
            </div>

            <div
                className="mt-1.5 flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/90 px-3 py-2
                           shadow-[0_8px_30px_rgba(0,0,0,0.55)] backdrop-blur-md"
            >
                <span className="shrink-0 text-[11px] font-semibold tracking-widest text-zinc-400">
                    合成器
                </span>
                <span
                    title="Copych 是唯一合成/混音方案：浏览器预览与 ESP32 设备口径统一"
                    className="h-7 min-w-0 flex-1 rounded-md border border-cyan-900/70 bg-cyan-950/35 px-2 py-1.5 text-[11px] text-cyan-100"
                >
                    Copych · 设备镜像
                </span>
                <label htmlFor="channel-mode-select" className="ml-1 shrink-0 text-[11px] font-semibold tracking-widest text-zinc-400">
                    声道
                </label>
                <select
                    id="channel-mode-select"
                    value={channelMode}
                    onChange={handleChannelModeChange}
                    title="输出声道模式（即时生效）。Copych 引擎原生单声道（双声道载体 L=R=双单声道），直通/下混听感相同"
                    className="h-7 w-[6.5rem] shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-[11px] text-zinc-100
                               outline-none transition-colors hover:border-zinc-500 focus:border-cyan-400"
                >
                    <option value="stereo">立体声·直通</option>
                    <option value="mono">单声道·下混</option>
                </select>
                <label htmlFor="sample-rate-select" className="ml-1 shrink-0 text-[11px] font-semibold tracking-widest text-zinc-400">
                    采样率
                </label>
                <select
                    id="sample-rate-select"
                    value={String(ratePref)}
                    onChange={handleRateChange}
                    disabled
                    title="采样率锁定为 24 kHz：当前 SF2 样本已统一锁到 24k，Copych/ESP32 正式口径必须按样本原生采样率播放"
                    className="h-7 w-[7rem] shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-[11px] text-zinc-100
                               outline-none transition-colors hover:border-zinc-500 focus:border-cyan-400
                               disabled:cursor-not-allowed disabled:opacity-80"
                >
                    {SAMPLE_RATE_OPTIONS.map(rate => (
                        <option key={rate} value={String(rate)}>
                            {(rate / 1000) % 1 === 0 ? (rate / 1000).toFixed(0) : (rate / 1000).toFixed(2)} kHz
                        </option>
                    ))}
                </select>
                <span
                    className="shrink-0 rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400"
                    title="当前实际生效的 AudioContext.sampleRate（首次出声后显示）"
                >
                    {sampleRate ? `${(sampleRate / 1000) % 1 === 0 ? (sampleRate / 1000).toFixed(0) : (sampleRate / 1000).toFixed(2)} kHz` : '—'}
                </span>
                <span className="mx-0.5 h-3 w-px bg-zinc-800" />
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
                    title="上传 .mid 用当前合成器播放（SMF format 0/1；多段变速取首段；与生成曲同一播放路径，copych 设备后链可叠加）"
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
                {midiUploadStatus && (
                    <span className="max-w-[24rem] truncate rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-500" title={midiUploadStatus}>
                        {midiUploadStatus}
                    </span>
                )}
            </div>

            <div
                className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-950/90 px-3 py-2
                           shadow-[0_8px_30px_rgba(0,0,0,0.55)] backdrop-blur-md"
            >
                <span
                    className="shrink-0 text-[11px] font-semibold tracking-widest text-zinc-400"
                    title="当前 Copych 效果器与参数（镜像设备 FxReverb/FxChorus/FxDelay）：boot=固件手调默认，播放整曲时按风格下发 per-song 空间参数（等价设备 AR_CMD_SONG_*）"
                >
                    效果器
                </span>
                <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400"
                      title="freeverb：time 空间大小(0..1)/level 湿电平/predelay 预延迟/damp 高频阻尼">
                    混响 t{copychFx.reverb.time.toFixed(2)} · L{copychFx.reverb.level.toFixed(2)} · pd{Math.round(copychFx.reverb.predelayMs)}ms · 衰{copychFx.reverb.damping.toFixed(2)}
                </span>
                <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400"
                      title="chorus：LFO 频率/调制深度/基础延迟">
                    合唱 {copychFx.chorus.lfoHz.toFixed(1)}Hz · 深{(copychFx.chorus.depthS * 1000).toFixed(1)}ms · 基{Math.round(copychFx.chorus.baseDelayS * 1000)}ms
                </span>
                <span className={`rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] ${copychFx.delay.enabled ? 'text-zinc-400' : 'text-zinc-600'}`}
                      title="delay（CC95 send 总线）：per-song 按风格开启（拍数×BPM 换算），未开启时静默">
                    {copychFx.delay.enabled
                        ? `延迟 ${Math.round(copychFx.delay.seconds * 1000)}ms · fb${copychFx.delay.feedback.toFixed(2)}`
                        : '延迟 关'}
                </span>
            </div>

            <div
                    className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-950/90 px-3 py-2
                               shadow-[0_8px_30px_rgba(0,0,0,0.55)] backdrop-blur-md"
                >
                    <span
                        className="shrink-0 text-[11px] font-semibold tracking-widest text-zinc-400"
                        title={'固件输出后链镜像（校准增益×1.8 → Copych 软/硬削波 → 单声道折叠 → 6 段小喇叭校正 EQ → 终级饱和 → 16bit）。'
                            + '这是 Copych-only 正式输出的常驻阶段；增益/削波/下混全采样率有效，6 段 EQ 仅 24kHz ctx 有效（系数绑 24k）。'
                            + '各级开关对应设备真实态：增益 off≡ne gain 100 / EQ off≡ne eq off / 软削 off≡ne clip hard；16bit off=纯 float 链（仅诊断，非设备路径）'}
                    >
                        设备后链
                    </span>
                    <span
                        className={`rounded px-2 py-0.5 text-[10px] transition ${pcState.active
                            ? 'bg-cyan-900/70 text-cyan-200'
                            : 'bg-zinc-900 text-zinc-500'}`}
                        title={pcState.reason ?? '常驻：Copych raw synth 不作为正式试听路径，必须进入设备后链'}
                    >
                        {pcState.active ? '常驻' : '待启动'}
                    </span>
                    {(['gain', 'eq', 'softclip', 'quantize'] as const).map(k => (
                        <button
                            key={k}
                            type="button"
                            disabled={!pcState.active}
                            onClick={() => setCopychDevicePostChain({ [k]: !pcState.cfg[k] })}
                            className={`rounded px-1.5 py-0.5 text-[10px] transition ${!pcState.active
                                ? 'cursor-not-allowed bg-zinc-900 text-zinc-700'
                                : pcState.cfg[k]
                                    ? 'bg-zinc-800 text-zinc-200'
                                    : 'bg-zinc-900 text-zinc-500 line-through'}`}
                            title={{
                                gain: '×1.8（off≡板上 ne gain 100）',
                                eq: '6 段小喇叭校正 EQ（off≡板上 ne eq off）',
                                softclip: 'Copych 软削波（off=硬削≡板上 ne clip hard）',
                                quantize: '16bit 整数格（off=纯 float 链，仅诊断非设备路径）',
                            }[k]}
                        >
                            {{ gain: '校准增益', eq: 'EQ', softclip: '软削', quantize: '16bit' }[k]}
                        </button>
                    ))}
                    <button
                        type="button"
                        onClick={() => setCopychDevicePostChain({ gain: true, eq: true, softclip: true, quantize: true })}
                        className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200"
                        title="一键=固件默认态全开（gain+EQ+软削+16bit）"
                    >
                        镜像预设
                    </button>
                    <span className="mx-0.5 h-3 w-px bg-zinc-800" />
                    <label htmlFor="copych-master-volume" className="text-[10px] text-zinc-500" title="用户主音量：调 masterLift，位于 softclip/EQ/clamp 保护链之前">主音量</label>
                    <input
                        id="copych-master-volume"
                        type="range"
                        min={COPYCH_MASTER_LIFT_MIN}
                        max={COPYCH_MASTER_LIFT_MAX}
                        step={0.05}
                        value={masterLift}
                        disabled={!pcState.active}
                        onChange={(event) => setCopychDevicePostChain({ masterLift: Number(event.target.value) })}
                        className="h-2 w-28 accent-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
                        title={`主音量 ${masterLiftTitle}`}
                    />
                    <span className="min-w-[4.5rem] text-center text-[10px] text-zinc-400" title={`${masterLiftDb >= 0 ? '+' : ''}${masterLiftDb.toFixed(1)}dB`}>
                        {masterLiftLabel}
                    </span>
                    <button
                        type="button"
                        disabled={!pcState.active || Math.abs(masterLift - COPYCH_DEFAULT_MASTER_LIFT) < 0.001}
                        onClick={() => setCopychDevicePostChain({ masterLift: COPYCH_DEFAULT_MASTER_LIFT })}
                        className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200 disabled:cursor-not-allowed disabled:text-zinc-700"
                        title={`主音量回到默认 ×${COPYCH_DEFAULT_MASTER_LIFT.toFixed(2)}`}
                    >
                        默认
                    </button>
                    {pcState.active && pcMeters && (
                        <span
                            className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-500"
                            title={`后链输出电平。余量 ${pcMeters.headroomDb.toFixed(1)}dB · crest ${pcMeters.crestDb.toFixed(1)}dB · 削=Copych 软削 knee 命中率；夹=终级 hard clamp 命中率。dBFS`}
                        >
                            <span className={DRIVE_STATE_CLASS[pcMeters.driveState]}>{DRIVE_STATE_LABEL[pcMeters.driveState]}</span>
                            {' · 电平 '}{meterDb(pcMeters.preRmsDb)}/{meterDb(pcMeters.prePeakDb)}
                            {' · 削 '}{(pcMeters.softKneeRate * 100).toFixed(2)}%
                            {' · 夹 '}{(pcMeters.hardClipRate * 100).toFixed(3)}%
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
                        <span className="ml-auto text-[10px] text-zinc-500">{selectedAuditionItems.length} presets</span>
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
                                    <div key={testCase.id} className="grid grid-cols-[7.25rem_repeat(3,minmax(0,1fr))] items-center gap-1.5">
                                        <span className="truncate text-[10px] text-zinc-500" title={`${testCase.notes.join('+')} · GM ${testCase.bank}:${testCase.program} · CC7 ${testCase.channelVolume} · vel ${testCase.velocity}`}>
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
                                    <span className="text-[10px] text-zinc-500">GM {item.bank}:{item.program}</span>
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
