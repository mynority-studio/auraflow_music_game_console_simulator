import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Headphones, Play, Square } from 'lucide-react';
import {
    AudioEngine,
    SOUND_FONT_BANKS,
    getChannelModePref,
    getLoadedSoundFontBank,
    getSampleRatePref,
    getSelectedSoundFontBank,
    getSynthBackend,
    SAMPLE_RATE_OPTIONS,
    startAudioContext,
    subscribeSoundFontBank,
    type ChannelModePref,
    type SampleRatePref,
    type SoundFontBankId,
    type SynthBackendKind,
} from '../core/audio/AudioEngine';
import { AURA25_AUDITION_INSTRUMENTS } from '../core/sound/Aura25Palette';

const AUDITION_CHANNEL = 8;
const DRUM_CHANNEL = 9;
/** 主键盘（AuraJam/AuraBar 按键）所在的自由演奏通道——镜像设备 ch0。 */
const KEYBOARD_CHANNEL = 0;
/** 主键盘可切乐器（当前 SF2 包内旋律乐器；鼓组走 ch9 不在列）。 */
const KEYBOARD_INSTRUMENTS = AURA25_AUDITION_INSTRUMENTS.filter(item => item.role !== 'drum');
const NOTE_OFF_CC = 123;
const CITYPOP_FM_EP_PROGRAM = 5;
const FOLK_GUITAR_PROGRAM = 25;
const MALLET_PROGRAMS = new Set([11, 12, 107, 108]);

type AuditionItem = typeof AURA25_AUDITION_INSTRUMENTS[number];

export const SoundFontSelector: React.FC = () => {
    const [selectedId, setSelectedId] = useState<SoundFontBankId>(() => getSelectedSoundFontBank().id);
    const [loadedId, setLoadedId] = useState<SoundFontBankId | null>(() => getLoadedSoundFontBank()?.id ?? null);
    const [pendingId, setPendingId] = useState<SoundFontBankId | null>(null);
    const [backend, setBackend] = useState<SynthBackendKind>(() => getSynthBackend());
    const [backendPending, setBackendPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [auditionOpen, setAuditionOpen] = useState(false);
    const [auditioning, setAuditioning] = useState<string | null>(null);
    const [instrumentKey, setInstrumentKey] = useState<string>('');
    const [sampleRate, setSampleRate] = useState<number | null>(null);
    const [ratePref, setRatePref] = useState<SampleRatePref>(() => getSampleRatePref());
    const [ratePending, setRatePending] = useState(false);
    const [channelMode, setChannelModeState] = useState<ChannelModePref>(() => getChannelModePref());
    const auditionTimers = useRef<number[]>([]);
    const instrumentKeyRef = useRef<string>('');   // subscribe 闭包用（避免 stale state）

    /** 只窥探已存在的全局 AudioContext（不提前创建——保持"首次用户操作才建 ctx"的生命周期）；
     *  ctx 未建时徽标显 "— kHz"，首次 startAudioContext 后经 subscribe 回调刷新。 */
    const readSampleRate = (): void => {
        try {
            const ctx = (window as unknown as { globalAudioContext?: AudioContext }).globalAudioContext;
            setSampleRate(ctx ? ctx.sampleRate : null);   // 无 ctx（切后端关旧未建新）→ 清空防陈旧率残显
        } catch { /* 非浏览器/受限环境 */ }
    };

    useEffect(() => {
        readSampleRate();
        return subscribeSoundFontBank(() => {
            setSelectedId(getSelectedSoundFontBank().id);
            setLoadedId(getLoadedSoundFontBank()?.id ?? null);
            setBackend(getSynthBackend());
            setRatePref(getSampleRatePref());
            setChannelModeState(getChannelModePref());
            readSampleRate();
            // 合成器实例重建（bank/backend 切换）会回 GM 默认——重发主键盘乐器选择（不发确认音）
            const key = instrumentKeyRef.current;
            if (key) {
                const item = KEYBOARD_INSTRUMENTS.find(i => `${i.bank}:${i.program}` === key);
                if (item) AudioEngine.programChange(KEYBOARD_CHANNEL, item.program);
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
        AudioEngine.controllerChange(AUDITION_CHANNEL, 72, 64);
        AudioEngine.controllerChange(AUDITION_CHANNEL, 74, 64);
        AudioEngine.controllerChange(AUDITION_CHANNEL, 95, 0);
        AudioEngine.controllerChange(DRUM_CHANNEL, NOTE_OFF_CC, 0);
        setAuditioning(null);
    };

    const melodicPhrase = (item: AuditionItem): void => {
        const root = item.note;
        const cityPopEp = item.program === CITYPOP_FM_EP_PROGRAM;
        const notes = item.program === 67
            ? [root, root + 2, root + 5, root + 7]
            : item.program === 32 || item.program === 38
                ? [root, root + 7, root + 12, root + 7]
                : item.role === 'pad'
                    ? [root, root + 7, root + 12]
                    : [root, root + 4, root + 7, root + 12];
        const dur = item.role === 'pad' ? 760 : item.program === 67 ? 420 : cityPopEp ? 360 : 260;
        const velocity = item.role === 'pad' ? 76 : cityPopEp ? 84 : 104;
        notes.forEach((note, index) => {
            const at = index * (dur + 45);
            schedule(() => AudioEngine.playNote(AUDITION_CHANNEL, note, velocity, dur), at);
            if (cityPopEp) {
                schedule(() => AudioEngine.playNote(AUDITION_CHANNEL, note, 28, Math.round(dur * 0.86)), at + 340);
                schedule(() => AudioEngine.playNote(AUDITION_CHANNEL, note, 15, Math.round(dur * 0.68)), at + 640);
            }
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
        const key = `${item.bank}:${item.program}`;
        stopAudition();
        setAuditioning(key);
        setError(null);
        try {
            await startAudioContext();
            const channel = item.role === 'drum' ? DRUM_CHANNEL : AUDITION_CHANNEL;
            AudioEngine.controllerChange(channel, 7, item.role === 'drum' ? 108 : 104);
            AudioEngine.controllerChange(channel, 10, 64);
            AudioEngine.controllerChange(channel, 11, 127);
            AudioEngine.controllerChange(channel, 72, item.program === CITYPOP_FM_EP_PROGRAM ? 96 : 64);
            AudioEngine.controllerChange(channel, 74, item.program === CITYPOP_FM_EP_PROGRAM ? 54 : 64);
            AudioEngine.controllerChange(channel, 91, item.role === 'pad' ? 58 : item.program === CITYPOP_FM_EP_PROGRAM ? 66 : item.program === FOLK_GUITAR_PROGRAM ? 38 : 30);
            AudioEngine.controllerChange(channel, 93, item.program === CITYPOP_FM_EP_PROGRAM ? 86 : MALLET_PROGRAMS.has(item.program) ? 0 : 12);
            AudioEngine.controllerChange(channel, 95, 0);
            AudioEngine.programChange(channel, item.program);
            if (item.role === 'drum') drumPhrase();
            else melodicPhrase(item);
            schedule(() => setAuditioning(null), item.role === 'drum' ? 1060 : item.role === 'pad' ? 2500 : 1500);
        } catch (err) {
            console.error('SoundFont audition failed', err);
            setError('试听失败');
            setAuditioning(null);
        }
    };

    const handleChange = async (event: React.ChangeEvent<HTMLSelectElement>): Promise<void> => {
        const nextId = event.target.value as SoundFontBankId;
        const previousId = getSelectedSoundFontBank().id;
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
        const item = key ? KEYBOARD_INSTRUMENTS.find(i => `${i.bank}:${i.program}` === key) : null;
        if (key && !item) return;
        setError(null);
        try {
            await startAudioContext();
            const program = item ? item.program : 0;   // 空选项=切回默认 GM0 大钢琴（真发，可回退）
            AudioEngine.programChange(KEYBOARD_CHANNEL, program);
            AudioEngine.playNote(KEYBOARD_CHANNEL, item?.note ?? 60, 100, 220);   // 确认音
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
        setRatePending(true);
        setError(null);
        try {
            await AudioEngine.setAudioSampleRate(next);
        } catch (err) {
            console.error('Sample rate switch failed', err);
            setError('采样率切换失败');
            try { await AudioEngine.setAudioSampleRate(previous, true); } catch { /* keep failed state visible */ }
            setRatePref(getSampleRatePref());
        } finally {
            setRatePending(false);
        }
    };

    /** 声道模式切换：末端下混开关，即时生效不打断播放。 */
    const handleChannelModeChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
        const mode = event.target.value as ChannelModePref;
        AudioEngine.setChannelMode(mode);
        setChannelModeState(mode);
    };

    /** 合成器后端切换（copych=设备镜像 默认 / spessa=浏览器参考）。切换会停当前播放并重建合成器。 */
    const handleBackendChange = async (event: React.ChangeEvent<HTMLSelectElement>): Promise<void> => {
        const next = event.target.value as SynthBackendKind;
        const previous = getSynthBackend();
        if (next === previous) return;
        stopAudition();
        setBackend(next);
        setBackendPending(true);
        setError(null);
        try {
            await AudioEngine.setSynthBackend(next);
        } catch (err) {
            console.error('Synth backend switch failed', err);
            setError('合成器切换失败');
            // 回滚到上一个可用后端（偏好已被持久化为失败目标，须显式切回并强制重建——
            // 失败时旧实例已拆、三个"在场"判据全空，不 force 只会改偏好不重建）
            try { await AudioEngine.setSynthBackend(previous, true); } catch { /* keep failed state visible */ }
            setBackend(getSynthBackend());
        } finally {
            setBackendPending(false);
        }
    };

    const selectedBank = SOUND_FONT_BANKS.find(bank => bank.id === selectedId) ?? SOUND_FONT_BANKS[0];
    const status =
        pendingId ? '切换中'
            : loadedId === selectedId ? '已加载'
                : '待启动';

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
                    value={instrumentKey}
                    onChange={handleInstrumentChange}
                    title="切换主键盘（AuraJam/AuraBar 按键，自由演奏 ch0）的乐器——选中即 programChange 生效，点键盘就是新音色（镜像设备左旋钮切乐器）"
                    className="h-7 min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-[11px] text-zinc-100
                               outline-none transition-colors hover:border-zinc-500 focus:border-cyan-400"
                >
                    <option value="">默认（GM0 大钢琴）</option>
                    {KEYBOARD_INSTRUMENTS.map(item => (
                        <option key={`${item.bank}:${item.program}`} value={`${item.bank}:${item.program}`}>
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
                                const item = KEYBOARD_INSTRUMENTS.find(i => `${i.bank}:${i.program}` === instrumentKey);
                                /* 默认态（未选择）= GM0 大钢琴，同样可试听 */
                                AudioEngine.programChange(KEYBOARD_CHANNEL, item ? item.program : 0);
                                AudioEngine.playNote(KEYBOARD_CHANNEL, item?.note ?? 60, 100, 220);
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
                <label htmlFor="synth-backend-select" className="shrink-0 text-[11px] font-semibold tracking-widest text-zinc-400">
                    合成器
                </label>
                <select
                    id="synth-backend-select"
                    value={backend}
                    onChange={handleBackendChange}
                    disabled={backendPending || ratePending}
                    title="copych = 设备同款引擎（嵌入式镜像参考，默认，24 kHz 设备口径）；SpessaSynth = 浏览器参考合成器（采样率按下拉设置）"
                    className="h-7 min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-[11px] text-zinc-100
                               outline-none transition-colors hover:border-zinc-500 focus:border-cyan-400
                               disabled:cursor-wait disabled:opacity-70"
                >
                    <option value="copych">Copych · 设备镜像</option>
                    <option value="spessa">SpessaSynth</option>
                </select>
                {(backendPending || ratePending) && (
                    <span className="shrink-0 text-[10px] text-cyan-300">切换中</span>
                )}
                <label htmlFor="channel-mode-select" className="ml-1 shrink-0 text-[11px] font-semibold tracking-widest text-zinc-400">
                    声道
                </label>
                <select
                    id="channel-mode-select"
                    value={channelMode}
                    onChange={handleChannelModeChange}
                    title={backend === 'copych'
                        ? '输出声道模式（即时生效）。copych 引擎原生单声道（双声道载体 L=R=双单声道），直通/下混听感相同'
                        : '输出声道模式（即时生效）。spessa 原生立体声；选单声道=末端下混——与 copych A/B 时消除声场差，引擎对比更公平'}
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
                    disabled={ratePending || backendPending}
                    title="输出采样率（AudioContext 固有属性，切换会重建音频管线）。默认 24 kHz=设备口径（24k SF2 零重采样），两后端通用"
                    className="h-7 w-[7rem] shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-[11px] text-zinc-100
                               outline-none transition-colors hover:border-zinc-500 focus:border-cyan-400
                               disabled:cursor-wait disabled:opacity-70"
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
            </div>

            {auditionOpen && (
                <div
                    className="mt-2 max-h-[min(25rem,calc(100vh_-_11.5rem))] overflow-hidden rounded-xl border border-zinc-800
                               bg-zinc-950/94 shadow-[0_14px_36px_rgba(0,0,0,0.6)] backdrop-blur-md"
                >
                    <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
                        <ChevronDown size={14} className="text-cyan-300" />
                        <span className="text-[11px] font-semibold tracking-widest text-zinc-300">试听列表</span>
                        <span className="ml-auto text-[10px] text-zinc-500">{AURA25_AUDITION_INSTRUMENTS.length} presets</span>
                        <button
                            type="button"
                            onClick={stopAudition}
                            title="停止试听"
                            className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-100"
                        >
                            <Square size={12} />
                        </button>
                    </div>
                    <div className="max-h-[min(22rem,calc(100vh_-_14rem))] overflow-y-auto p-2">
                        {AURA25_AUDITION_INSTRUMENTS.map(item => {
                            const key = `${item.bank}:${item.program}`;
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
