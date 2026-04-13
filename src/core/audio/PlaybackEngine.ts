// ==========================================
// 📄 文件路径: /src/core/audio/PlaybackEngine.ts
// 🌟 V3.0 纯 MIDI 调度版
// ==========================================
import { ArrangedTrack, NoteData } from '../generation/types';
import { AudioMixer } from './AudioMixer';
import { InstrumentRegistry } from './Instruments';
import { spessaSynth, startAudioContext } from './SynthManager';
import { globalMidiScheduler, MidiEvent } from './MidiScheduler';
import { PRNGManager } from '../utils/PRNG';

export interface VisualEvent { type: 'lead' | 'bass' | 'accomp' | 'drums' | 'pad' | 'confirm' | 'custom_particle' | 'fn_key_active'; midiNote?: number; velocity?: number; col?: number; row?: number; hue?: number; energy?: number; spread?: number; source?: 'playback' | 'gameplay'; time?: number; onset?: number; isUserMotif?: boolean; active?: boolean; }
export type VisualEventListener = (event: VisualEvent) => void;

import { StyleId } from '../generation/config/StyleFlags';
import { StyleRegistry, DefaultStyleConfig } from '../generation/config/StyleRegistry';
import { getStyleConfig } from '../generation/config/styles/StyleRegistry';
import { InstrumentProfiles, getInstrumentIdByName } from '../generation/config/InstrumentFlags';

// 声部→MIDI通道映射，供 Jam 模式使用
export interface PartChannelMap {
    lead: number;
    vocal: number | null;
    accomp: number;
    bass: number;
    drums: number;
    pad: number | null;
}

export class PlaybackEngine {
    private mixer: AudioMixer;
    private instruments: InstrumentRegistry;
    private visualListeners: VisualEventListener[] =[];
    private isStopped: boolean = false;
    private totalDurationSeconds: number = 0;
    private drumDucking: boolean = false;
    private _partChannelMap: PartChannelMap | null = null;

    constructor() {
        this.mixer = new AudioMixer();
        this.instruments = new InstrumentRegistry(this.mixer);
        
        // Forward visual events from MidiScheduler
        globalMidiScheduler.addVisualListener((data: any) => {
            this.emitVisualEvent(data as VisualEvent);
        });
    }

    public setDrumDucking(enabled: boolean) {
        this.drumDucking = enabled;
    }

    public addVisualListener(listener: VisualEventListener) { this.visualListeners.push(listener); }
    public removeVisualListener(listener: VisualEventListener) { this.visualListeners = this.visualListeners.filter(l => l !== listener); }
    public emitVisualEvent(event: VisualEvent) { this.visualListeners.forEach(l => l(event)); }

    public getMixerState() {
        return this.mixer.getMixerState();
    }

    public setMixerParam(category: string, param: string, value: number) {
        this.mixer.setMixerParam(category, param, value);
    }

    public setFocusTrack(trackType: 'RHYTHM' | 'MELODY' | 'ATMOSPHERE' | 'NONE') {
        this.mixer.setFocusTrack(trackType);
    }

    public async loadSong(song: ArrangedTrack, options?: { withCountIn?: boolean, loopStart?: number, loopEnd?: number }) {
        // 🌟 ACVE §5.1 — 入口快照点 D（MIDI 转换/调度入口，generation pipeline 已结束）
        PRNGManager.recordSnapshot('D');
        this.isStopped = false;
        await startAudioContext();
        
        // --- 打印歌曲元数据 ---
        console.log("========================================");
        console.log("🎵 歌曲生成完毕，开始播放 🎵");
        const actualStyle = getStyleConfig(song.styleId as any);
        console.log(`Style: ${actualStyle.name} (ID: ${song.styleId})`);
        console.log(`BPM: ${song.bpm}`);
        console.log(`Key: ${song.key}`);
        console.log(`Time Signature: ${song.timeSignature ? song.timeSignature.join('/') : '4/4'}`);
        
        console.log("--- 使用的乐器 ---");
        const mixing = song.palette?.mixing || {};
        const printInstrument = (role: string, sound?: string | null, mix?: any) => {
            if (sound) {
                const pan = mix?.pan !== undefined ? mix.pan : 0;
                const panStr = pan === 0 ? 'Center' : (pan < 0 ? `Left ${Math.abs(pan)}` : `Right ${pan}`);
                console.log(`- ${role}: ${sound} (Pan: ${panStr})`);
            }
        };
        printInstrument('Vocal', song.palette?.vocalSound, mixing.vocal);
        printInstrument('Lead', song.palette?.leadSound, mixing.lead);
        printInstrument('Accomp', song.palette?.accompSound, mixing.accomp);
        printInstrument('Bass', song.palette?.bassSound, mixing.bass);
        printInstrument('Drums', song.palette?.drumSound, mixing.drums);
        printInstrument('Pad', song.palette?.padSound, mixing.pad);

        console.log("--- 全曲和弦与旋律进行 ---");
        if (song.sections && song.chords) {
            const noteToMidiStr = (midi: number): string => {
                const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
                const octave = Math.floor(midi / 12) - 1;
                const note = notes[midi % 12];
                return `${note}${octave}`;
            };

            song.sections.forEach(sec => {
                const sectionChords = song.chords?.filter(c => c.startBeat >= sec.startBeat && c.startBeat < sec.endBeat);
                if (!sectionChords || sectionChords.length === 0) return;

                let chordStr = `[${sec.name}]: | `;
                for (const chord of sectionChords) {
                    chordStr += `${chord.numeral} --- | `;
                }
                console.log(chordStr);

                const printTrackNotes = (trackNotes: any[] | undefined, prefix: string) => {
                    if (!trackNotes || trackNotes.length === 0) return;
                    
                    const secNotes = trackNotes.filter(n => n.onset >= sec.startBeat && n.onset < sec.endBeat);
                    if (secNotes.length === 0) return;

                    let noteStr = `${prefix}_${sec.name}: | `;
                    for (const chord of sectionChords) {
                        const chordNotes = secNotes.filter(n => n.onset >= chord.startBeat && n.onset < chord.endBeat);
                        if (chordNotes.length > 0) {
                            noteStr += chordNotes.map(n => `${noteToMidiStr(n.pitch)}(${Number(n.duration.toFixed(2))})`).join('-') + ' | ';
                        } else {
                            noteStr += '--- | ';
                        }
                    }
                    console.log(noteStr);
                };

                printTrackNotes(song.lead, 'lead');
                printTrackNotes(song.pad, 'pad');
                printTrackNotes(song.bass, 'bass');
            });
        }
        console.log("========================================");
        // ----------------------

        if (spessaSynth) {
            this.mixer.connectSpessaSynth(spessaSynth);
        }
        
        // 🌟 0. Set Mix Style based on song styleId
        if (song.styleId !== undefined) {
            this.mixer.setMixStyle('default');
        } else {
            this.mixer.setMixStyle('default');
        }

        // 🌟 1. 抽卡聘请总调音师 (Mastering)
        const styleConfig = song.styleId !== undefined ? (StyleRegistry[song.styleId as StyleId] || DefaultStyleConfig) : DefaultStyleConfig;
        const selectedProfile = styleConfig.masteringProfileId || 'Retro_Gadget';
        await this.mixer.applyMasteringProfile(selectedProfile);

        // 🌟 2. 获取采样器 (100% Soundfont)
        
        const vocalSynth = song.palette?.vocalSound ? this.instruments.getInstrument(song.palette.vocalSound, 'Foreground', 'vocal', mixing.vocal) : null;
        const leadSynth = this.instruments.getInstrument(song.palette?.leadSound || 'Acoustic_Grand', song.palette?.vocalSound ? 'Midground' : 'Foreground', 'lead', mixing.lead);
        const accompSynth = this.instruments.getInstrument(song.palette?.accompSound || 'Warm_EP', 'Midground', 'accomp', mixing.accomp);

        // 🌟 3. 独立 Bass 采样器：根据 palette 配置选择贝斯音色
        const bassSynth = this.instruments.getInstrument(song.palette?.bassSound || 'Electric_Bass', 'Rhythm', 'bass', mixing.bass);
        const drumSynth = this.instruments.getInstrument(song.palette?.drumSound || 'Standard_DrumKit', 'Rhythm', 'drums', mixing.drums);

        // 记录声部→通道映射，供 Jam 模式精确 mute/noteOn
        this._partChannelMap = {
            lead: leadSynth.channel,
            vocal: vocalSynth ? vocalSynth.channel : null,
            accomp: accompSynth.channel,
            bass: bassSynth.channel,
            drums: drumSynth.channel,
            pad: null // pad 在下方按需创建时更新
        };

        if (this.isStopped) return;

        globalMidiScheduler.stop();
        
        const secPerBeat = 60 / song.bpm;
        
        let maxOnset = 0;
        const updateMaxOnset = (notes?: any[]) => {
            if (notes) {
                notes.forEach(n => {
                    const end = n.onset + (n.duration || 0.5);
                    if (end > maxOnset) maxOnset = end;
                });
            }
        };
        
        updateMaxOnset(song.lead);
        updateMaxOnset(song.bass);
        updateMaxOnset(song.accomp);
        updateMaxOnset(song.drums);
        updateMaxOnset(song.pad);
        updateMaxOnset(song.userMotif);
        
        const countInBeats = options?.withCountIn ? 4 : 0;
        this.totalDurationSeconds = (maxOnset + countInBeats) * secPerBeat;

        if (options?.loopStart !== undefined && options?.loopEnd !== undefined) {
            globalMidiScheduler.loop = true;
            globalMidiScheduler.loopStartTicks = globalMidiScheduler.beatsToTicks(options.loopStart + countInBeats);
            globalMidiScheduler.loopEndTicks = globalMidiScheduler.beatsToTicks(options.loopEnd + countInBeats);
        } else {
            globalMidiScheduler.loop = false;
        }

        let allEvents: MidiEvent[] = [];

        const scheduleSynthInit = (synth: any) => {
            if (!synth) return;
            const activeSynth = typeof synth === 'function' ? synth(0) : synth;
            if (activeSynth) {
                allEvents.push({
                    ticks: 0,
                    type: 'cc',
                    channel: activeSynth.channel,
                    data1: 0, // Bank Select MSB
                    data2: activeSynth.bank || 0
                });
                allEvents.push({
                    ticks: 0,
                    type: 'cc',
                    channel: activeSynth.channel,
                    data1: 32, // Bank Select LSB
                    data2: 0
                });
                allEvents.push({
                    ticks: 0,
                    type: 'programChange',
                    channel: activeSynth.channel,
                    data1: activeSynth.program || 0,
                    data2: 0
                });

                // 🌟 CC74 亮度控制：高频刺耳乐器降低 Brightness（免费 LPF）
                // GM Program: 40=Violin, 48=StringEnsemble, 56=Trumpet, 61=Brass, 71=Clarinet, 73=Flute
                const prog = activeSynth.program || 0;
                const isHarshTimbre = prog === 40 || prog === 48 || prog === 49 || prog === 56 || prog === 61 || prog === 71 || prog === 73;
                allEvents.push({
                    ticks: 0,
                    type: 'cc',
                    channel: activeSynth.channel,
                    data1: 74, // Brightness / Filter Cutoff
                    data2: isHarshTimbre ? 50 : 64 // 刺耳音色压低到 50，其他保持默认 64
                });
            }
        };

        // 全局调性移调偏移量（生成管道在 C 大调相对空间工作）
        const transposeOffset = (song.chords && song.chords.length > 0 && song.chords[0].keyOffset !== undefined)
            ? song.chords[0].keyOffset : 0;

        const addPartEvents = (notes: any[], synth: any, eventType: VisualEvent['type']) => {
            if (!notes) return;
            notes.forEach(n => {
                // Onset 吸附 16 分音符网格，Duration 保留原始精度（避免截断尾音）
                let rawOnset = Number(n.onset);
                let rawDuration = Number(n.duration);
                let onset = Math.round(rawOnset / 0.25) * 0.25;
                let dur = Math.max(0.1, rawDuration); // 不量化时值，保留连贯感

                if (isNaN(dur) || dur <= 0) dur = 0.5;
                
                if (eventType === 'drums' && this.drumDucking) {
                    const duckedPitches = [35, 36, 38, 40, 41, 43, 45, 47, 48, 49, 50, 52, 53, 55, 57];
                    if (duckedPitches.includes(n.pitch)) return; 
                }

                const activeSynth = typeof synth === 'function' ? synth(onset) : synth;
                let channel = activeSynth.channel;
                // 全局调性移调 + 声部专属八度折叠
                let pitch = n.pitch;
                if (eventType !== 'drums' && transposeOffset !== 0) {
                    pitch += transposeOffset;
                    if (eventType === 'bass') {
                        // 贝斯专属：折叠到 E1(28) ~ G2(43)，保持低频地基
                        while (pitch > 43) pitch -= 12;
                        while (pitch < 28) pitch += 12;
                    } else {
                        // 其他声部：折叠到 C2(36) ~ C6(84)
                        while (pitch > 84) pitch -= 12;
                        while (pitch < 36) pitch += 12;
                    }
                }
                
                if (pitch !== undefined && !isNaN(pitch)) {
                    const startTick = globalMidiScheduler.beatsToTicks(onset + countInBeats);
                    const durationTicks = globalMidiScheduler.beatsToTicks(dur);
                    const vel = Math.max(0, Math.min(127, Math.round((n.velocity || 1) * 127)));

                    // Note On
                    allEvents.push({
                        ticks: startTick,
                        type: 'noteOn',
                        channel: channel,
                        data1: pitch,
                        data2: vel
                    });

                    // Visual Event
                    allEvents.push({
                        ticks: startTick,
                        type: 'visual',
                        channel: channel,
                        data1: 0,
                        data2: 0,
                        visualData: { type: eventType, midiNote: pitch, velocity: vel, source: 'playback', onset: onset, isUserMotif: n.isUserMotif }
                    });

                    // Note Off
                    allEvents.push({
                        ticks: startTick + durationTicks,
                        type: 'noteOff',
                        channel: channel,
                        data1: pitch,
                        data2: 0
                    });
                }
            });
        };

        const vocalSynthFn = vocalSynth ? () => vocalSynth : null;
        const leadSynthFn = () => leadSynth;
        const accompSynthFn = () => accompSynth;
        const drumSynthFn = () => drumSynth;
        const bassSynthFn = () => bassSynth;

        scheduleSynthInit(vocalSynthFn);
        scheduleSynthInit(leadSynthFn);
        scheduleSynthInit(accompSynthFn);
        scheduleSynthInit(drumSynthFn);
        scheduleSynthInit(bassSynthFn);
        if (song.pad && song.palette?.padSound) {
            const padSynthInit = this.instruments.getInstrument(song.palette!.padSound, 'Midground', 'pad', mixing.pad);
            if (this._partChannelMap) this._partChannelMap.pad = padSynthInit.channel;
            scheduleSynthInit(() => padSynthInit);
        }

        // 🌟 Luis's Dynamic Panning & Reverb + Gain Staging
        if (song.sections) {
            song.sections.forEach((sec, index) => {
                const startTick = globalMidiScheduler.beatsToTicks(sec.startBeat + countInBeats);
                const energyLevel = sec.energyLevel || 4; // 1-8
                const spread = (energyLevel - 1) / 7.0;

                const applyCC = (synthFn: any, mixConfig: any, energyLevel: number, isDrums: boolean = false) => {
                    if (!synthFn || !mixConfig) return;
                    const channel = synthFn(sec.startBeat).channel;

                    const basePan = mixConfig.pan !== undefined ? Math.max(0, Math.min(127, Math.round((mixConfig.pan + 1) * 63.5))) : 64;
                    const baseReverb = mixConfig.reverb !== undefined ? Math.max(0, Math.min(127, Math.round(mixConfig.reverb * 127))) : 0;
                    const baseVol = mixConfig.volume !== undefined ? Math.max(0, Math.min(115, Math.round(80 * Math.pow(10, mixConfig.volume / 20)))) : 80;

                    const pan = Math.round(64 + (basePan - 64) * spread);
                    const reverb = Math.min(127, Math.round(baseReverb * (0.5 + 0.5 * spread)));
                    const vol = Math.min(115, Math.round(baseVol * (0.8 + 0.2 * spread)));

                    // 🌟 CC7 渐入曲线：非鼓组段落开头 1 拍从 60%→100% 渐变
                    if (!isDrums && index > 0) {
                        for (let step = 0; step < 4; step++) {
                            const progress = (step + 1) / 4;
                            const fadeVol = Math.round(vol * (0.6 + 0.4 * progress));
                            allEvents.push({ ticks: startTick + Math.round(step * globalMidiScheduler.beatsToTicks(0.25)), type: 'cc', channel, data1: 7, data2: fadeVol });
                        }
                    } else {
                        allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 7, data2: vol });
                    }

                    allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 10, data2: pan });
                    allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 91, data2: reverb });

                    if (mixConfig.chorus !== undefined) {
                        allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 93, data2: mixConfig.chorus });
                    }
                };

                applyCC(vocalSynthFn, mixing.vocal, energyLevel);
                applyCC(leadSynthFn, mixing.lead, energyLevel);
                applyCC(drumSynthFn, mixing.drums, energyLevel, true);
                applyCC(bassSynthFn, mixing.bass, energyLevel);
                applyCC(accompSynthFn, mixing.accomp, energyLevel);

                if (song.pad && song.palette?.padSound) {
                    const padSynth = this.instruments.getInstrument(song.palette.padSound, 'Midground', 'pad', mixing.pad);
                    const padSynthFn = () => padSynth;
                    applyCC(padSynthFn, mixing.pad, energyLevel);
                }
            });
        }

        addPartEvents(song.lead, leadSynthFn, 'lead');
        addPartEvents(song.bass, bassSynthFn, 'bass');
        addPartEvents(song.accomp, accompSynthFn, 'accomp');
        if (song.pad && song.palette?.padSound) {
            const padSynth = this.instruments.getInstrument(song.palette.padSound, 'Midground', 'pad', mixing.pad);
            const padSynthFn = () => padSynth;
            addPartEvents(song.pad, padSynthFn, 'pad');
        }
        if (song.drums) {
            addPartEvents(song.drums, drumSynthFn, 'drums');
        }

        // 🌟 CC11 表情呼吸曲线：Sustained/Pad 乐器的背景长音自动生成呼吸包络
        // 仅对 pad 应用（主旋律不加，避免"断气"）
        const addCC11Swell = (partNotes: any[] | undefined, synthFn: any, instrumentName: string | null | undefined) => {
            if (!partNotes || !synthFn || !instrumentName) return;
            const instId = getInstrumentIdByName(instrumentName);
            const profile = InstrumentProfiles[instId];
            if (!profile.needsCC11) return;
            const activeSynth = typeof synthFn === 'function' ? synthFn(0) : synthFn;
            const channel = activeSynth.channel;

            const wp = profile.windProfile;
            const isWind = !!wp;

            // ── 管乐：乐句级呼吸曲线（不是每个音符独立做包络） ──
            // 策略：
            //   - 乐句首音：从 ccCruise*0.85 快速上升到 ccCruise（模拟起吹）
            //   - 乐句中间：维持 ccCruise 附近，随力度微波动（±8）
            //   - 长音（≥1.5拍）：在音符内做轻微 swell（ccCruise→ccPeak→ccCruise）
            //   - 乐句末音结尾：从 ccCruise 渐降到 ccTail（气息自然收束）
            //   - 换气间隙：不发 CC11（让合成器自然处理 noteOff）
            if (isWind) {
                const ccCruise = 90;    // 巡航音量（大部分时间维持在这）
                const ccPeak = 108;     // 长音 swell 峰值
                const ccAttack = 72;    // 乐句起吹初始值（不会太低，避免"突然冒出来"）
                const ccTail = 60;      // 乐句收尾值（不会太低，避免"突然消失"）

                // 检测乐句边界（间隙 ≥ 0.3 拍视为换气）
                const BREATH_GAP = 0.3;

                for (let ni = 0; ni < partNotes.length; ni++) {
                    const note = partNotes[ni];
                    const startTick = globalMidiScheduler.beatsToTicks(note.onset + countInBeats);
                    const endTick = globalMidiScheduler.beatsToTicks(note.onset + note.duration + countInBeats);
                    if (endTick <= startTick) continue;

                    const prevEnd = ni > 0 ? partNotes[ni - 1].onset + partNotes[ni - 1].duration : -999;
                    const nextStart = ni < partNotes.length - 1 ? partNotes[ni + 1].onset : 999;
                    const gapBefore = note.onset - prevEnd;
                    const gapAfter = nextStart - (note.onset + note.duration);
                    const isPhraseStart = gapBefore >= BREATH_GAP || ni === 0;
                    const isPhraseEnd = gapAfter >= BREATH_GAP || ni === partNotes.length - 1;

                    // 基线 CC11 = 力度映射到巡航区间
                    const velCC = Math.round(ccCruise + (note.velocity - 0.6) * 30); // 0.6→90, 0.8→96, 1.0→102
                    const clampedVelCC = Math.min(115, Math.max(75, velCC));

                    if (isPhraseStart) {
                        // 乐句首音：快速起吹（3 帧：attack → cruise）
                        allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 11, data2: ccAttack });
                        const rampTick1 = startTick + Math.round((endTick - startTick) * 0.15);
                        allEvents.push({ ticks: rampTick1, type: 'cc', channel, data1: 11, data2: Math.round((ccAttack + clampedVelCC) / 2) });
                        const rampTick2 = startTick + Math.round((endTick - startTick) * 0.3);
                        allEvents.push({ ticks: Math.min(rampTick2, endTick - 24), type: 'cc', channel, data1: 11, data2: clampedVelCC });
                    } else {
                        // 乐句中间音：直接设到巡航值（连奏不断气）
                        allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 11, data2: clampedVelCC });
                    }

                    // 长音内部 swell（≥1.5 拍才做，6 帧正弦微波动）
                    if (note.duration >= 1.5) {
                        const swellStart = startTick + Math.round((endTick - startTick) * 0.25);
                        const swellPeak = startTick + Math.round((endTick - startTick) * 0.5);
                        const swellEnd = endTick - 48;
                        if (swellEnd > swellStart) {
                            const swellHigh = Math.min(ccPeak, clampedVelCC + 15);
                            allEvents.push({ ticks: swellStart, type: 'cc', channel, data1: 11, data2: clampedVelCC });
                            allEvents.push({ ticks: Math.round((swellStart + swellPeak) / 2), type: 'cc', channel, data1: 11, data2: Math.round((clampedVelCC + swellHigh) / 2) });
                            allEvents.push({ ticks: swellPeak, type: 'cc', channel, data1: 11, data2: swellHigh });
                            allEvents.push({ ticks: Math.round((swellPeak + swellEnd) / 2), type: 'cc', channel, data1: 11, data2: Math.round((clampedVelCC + swellHigh) / 2) });
                            allEvents.push({ ticks: swellEnd, type: 'cc', channel, data1: 11, data2: clampedVelCC });
                        }
                    }

                    // 乐句末音收尾：渐降（不是骤降）
                    if (isPhraseEnd && note.duration >= 0.5) {
                        const tailStart = endTick - Math.round((endTick - startTick) * 0.3);
                        const tailMid = endTick - Math.round((endTick - startTick) * 0.15);
                        if (tailStart > startTick) {
                            allEvents.push({ ticks: tailStart, type: 'cc', channel, data1: 11, data2: Math.round(clampedVelCC * 0.85) });
                            allEvents.push({ ticks: tailMid, type: 'cc', channel, data1: 11, data2: Math.round(clampedVelCC * 0.7) });
                            allEvents.push({ ticks: Math.max(tailMid + 1, endTick - 24), type: 'cc', channel, data1: 11, data2: ccTail });
                        }
                    }
                }
                return; // 管乐走专用路径，不走通用正弦
            }

            // ── 通用 Sustained（Pad/弦乐）：保留原有正弦包络 ──
            const ccMin = 40;
            const ccPeak = 90;
            const peakPos = 0.4;
            const STEPS = 8;

            for (let ni = 0; ni < partNotes.length; ni++) {
                const note = partNotes[ni];
                if (note.duration < 1.0) continue;

                const startTick = globalMidiScheduler.beatsToTicks(note.onset + countInBeats);
                const endTick = globalMidiScheduler.beatsToTicks(note.onset + note.duration + countInBeats);
                const totalTicks = endTick - startTick;
                if (totalTicks <= 0) continue;

                for (let s = 0; s <= STEPS; s++) {
                    const t = s / STEPS;
                    let phase: number;
                    if (t <= peakPos) {
                        phase = (t / peakPos) * 0.5;
                    } else {
                        phase = 0.5 + ((t - peakPos) / (1.0 - peakPos)) * 0.5;
                    }
                    const sinVal = Math.sin(phase * Math.PI);
                    const ccVal = Math.round(ccMin + (ccPeak - ccMin) * sinVal);
                    const tick = Math.round(startTick + totalTicks * t);
                    const finalTick = s === STEPS ? Math.max(startTick + 1, tick - 48) : tick;
                    allEvents.push({ ticks: finalTick, type: 'cc', channel, data1: 11, data2: Math.min(127, Math.max(0, ccVal)) });
                }
            }
        };
        if (song.pad && song.palette?.padSound) {
            const padSynthCC11 = this.instruments.getInstrument(song.palette.padSound, 'Midground', 'pad', mixing.pad);
            addCC11Swell(song.pad, () => padSynthCC11, song.palette.padSound);
        }

        // 🌟 管乐 Lead 也需要 CC11 呼吸包络
        if (song.lead && song.palette?.leadSound) {
            const leadInstId = getInstrumentIdByName(song.palette.leadSound);
            const leadProfile = InstrumentProfiles[leadInstId];
            if (leadProfile.needsCC11) {
                const leadSynthCC11 = this.instruments.getInstrument(song.palette.leadSound, 'Foreground', 'lead', mixing.lead);
                addCC11Swell(song.lead, () => leadSynthCC11, song.palette.leadSound);
            }
        }

        // 🌟 管乐表情注入：Scoop (滑音起音) + Fall (掉音收尾) + Vibrato (颤音)
        const addWindExpression = (partNotes: NoteData[] | undefined, synthFn: any, instrumentName: string | null | undefined) => {
            if (!partNotes || !synthFn || !instrumentName) return;
            const instId = getInstrumentIdByName(instrumentName);
            const profileWind = InstrumentProfiles[instId];
            const wp = profileWind?.windProfile;
            if (!wp) return;

            const activeSynth = typeof synthFn === 'function' ? synthFn(0) : synthFn;
            const channel = activeSynth.channel;
            const ppq = 480;
            const beatsToTicksLocal = (beats: number) => Math.round(beats * ppq);
            const secToBeats = (sec: number) => sec * (song.bpm / 60);

            for (let ni = 0; ni < partNotes.length; ni++) {
                const note = partNotes[ni];
                const startTick = beatsToTicksLocal(note.onset + countInBeats);
                const durTicks = beatsToTicksLocal(note.duration);

                // Scoop: pitchBend 标记存在（由 WindIdiom 设置）
                if (note.pitchBend && note.pitchBend < 0) {
                    // T=0: bend down
                    allEvents.push({ ticks: startTick, type: 'pitchBend' as const, channel, data1: (note.pitchBend + 8192), data2: 0 });
                    // T+80ms: restore center
                    const scoopEndTick = startTick + beatsToTicksLocal(secToBeats(0.08));
                    allEvents.push({ ticks: Math.max(startTick + 1, scoopEndTick), type: 'pitchBend' as const, channel, data1: 8192, data2: 0 });
                }

                // Fall: fadeOutDuration 标记存在（由 WindIdiom 设置）
                if (note.fadeOutDuration && note.fadeOutDuration > 0 && wp.allowFall) {
                    const fallStartTick = startTick + durTicks - beatsToTicksLocal(note.fadeOutDuration);
                    if (fallStartTick > startTick) {
                        // PitchBend 快速下降
                        allEvents.push({ ticks: fallStartTick, type: 'pitchBend' as const, channel, data1: 8192, data2: 0 });
                        allEvents.push({ ticks: fallStartTick + beatsToTicksLocal(0.05), type: 'pitchBend' as const, channel, data1: 5000, data2: 0 });
                        allEvents.push({ ticks: fallStartTick + beatsToTicksLocal(0.10), type: 'pitchBend' as const, channel, data1: 2048, data2: 0 });
                        // CC11 音量骤降
                        allEvents.push({ ticks: fallStartTick, type: 'cc' as const, channel, data1: 11, data2: 60 });
                        allEvents.push({ ticks: fallStartTick + beatsToTicksLocal(0.10), type: 'cc' as const, channel, data1: 11, data2: 20 });
                        // 恢复
                        const noteEndTick = startTick + durTicks;
                        allEvents.push({ ticks: noteEndTick, type: 'pitchBend' as const, channel, data1: 8192, data2: 0 });
                        allEvents.push({ ticks: noteEndTick, type: 'cc' as const, channel, data1: 11, data2: 127 });
                    }
                }

                // Vibrato: 长音（≥1.5 拍）后半段用 PitchBend LFO
                if (note.duration >= 1.5) {
                    const vibratoStartTick = startTick + Math.floor(durTicks * wp.vibratoOnsetRatio);
                    const vibratoEndTick = startTick + durTicks - 48;
                    if (vibratoEndTick > vibratoStartTick) {
                        // 简化 LFO：用方波近似正弦，每半周期交替偏移
                        const halfPeriodBeats = 1.0 / (wp.vibratoRate * 2);
                        const halfPeriodTicks = Math.max(24, beatsToTicksLocal(halfPeriodBeats));
                        let up = true;
                        for (let t = vibratoStartTick; t < vibratoEndTick; t += halfPeriodTicks) {
                            const bendVal = up ? 8192 + wp.vibratoDepth : 8192 - wp.vibratoDepth;
                            allEvents.push({ ticks: t, type: 'pitchBend' as const, channel, data1: bendVal, data2: 0 });
                            up = !up;
                        }
                        // 恢复 center
                        allEvents.push({ ticks: vibratoEndTick, type: 'pitchBend' as const, channel, data1: 8192, data2: 0 });
                    }
                }
            }
        };

        // 应用管乐表情到 lead 声部
        if (song.lead && song.palette?.leadSound) {
            addWindExpression(song.lead, leadSynthFn, song.palette.leadSound);
        }

        // 🌟 管乐影子通道：GM#122 Breath Noise 气流噪声
        if (song.lead && song.palette?.leadSound) {
            const leadInstIdShadow = getInstrumentIdByName(song.palette.leadSound);
            const leadProfileShadow = InstrumentProfiles[leadInstIdShadow];
            const wpShadow = leadProfileShadow?.windProfile;
            if (wpShadow) {
                // 分配影子通道
                const shadowSynth = this.instruments.getInstrument('Breath_Noise', 'Background', 'wind_shadow', { volume: -20, reverb: 0.3, pan: 0 });
                const shadowCh = shadowSynth.channel;

                // Program Change to GM#122
                allEvents.push({ ticks: 0, type: 'programChange' as const, channel: shadowCh, data1: wpShadow.shadowProgram, data2: 0 });
                // 初始音量极低
                allEvents.push({ ticks: 0, type: 'cc' as const, channel: shadowCh, data1: 7, data2: 30 });

                // 为每个 lead 音符生成影子音符
                for (let ni = 0; ni < song.lead.length; ni++) {
                    const note = song.lead[ni];
                    const startTick = Math.round((note.onset + countInBeats) * 480);
                    const endTick = startTick + Math.round(note.duration * 480);
                    // 非线性力度映射：强吹 → 更多气声
                    const shadowVel = Math.min(127, Math.round(
                        Math.pow(note.velocity, wpShadow.shadowDynamicExponent) * 127 * wpShadow.shadowVelocityRatio
                    ));

                    if (shadowVel > 0) {
                        allEvents.push({ ticks: startTick, type: 'noteOn' as const, channel: shadowCh, data1: 60, data2: shadowVel });
                        allEvents.push({ ticks: endTick, type: 'noteOff' as const, channel: shadowCh, data1: 60, data2: 0 });
                    }
                }
            }
        }

        // 🌟 提案三：标志性结尾 (Jazz/R&B Signature Ending - CC64 Sustain)
        if (song.chords) {
            song.chords.forEach(chord => {
                if (chord.isSignatureEnding) {
                    const startTick = globalMidiScheduler.beatsToTicks(chord.startBeat + countInBeats);
                    const endTick = globalMidiScheduler.beatsToTicks(chord.endBeat + countInBeats);
                    
                    // 为所有和声乐器 (accomp, bass, pad) 发送 CC64 延音踏板踩下
                    const sustainChannels = new Set<number>();
                    if (accompSynthFn) sustainChannels.add(accompSynthFn().channel);
                    if (bassSynthFn) sustainChannels.add(bassSynthFn().channel);
                    if (song.pad && song.palette?.padSound) {
                        const padSynthSustain = this.instruments.getInstrument(song.palette.padSound, 'Midground', 'pad');
                        sustainChannels.add(padSynthSustain.channel);
                    }

                    sustainChannels.forEach(channel => {
                        // 踩下踏板 (127)
                        allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 64, data2: 127 });
                        // 松开踏板 (0)
                        allEvents.push({ ticks: endTick, type: 'cc', channel, data1: 64, data2: 0 });
                    });
                    
                    console.log(`[PlaybackEngine] Applied CC64 Sustain for Signature Ending at beat ${chord.startBeat}`);
                }
            });
        }

        // 🌟 Luis's Fake Sidechain (CC 11)
        if (song.styleId !== undefined) {
            const needsSidechain = styleConfig.orchestration?.mixingPreferences?.requireSidechain ?? false;
            
            if (needsSidechain && song.drums) {
                song.drums.forEach(n => {
                    const isKick = n.pitch === 35 || n.pitch === 36;
                    if (isKick && n.velocity > 0.7) {
                        const startTick = globalMidiScheduler.beatsToTicks(n.onset + countInBeats);
                        
                        const injectSidechain = (channel: number) => {
                            // T: 40
                            allEvents.push({ ticks: startTick, type: 'cc', channel, data1: 11, data2: 40 });
                            // T + 30ms
                            const tick30 = startTick + globalMidiScheduler.beatsToTicks(0.03 * (song.bpm / 60));
                            allEvents.push({ ticks: tick30, type: 'cc', channel, data1: 11, data2: 65 });
                            // T + 80ms
                            const tick80 = startTick + globalMidiScheduler.beatsToTicks(0.08 * (song.bpm / 60));
                            allEvents.push({ ticks: tick80, type: 'cc', channel, data1: 11, data2: 100 });
                            // T + 150ms
                            const tick150 = startTick + globalMidiScheduler.beatsToTicks(0.15 * (song.bpm / 60));
                            allEvents.push({ ticks: tick150, type: 'cc', channel, data1: 11, data2: 127 });
                        };

                        const bassChannel = bassSynthFn().channel;
                        injectSidechain(bassChannel);

                        const accompChannel = accompSynthFn().channel;
                        injectSidechain(accompChannel);

                        if (song.pad && song.palette?.padSound) {
                            const padSynthSC = this.instruments.getInstrument(song.palette.padSound, 'Midground', 'pad', mixing.pad);
                            const padChannel = padSynthSC.channel;
                            injectSidechain(padChannel);
                        }
                    }
                });
            }
        }

        if (options?.withCountIn) {
            const totalBeats = countInBeats + Math.ceil(maxOnset);
            for (let i = 0; i < totalBeats; i++) {
                const startTick = globalMidiScheduler.beatsToTicks(i);
                const activeSynth: any = drumSynthFn();
                const channel = activeSynth.channel;
                const vel = i < countInBeats ? 127 : 76;
                
                allEvents.push({
                    ticks: startTick,
                    type: 'noteOn',
                    channel: channel,
                    data1: 42, // Closed hi-hat
                    data2: vel
                });
                allEvents.push({
                    ticks: startTick + globalMidiScheduler.beatsToTicks(0.1),
                    type: 'noteOff',
                    channel: channel,
                    data1: 42,
                    data2: 0
                });
            }
        }

        // 🌟 ST-3: Intro Filter Build-up — CC74 (Brightness/Cutoff) 低通涌动
        // 在 Intro 期间注入 CC74 从 20 �� 127 的渐变曲线，让声音从"闷"逐渐变"亮"
        if (song.introFilterSweep && song.sections) {
            const introSec = song.sections.find(s => s.name && s.name.startsWith('Intro'));
            if (introSec) {
                const countInBeats = options?.withCountIn ? (song.timeSignature?.[0] || 4) : 0;
                const introStartTick = globalMidiScheduler.beatsToTicks(introSec.startBeat + countInBeats);
                const introEndTick = globalMidiScheduler.beatsToTicks(introSec.endBeat + countInBeats);
                const steps = 16; // 16 步 CC 自动化，足够��滑
                const ccStart = 20;  // 极度低通
                const ccEnd = 127;   // 全开

                for (let s = 0; s <= steps; s++) {
                    const tick = introStartTick + Math.floor((introEndTick - introStartTick) * s / steps);
                    const value = Math.round(ccStart + (ccEnd - ccStart) * (s / steps));
                    // 对所有非鼓通道（0-8, 10-15）注入 CC74，跳过 GM 鼓通道 9
                    for (let ch = 0; ch < 16; ch++) {
                        if (ch === 9) continue;
                        allEvents.push({ ticks: tick, type: 'cc', channel: ch, data1: 74, data2: value });
                    }
                }

                // Intro 结束后确��� CC74 恢复到默认值 127（防止影��后续段落）
                for (let ch = 0; ch < 16; ch++) {
                    if (ch === 9) continue;
                    allEvents.push({ ticks: introEndTick + 1, type: 'cc', channel: ch, data1: 74, data2: 127 });
                }
            }
        }

        globalMidiScheduler.loadTrack(allEvents, song.bpm, song.tempoCurves);
    }

    public async appendSongChunk(song: ArrangedTrack) {
        // Append logic can be implemented by adding to globalMidiScheduler events
        // For now, this is a placeholder as the architecture shifts to full generation
        console.warn("[PlaybackEngine] appendSongChunk is not fully supported in MidiScheduler yet.");
    }

    public setNextBlockTrigger(triggerBeat: number, callback: () => void) {
        if (this.isStopped) return;
        // Add a visual event that triggers the callback
        const triggerTick = globalMidiScheduler.beatsToTicks(triggerBeat);
        // We can't easily inject a callback into MidiEvent, but we can use visualData
        // However, a simpler way is to just use setTimeout based on current time and BPM
        // Or add a custom event type to MidiScheduler.
        // For now, let's just use a timeout
        const msPerBeat = 60000 / globalMidiScheduler.getBpm();
        const currentBeat = globalMidiScheduler.getCurrentTick() / globalMidiScheduler.ppq;
        const beatsToWait = triggerBeat - currentBeat;
        if (beatsToWait > 0) {
            setTimeout(callback, beatsToWait * msPerBeat);
        } else {
            callback();
        }
    }

    public play() { 
        if (!this.isStopped) globalMidiScheduler.start(); 
    }

    public getDuration(): number {
        return this.totalDurationSeconds;
    }

    public stop() {
        this.isStopped = true;
        globalMidiScheduler.stop();
    }

    public getPartChannelMap(): PartChannelMap | null {
        return this._partChannelMap;
    }
}
