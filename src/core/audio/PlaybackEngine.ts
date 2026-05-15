/**
 * PlaybackEngine — ArrangedTrack 装载与播控（Phase 4 重构版）
 *
 * 职责切分：
 *   - 本类只负责 **partChannels 注册** + **调度器装载** + **播控（play/stop）**
 *   - MIDI 事件渲染下放给 MidiConverter（pipeline rule §2.9）
 *
 * 调用链：
 *   AudioEngine.playSong
 *     ↓
 *   Orchestrator.arrange(track, styleId, context)   // RELATIVE → ABSOLUTE（K-2）
 *     ↓
 *   PlaybackEngine.loadSong(arranged)
 *     ↓
 *   MidiConverter.convert(arranged)                  // ArrangedTrack → MidiEvent[]
 *     ↓
 *   globalMidiScheduler.loadTrack(events, bpm)       // 5ms 轮询调度
 *     ↓
 *   SpessaSynth                                       // SF2 合成
 *
 * Pitch Space: 输入 ArrangedTrack pitch 已是 ABSOLUTE，本类透传不再触碰。
 */

import type { ArrangedTrack } from '../generation/types';
import { globalMidiScheduler } from './MidiScheduler';
import {
    MidiConverter,
    CHANNEL_MELODY, CHANNEL_PIANO_RH, CHANNEL_PIANO_LH,
} from './MidiConverter';

const PPQ = 480;

export const DEFAULT_CHANNEL_MAP = {
    vocal: 0,
    melody: CHANNEL_MELODY,             // 1
    secondaryMelody: 2,
    counterMelody: 3,
    pianoRH: CHANNEL_PIANO_RH,          // 4 — 和弦织体（accompaniment）
    pianoLH: CHANNEL_PIANO_LH,          // 5 — 贝斯（bass）
    drums: 9,                           // GM 鼓固定
    userMotif: 6,
} as const;

export interface VisualEvent {
    type: 'melody' | 'pianoLH' | 'pianoRH' | 'drums' | 'bass' | 'counterMelody' | 'confirm' | 'custom_particle' | 'fn_key_active';
    midiNote?: number;
    velocity?: number;
    col?: number;
    row?: number;
    hue?: number;
    energy?: number;
    spread?: number;
    source?: 'playback' | 'gameplay';
    time?: number;
    onset?: number;
    isUserMotif?: boolean;
    active?: boolean;
}

export type VisualEventListener = (event: VisualEvent) => void;

export type PartName =
    | 'vocal' | 'melody' | 'chord' | 'bass' | 'drums'
    | 'secondaryMelody' | 'counterMelody';

export interface MixerStateStub {
    volumes: { master: number; melody: number; pianoLH: number; pianoRH: number };
    eq: {
        melody: { low: number; mid: number; high: number };
        piano: { low: number; mid: number; high: number };
    };
    effects: {
        reverbWet: number; reverbRoomSize: number;
        hallWet: number; hallSize: number;
        filterFreq: number; compThreshold: number; compRatio: number;
    };
    system: { hardwareLofi: number };
}

const DEFAULT_MIXER_STATE: MixerStateStub = {
    volumes: { master: 0, melody: 0, pianoLH: 0, pianoRH: 0 },
    eq: {
        melody: { low: 0, mid: 0, high: 0 },
        piano: { low: 0, mid: 0, high: 0 },
    },
    effects: {
        reverbWet: 0.0, reverbRoomSize: 0.5,
        hallWet: 0.0, hallSize: 1.0,
        filterFreq: 20000, compThreshold: 0, compRatio: 1,
    },
    system: { hardwareLofi: 0 },
};

export class PlaybackEngine {
    private partChannels: Partial<Record<PartName, number>> = {};
    private visualListeners: VisualEventListener[] = [];
    private mixerState: MixerStateStub = JSON.parse(JSON.stringify(DEFAULT_MIXER_STATE));

    public setDrumDucking(_enabled: boolean): void { /* no-op，待 Phase 5 加 ducking */ }

    public getPartChannels(): Partial<Record<PartName, number>> {
        return { ...this.partChannels };
    }

    public getPartChannel(partName: PartName): number | null {
        return this.partChannels[partName] ?? null;
    }

    public addVisualListener(listener: VisualEventListener): void {
        this.visualListeners.push(listener);
    }
    public removeVisualListener(listener: VisualEventListener): void {
        this.visualListeners = this.visualListeners.filter(l => l !== listener);
    }
    public emitVisualEvent(event: VisualEvent): void {
        this.visualListeners.forEach(l => l(event));
    }

    public getMixerState(): MixerStateStub { return this.mixerState; }

    public setMixerParam(category: string, param: string, value: number): void {
        const s = this.mixerState as unknown as Record<string, Record<string, number>>;
        if (category === 'eq') {
            const [inst, band] = param.split('.');
            if (s.eq && (s.eq as unknown as Record<string, Record<string, number>>)[inst]) {
                (s.eq as unknown as Record<string, Record<string, number>>)[inst][band] = value;
            }
            return;
        }
        if (s[category] && Object.prototype.hasOwnProperty.call(s[category], param)) {
            s[category][param] = value;
        }
    }

    public setFocusTrack(_trackType: 'RHYTHM' | 'MELODY' | 'ATMOSPHERE' | 'NONE'): void { /* no-op */ }

    /**
     * 装载 ArrangedTrack → 调度器。
     *
     * 实装范围（Phase 4 baseline）：
     *   - 三轨齐发：melody(ch1) / pianoRH(ch4) / pianoLH(ch5)
     *   - 渲染下放给 MidiConverter — 本方法只负责 partChannels 注册 + scheduler 装载
     *   - 其他轨（vocal / drums / counterMelody）若 NoteData 数组非空也会进入
     *     MidiConverter，但当前 MidiConverter 只渲染三主轨（Phase 5 扩展）
     */
    public async loadSong(
        song: ArrangedTrack,
        _options?: { withCountIn?: boolean; loopStart?: number; loopEnd?: number },
    ): Promise<void> {
        this.partChannels = {};

        // partChannels 注册（用于 setPartMute / Q+H 面板单轨 mute）
        if (song.melody && song.melody.length > 0) {
            this.partChannels.melody = DEFAULT_CHANNEL_MAP.melody;
        }
        if (song.pianoRH && song.pianoRH.length > 0) {
            this.partChannels.chord = DEFAULT_CHANNEL_MAP.pianoRH;
        }
        if (song.pianoLH && song.pianoLH.length > 0) {
            this.partChannels.bass = DEFAULT_CHANNEL_MAP.pianoLH;
        }

        // 委托 MidiConverter 渲染 — 纯同步、零 PRNG、已全局排序（pipeline rule §2.9）
        const events = MidiConverter.convert(song);

        globalMidiScheduler.loadTrack(events, song.bpm);
    }

    public async appendSongChunk(_song: ArrangedTrack): Promise<void> { /* no-op — Phase 5 加 gapless */ }
    public setNextBlockTrigger(_triggerBeat: number, _callback: () => void): void { /* no-op */ }

    public play(): void { globalMidiScheduler.start(); }
    public stop(): void { globalMidiScheduler.stop(); }

    public getDuration(): number {
        // 优先用 pianoRH 通道末尾估算；为空则 fallback 到 melody
        let events = globalMidiScheduler.getChannelEvents(DEFAULT_CHANNEL_MAP.pianoRH);
        if (events.length === 0) {
            events = globalMidiScheduler.getChannelEvents(DEFAULT_CHANNEL_MAP.melody);
        }
        if (events.length === 0) return 0;
        const lastTick = events[events.length - 1].ticks;
        const bpm = globalMidiScheduler.getBpm();
        if (bpm <= 0) return 0;
        return (lastTick / PPQ) * (60 / bpm);
    }
}
