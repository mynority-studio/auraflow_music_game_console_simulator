import React, { useEffect, useState } from 'react';
import {
    AudioEngine,
    SOUND_FONT_BANKS,
    getLoadedSoundFontBank,
    getSelectedSoundFontBank,
    subscribeSoundFontBank,
    type SoundFontBankId,
} from '../core/audio/AudioEngine';

export const SoundFontSelector: React.FC = () => {
    const [selectedId, setSelectedId] = useState<SoundFontBankId>(() => getSelectedSoundFontBank().id);
    const [loadedId, setLoadedId] = useState<SoundFontBankId | null>(() => getLoadedSoundFontBank()?.id ?? null);
    const [pendingId, setPendingId] = useState<SoundFontBankId | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => subscribeSoundFontBank(() => {
        setSelectedId(getSelectedSoundFontBank().id);
        setLoadedId(getLoadedSoundFontBank()?.id ?? null);
    }), []);

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

    const selectedBank = SOUND_FONT_BANKS.find(bank => bank.id === selectedId) ?? SOUND_FONT_BANKS[0];
    const status =
        pendingId ? '切换中'
            : loadedId === selectedId ? '已加载'
                : '待启动';

    return (
        <div
            className="fixed left-3 top-3 z-[60] flex items-center gap-2 rounded-xl border border-zinc-800
                       bg-zinc-950/90 px-3 py-2 text-zinc-300 shadow-[0_8px_30px_rgba(0,0,0,0.55)]
                       backdrop-blur-md"
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
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
                className="h-7 w-44 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-[11px] text-zinc-100
                           outline-none transition-colors hover:border-zinc-500 focus:border-cyan-400
                           disabled:cursor-wait disabled:opacity-70"
            >
                {SOUND_FONT_BANKS.map(bank => (
                    <option key={bank.id} value={bank.id}>
                        {bank.label} · {bank.sizeLabel}
                    </option>
                ))}
            </select>
            <span className={`text-[10px] ${error ? 'text-rose-300' : pendingId ? 'text-cyan-300' : 'text-zinc-500'}`}>
                {error ?? status}
            </span>
        </div>
    );
};
