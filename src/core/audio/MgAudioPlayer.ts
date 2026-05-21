// ============================================================
// MgAudioPlayer — mg-standalone 音频链的 1:1 复刻
// ============================================================
//
// 用途:
//   MG 模式下接管音频播放,**完全绕过** auraflow 自带的 SpessaSynth + SF2 +
//   MidiConverter + AbsoluteTransposer 链路。AudioEngine.playSong() 检测
//   track.skipHandSplit === true 时分流到本类。
//
// 复刻自 melodygenerative/src/App.tsx:167-222(Sampler+Reverb init)
//        + 252-313(playback / mute toggle)。
//
// 音频链:
//   Tone.Sampler({Salamander mp3 30 个采样,baseUrl=tonejs.github.io CDN}) ──┐
//                                                                          ├──► destination
//   Tone.Reverb(decay=2.5, preDelay=0.01) ────────────────────────────────┘
//   Tone.Part(events) → triggerAttackRelease(note, durationSec, time, velocity)
//   Tone.Transport.bpm = track.bpm
//
// AF 模式完全不动 — 本类只在 MG 路径上工作。
// ============================================================

import * as Tone from 'tone';
import type { GeneratedTrack } from '../generation/types';

// melodygenerative/src/App.tsx:169-200 verbatim 复刻
const SALAMANDER_URLS = {
    A0:    'A0.mp3',
    C1:    'C1.mp3',
    'D#1': 'Ds1.mp3',
    'F#1': 'Fs1.mp3',
    A1:    'A1.mp3',
    C2:    'C2.mp3',
    'D#2': 'Ds2.mp3',
    'F#2': 'Fs2.mp3',
    A2:    'A2.mp3',
    C3:    'C3.mp3',
    'D#3': 'Ds3.mp3',
    'F#3': 'Fs3.mp3',
    A3:    'A3.mp3',
    C4:    'C4.mp3',
    'D#4': 'Ds4.mp3',
    'F#4': 'Fs4.mp3',
    A4:    'A4.mp3',
    C5:    'C5.mp3',
    'D#5': 'Ds5.mp3',
    'F#5': 'Fs5.mp3',
    A5:    'A5.mp3',
    C6:    'C6.mp3',
    'D#6': 'Ds6.mp3',
    'F#6': 'Fs6.mp3',
    A6:    'A6.mp3',
    C7:    'C7.mp3',
    'D#7': 'Ds7.mp3',
    'F#7': 'Fs7.mp3',
    A7:    'A7.mp3',
    C8:    'C8.mp3',
};
const SALAMANDER_BASE_URL = 'https://tonejs.github.io/audio/salamander/';

type MgPartKind = 'melody' | 'accomp';

interface TonePartEvent {
    time:        number;   // seconds
    note:        string;   // e.g. 'C4'
    durationSec: number;
    velocity:    number;   // 0-1
    partKind:    MgPartKind;
}

class MgAudioPlayerSystem {
    private sampler: Tone.Sampler | null = null;
    private reverb: Tone.Reverb | null = null;
    private part: Tone.Part<TonePartEvent> | null = null;
    private loadPromise: Promise<void> | null = null;

    // mute 状态 — Tone.Part 触发时实时读取(参考 standalone playMelodyRef / playHarmonyRef)
    private muteMelody = false;
    private muteAccomp = false;

    private playing = false;

    /**
     * 初始化 Tone.Sampler + Tone.Reverb(等价 standalone App.tsx:167-222 useEffect)。
     * 幂等:多次调用只 init 一次。
     * 返回 Promise — 等 Salamander mp3 全部加载完才 resolve。
     */
    public ensureLoaded(): Promise<void> {
        if (this.loadPromise) return this.loadPromise;

        this.loadPromise = new Promise<void>((resolve) => {
            const sampler = new Tone.Sampler({
                urls: SALAMANDER_URLS,
                release: 1,
                baseUrl: SALAMANDER_BASE_URL,
                onload: () => resolve(),
            }).toDestination();

            const reverb = new Tone.Reverb({
                decay: 2.5,
                preDelay: 0.01,
            }).toDestination();
            sampler.connect(reverb);

            this.sampler = sampler;
            this.reverb = reverb;
        });
        return this.loadPromise;
    }

    /**
     * 播放一首 MG track。
     *
     *   1. stop 当前 Part(防叠加)
     *   2. 从 track.melody + track.accompaniment 构造 Tone.Part events
     *      pitch 直接转 Tone.Frequency('midi') → note name
     *      time 从 beats 转 seconds(× 60/bpm)
     *      duration 保留 beats,Part 触发时实时换算(对 BPM 改动鲁棒)
     *   3. Tone.Transport.bpm = track.bpm
     *   4. Part 触发:if (kind==='melody' && muteMelody) skip / if (kind==='accomp' && muteAccomp) skip
     *      else sampler.triggerAttackRelease(note, durationSec, time, velocity)
     *   5. Part.loop = true,loopEnd = 整曲长度(end beat * 60/bpm)
     *   6. Transport.start
     *
     * 等价于 standalone App.tsx:252-313 togglePlay 的播放分支。
     */
    public async play(track: GeneratedTrack): Promise<void> {
        // 必须先 ensureLoaded — caller(AudioEngine)应已 await
        if (!this.sampler) {
            throw new Error('MgAudioPlayer.play called before sampler loaded');
        }

        // 清理之前可能在跑的 Part
        this.stopInternal();

        const bpm = track.bpm > 0 ? track.bpm : 100;
        const secPerBeat = 60 / bpm;

        // 收集所有事件,按 part 类型打标
        const events: TonePartEvent[] = [];
        const pushPart = (notes: ReadonlyArray<{ pitch: number; onset: number; duration: number; velocity: number }> | undefined, kind: MgPartKind) => {
            if (!notes || notes.length === 0) return;
            for (let i = 0; i < notes.length; i++) {
                const n = notes[i];
                if (!(n.duration > 0)) continue;
                const note = Tone.Frequency(n.pitch, 'midi').toNote();
                events.push({
                    time:        n.onset * secPerBeat,
                    note,
                    durationSec: n.duration * secPerBeat,
                    velocity:    n.velocity < 0 ? 0 : n.velocity > 1 ? 1 : n.velocity,
                    partKind:    kind,
                });
            }
        };
        pushPart(track.melody, 'melody');
        pushPart(track.accompaniment, 'accomp');

        if (events.length === 0) {
            // 空曲,不调度
            return;
        }

        // 整曲长度:取最后一个 NoteData onset+duration 的最大值,再换算成秒。
        // 用 sections 末尾 endBeat 也可,但 sections 在 MG 模式只是占位,这里直接从 events 取更稳。
        let maxEndBeat = 0;
        const scanEnd = (notes: ReadonlyArray<{ onset: number; duration: number }> | undefined) => {
            if (!notes) return;
            for (let i = 0; i < notes.length; i++) {
                const e = notes[i].onset + notes[i].duration;
                if (e > maxEndBeat) maxEndBeat = e;
            }
        };
        scanEnd(track.melody);
        scanEnd(track.accompaniment);
        const loopEndSec = maxEndBeat * secPerBeat;

        Tone.Transport.bpm.value = bpm;

        this.part = new Tone.Part<TonePartEvent>((time, value) => {
            // mute toggle 实时检测(等价 standalone playMelodyRef/playHarmonyRef)
            if (value.partKind === 'melody' && this.muteMelody) return;
            if (value.partKind === 'accomp' && this.muteAccomp) return;

            this.sampler!.triggerAttackRelease(
                value.note,
                value.durationSec,
                time,
                value.velocity,
            );
        }, events);

        this.part.start(0);
        this.part.loop = true;
        this.part.loopEnd = loopEndSec;

        Tone.Transport.start();
        this.playing = true;
    }

    /**
     * 停止播放(等价 standalone App.tsx:315-324 stopPlayback)。
     */
    public stop(): void {
        this.stopInternal();
    }

    private stopInternal(): void {
        Tone.Transport.stop();
        Tone.Transport.cancel();
        if (this.part) {
            this.part.dispose();
            this.part = null;
        }
        this.playing = false;
    }

    public isPlaying(): boolean {
        return this.playing;
    }

    /**
     * Mute 控制 —— 由 AudioEngine.setPartMute 适配过来:
     *   PartName='melody'  → setMute('melody', muted)
     *   PartName='chord'/'bass'/'pianoRH'/'pianoLH' → setMute('accomp', muted)
     */
    public setMute(kind: MgPartKind, muted: boolean): void {
        if (kind === 'melody') this.muteMelody = muted;
        else this.muteAccomp = muted;
    }

    public isMuted(kind: MgPartKind): boolean {
        return kind === 'melody' ? this.muteMelody : this.muteAccomp;
    }
}

export const MgAudioPlayer = new MgAudioPlayerSystem();
