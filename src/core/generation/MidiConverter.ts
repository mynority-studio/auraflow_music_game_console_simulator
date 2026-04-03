/**
 * MidiConverter — 生成管道第四模块（MIDI 转换层）
 *
 * 将 ArrangedTrack（NoteData[]）转换为 MidiEvent[] 序列。
 * 纯数据转换，不消耗 PRNG，不访问音频硬件。
 * 同一输入 = 同一输出（确定性）。
 */
import { ArrangedTrack, NoteData, GeneratedChord } from './types';
import { PRNGManager } from '../utils/PRNG';

const PPQ = 480;

/** 管道终点输出类型（从 MidiScheduler 提升到生成管道层） */
export interface MidiEvent {
    ticks: number;
    type: 'noteOn' | 'noteOff' | 'cc' | 'programChange' | 'pitchBend' | 'visual';
    channel: number;
    data1: number;
    data2: number;
    visualData?: { type: string; midiNote?: number; velocity?: number; source?: string; onset?: number; isUserMotif?: boolean };
}

/** 通道分配表：由平台层提供，映射轨道角色到 MIDI 通道 */
export interface ChannelMap {
    vocal: number;
    melody: number;
    secondaryMelody: number;
    chord: number;
    bass: number;
    drums: number;
    counterMelody: number;
}

/** 默认通道分配（GM 标准：通道 9 为鼓） */
export const DEFAULT_CHANNEL_MAP: ChannelMap = {
    vocal: 0,
    melody: 1,
    secondaryMelody: 2,
    chord: 3,
    bass: 4,
    drums: 9,
    counterMelody: 5,
};

function beatsToTicks(beats: number): number {
    return Math.round(beats * PPQ);
}

type TrackRole = 'vocal' | 'melody' | 'secondaryMelody' | 'pianoLH' | 'pianoRH' | 'drums' | 'counterMelody' | 'userMotif';

/** 网格对齐（D-4 合规：使用 Math.round 避免浮点漂移） */
function gridSnap(value: number): number {
    return Math.round(value / 0.25) * 0.25;
}

export class MidiConverter {
    /**
     * 将 ArrangedTrack 转换为 MidiEvent[] — 生成管道终点
     * @param song 编配引擎输出
     * @param channelMap 通道分配表（由平台层提供）
     * @param options 可选参数
     */
    static convert(
        song: ArrangedTrack,
        channelMap: ChannelMap = DEFAULT_CHANNEL_MAP,
        options?: { countInBeats?: number; drumDucking?: boolean }
    ): MidiEvent[] {
        // D-5 合规：stateD 快照点（验证 Orchestrator PRNG 消耗一致性）
        const _stateD = PRNGManager.getState();

        const countInBeats = options?.countInBeats ?? 0;
        const drumDucking = options?.drumDucking ?? false;
        const allEvents: MidiEvent[] = [];

        // --- 音符转换 ---
        const addPartEvents = (notes: NoteData[] | undefined, channel: number, visualType: string) => {
            if (!notes) return;
            for (const n of notes) {
                const onset = gridSnap(n.onset);
                const dur = gridSnap(n.duration) || 0.5;

                if (visualType === 'drums' && drumDucking) {
                    const duckedPitches = [35, 36, 38, 40, 41, 43, 45, 47, 48, 49, 50, 52, 53, 55, 57];
                    if (duckedPitches.includes(n.pitch)) continue;
                }

                if (n.pitch === undefined || isNaN(n.pitch)) continue;

                const startTick = beatsToTicks(onset + countInBeats);
                const durationTicks = beatsToTicks(dur);
                const vel = Math.max(0, Math.min(127, Math.round((n.velocity || 1) * 127)));

                allEvents.push({ ticks: startTick, type: 'noteOn', channel, data1: n.pitch, data2: vel });
                allEvents.push({
                    ticks: startTick, type: 'visual', channel, data1: 0, data2: 0,
                    visualData: { type: visualType, midiNote: n.pitch, velocity: vel, source: 'playback', onset, isUserMotif: n.isUserMotif }
                });
                allEvents.push({ ticks: startTick + durationTicks, type: 'noteOff', channel, data1: n.pitch, data2: 0 });
            }
        };

        // --- 动态混音 CC（Volume/Pan/Reverb per section） ---
        if (song.sections) {
            for (const sec of song.sections) {
                const startTick = beatsToTicks(sec.startBeat + countInBeats);
                const energyLevel = sec.energyLevel || 4;
                const spread = (energyLevel - 1) / 7.0;

                const applyCC = (channel: number, vol: number, targetPan: number, reverb: number) => {
                    const pan = Math.round(64 + (targetPan - 64) * spread);
                    allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 7, data2: vol });
                    allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 10, data2: pan });
                    allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 91, data2: Math.min(127, reverb) });
                };

                if (song.vocal) applyCC(channelMap.vocal, 118, 64, 40 + energyLevel * 5);
                applyCC(channelMap.melody, 118, 64, 40 + energyLevel * 5);
                applyCC(channelMap.drums, 108, 64, 10 + energyLevel * 3);
                applyCC(channelMap.bass, 98, 64, 0);
                applyCC(channelMap.chord, 85, 40, 60 + energyLevel * 8);
                if (song.secondaryMelody) applyCC(channelMap.secondaryMelody, 75, 88, 60 + energyLevel * 8);
                if (song.counterMelody) {
                    const isLeft = song.sections.indexOf(sec) % 2 === 0;
                    applyCC(channelMap.counterMelody, 60, isLeft ? 24 : 104, 60 + energyLevel * 8);
                }
            }
        }

        // --- 各轨音符 ---
        if (song.vocal) addPartEvents(song.vocal, channelMap.vocal, 'melody');
        addPartEvents(song.melody, channelMap.melody, 'melody');
        if (song.secondaryMelody) addPartEvents(song.secondaryMelody, channelMap.secondaryMelody, 'melody');
        addPartEvents(song.pianoLH, channelMap.bass, 'pianoLH');
        addPartEvents(song.pianoRH, channelMap.chord, 'pianoRH');
        if (song.counterMelody) addPartEvents(song.counterMelody, channelMap.counterMelody, 'pianoRH');
        if (song.drums) addPartEvents(song.drums, channelMap.drums, 'drums');

        // --- 签名结尾延音踏板 (CC64) ---
        if (song.chords) {
            for (const chord of song.chords) {
                if (chord.isSignatureEnding) {
                    const startTick = beatsToTicks(chord.startBeat + countInBeats);
                    const endTick = beatsToTicks(chord.endBeat + countInBeats);
                    const sustainChannels = [channelMap.chord, channelMap.bass];
                    if (song.counterMelody) sustainChannels.push(channelMap.counterMelody);

                    for (const ch of sustainChannels) {
                        allEvents.push({ ticks: startTick, type: 'cc', channel: ch, data1: 64, data2: 127 });
                        allEvents.push({ ticks: endTick, type: 'cc', channel: ch, data1: 64, data2: 0 });
                    }
                }
            }
        }

        // --- Fake Sidechain (CC11) ---
        {
            const needsSidechain = song.requireSidechain || false;

            if (needsSidechain && song.drums) {
                for (const n of song.drums) {
                    const isKick = n.pitch === 35 || n.pitch === 36;
                    if (isKick && n.velocity > 0.7) {
                        const startTick = beatsToTicks(n.onset + countInBeats);
                        const bpm = song.bpm || 120;

                        const injectSidechain = (channel: number) => {
                            allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 11, data2: 40 });
                            allEvents.push({ ticks: startTick + beatsToTicks(0.03 * (bpm / 60)), type: 'cc', channel, data1: 11, data2: 65 });
                            allEvents.push({ ticks: startTick + beatsToTicks(0.08 * (bpm / 60)), type: 'cc', channel, data1: 11, data2: 100 });
                            allEvents.push({ ticks: startTick + beatsToTicks(0.15 * (bpm / 60)), type: 'cc', channel, data1: 11, data2: 127 });
                        };

                        injectSidechain(channelMap.bass);
                        injectSidechain(channelMap.chord);
                        if (song.counterMelody) injectSidechain(channelMap.counterMelody);
                    }
                }
            }
        }

        // --- Count-in 点击 ---
        if (countInBeats > 0) {
            let maxOnset = 0;
            const tracks = [song.vocal, song.melody, song.secondaryMelody, song.pianoLH, song.pianoRH, song.drums, song.counterMelody, song.userMotif];
            for (const t of tracks) {
                if (t) for (const n of t) {
                    const end = n.onset + (n.duration || 0.5);
                    if (end > maxOnset) maxOnset = end;
                }
            }
            const totalBeats = countInBeats + Math.ceil(maxOnset);
            for (let i = 0; i < totalBeats; i++) {
                const startTick = beatsToTicks(i);
                const vel = i < countInBeats ? 127 : 76;
                allEvents.push({ ticks: startTick, type: 'noteOn', channel: channelMap.drums, data1: 42, data2: vel });
                allEvents.push({ ticks: startTick + beatsToTicks(0.1), type: 'noteOff', channel: channelMap.drums, data1: 42, data2: 0 });
            }
        }

        // D-3 合规：确定性排序（先按 ticks，同 ticks 按 type 优先级，再按 channel）
        const typePriority: Record<string, number> = { 'programChange': 0, 'cc': 1, 'noteOff': 2, 'noteOn': 3, 'pitchBend': 4, 'visual': 5 };
        allEvents.sort((a, b) => {
            if (a.ticks !== b.ticks) return a.ticks - b.ticks;
            const pa = typePriority[a.type] ?? 6;
            const pb = typePriority[b.type] ?? 6;
            if (pa !== pb) return pa - pb;
            return a.channel - b.channel;
        });

        return allEvents;
    }
}
