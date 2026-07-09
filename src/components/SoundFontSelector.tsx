import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Headphones, Play, Square } from 'lucide-react';
import {
    AudioEngine,
    SOUND_FONT_BANKS,
    getLoadedSoundFontBank,
    getSelectedSoundFontBank,
    getSynthBackend,
    startAudioContext,
    subscribeSoundFontBank,
    type SoundFontBankId,
    type SynthBackendKind,
} from '../core/audio/AudioEngine';
import { AURA25_AUDITION_INSTRUMENTS } from '../core/sound/Aura25Palette';

const AUDITION_CHANNEL = 8;
const DRUM_CHANNEL = 9;
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
    const auditionTimers = useRef<number[]>([]);

    useEffect(() => subscribeSoundFontBank(() => {
        setSelectedId(getSelectedSoundFontBank().id);
        setLoadedId(getLoadedSoundFontBank()?.id ?? null);
        setBackend(getSynthBackend());
    }), []);

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
            // 回滚到上一个可用后端（偏好已被持久化为失败目标，须显式切回并重建）
            try { await AudioEngine.setSynthBackend(previous); } catch { /* keep failed state visible */ }
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
            className="fixed left-3 top-3 z-[60] w-[min(32rem,calc(100vw_-_1.5rem))] text-zinc-300"
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
                <label htmlFor="synth-backend-select" className="ml-1 shrink-0 text-[11px] font-semibold tracking-widest text-zinc-400">
                    合成器
                </label>
                <select
                    id="synth-backend-select"
                    value={backend}
                    onChange={handleBackendChange}
                    disabled={backendPending}
                    title="copych = 设备同款引擎（嵌入式镜像参考，默认）；SpessaSynth = 浏览器参考合成器"
                    className="h-7 w-[8.5rem] shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-[11px] text-zinc-100
                               outline-none transition-colors hover:border-zinc-500 focus:border-cyan-400
                               disabled:cursor-wait disabled:opacity-70"
                >
                    <option value="copych">Copych · 设备镜像</option>
                    <option value="spessa">SpessaSynth</option>
                </select>
                <span className={`shrink-0 text-[10px] ${error ? 'text-rose-300' : (pendingId || backendPending) ? 'text-cyan-300' : 'text-zinc-500'}`}>
                    {error ?? (backendPending ? '合成器切换中' : status)}
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

            {auditionOpen && (
                <div
                    className="mt-2 max-h-[min(25rem,calc(100vh_-_5.5rem))] overflow-hidden rounded-xl border border-zinc-800
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
                    <div className="max-h-[min(22rem,calc(100vh_-_8rem))] overflow-y-auto p-2">
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
