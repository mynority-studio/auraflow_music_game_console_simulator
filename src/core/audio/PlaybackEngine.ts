// ==========================================
// 📄 文件路径: /src/core/audio/PlaybackEngine.ts
// 🌟 V3.0 纯 MIDI 调度版
// ==========================================
import { ArrangedTrack } from '../generation/types';
import { MidiConverter, ChannelMap, MidiEvent } from '../generation/MidiConverter';
import { AudioMixer } from './AudioMixer';
import { InstrumentRegistry } from './Instruments';
import { spessaSynth, startAudioContext } from './SynthManager';
import { globalMidiScheduler } from './MidiScheduler';
import { InstrumentId, InstrumentIdName } from '../generation/config/InstrumentFlags';

export interface VisualEvent { type: 'melody' | 'pianoLH' | 'pianoRH' | 'drums' | 'bass' | 'counterMelody' | 'confirm' | 'custom_particle' | 'fn_key_active'; midiNote?: number; velocity?: number; col?: number; row?: number; hue?: number; energy?: number; spread?: number; source?: 'playback' | 'gameplay'; time?: number; onset?: number; isUserMotif?: boolean; active?: boolean; }
export type VisualEventListener = (event: VisualEvent) => void;


export class PlaybackEngine {
    private mixer: AudioMixer;
    private instruments: InstrumentRegistry;
    private visualListeners: VisualEventListener[] =[];
    private isStopped: boolean = false;
    private totalDurationSeconds: number = 0;
    private drumDucking: boolean = false;

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
        this.isStopped = false;
        await startAudioContext();
        
        // --- 打印歌曲元数据 ---
        console.log("========================================");
        console.log("🎵 歌曲生成完毕，开始播放 🎵");
        console.log(`MixStyle: ${song.mixStyle || 'default'}`);
        console.log(`BPM: ${song.bpm}`);
        console.log(`Key: ${song.key}`);
        console.log(`Time Signature: ${song.timeSignature ? song.timeSignature.join('/') : '4/4'}`);
        
        console.log("--- 使用的乐器 ---");
        const mixing = song.palette?.mixing || {};
        const printInstrument = (role: string, sound?: InstrumentId | null, mix?: any) => {
            if (sound !== undefined && sound !== null) {
                const name = InstrumentIdName[sound] || `Unknown(${sound})`;
                const pan = mix?.pan !== undefined ? mix.pan : 0;
                const panStr = pan === 0 ? 'Center' : (pan < 0 ? `Left ${Math.abs(pan)}` : `Right ${pan}`);
                console.log(`- ${role}: ${name} (Pan: ${panStr})`);
            }
        };
        printInstrument('Vocal', song.palette?.vocalSound, mixing.vocal);
        printInstrument('Melody', song.palette?.melodySound, mixing.melody);
        printInstrument('Secondary Melody', song.palette?.secondaryMelodySound, mixing.secondaryMelody);
        printInstrument('Chord', song.palette?.chordSound, mixing.chord);
        printInstrument('Bass', song.palette?.bassSound, mixing.bass);
        printInstrument('Drums', song.palette?.drumSound, mixing.drums);
        printInstrument('Counter Melody', song.palette?.counterMelodySound, mixing.counterMelody);

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

                printTrackNotes(song.melody, 'melody');
                printTrackNotes(song.secondaryMelody, 'secondaryMelody');
                printTrackNotes(song.counterMelody, 'counterMelody');
                printTrackNotes(song.pianoLH, 'bass');
            });
        }
        console.log("========================================");
        // ----------------------

        if (spessaSynth) {
            this.mixer.connectSpessaSynth(spessaSynth);
        }
        
        // 🌟 0. Set Mix Style based on song.mixStyle
        this.mixer.setMixStyle(song.mixStyle || 'default');

        // 🌟 1. 抽卡聘请总调音师 (Mastering)
        const selectedProfile = 'Recording_Studio';
        await this.mixer.applyMasteringProfile(selectedProfile);

        // 🌟 2. 获取采样器 (100% Soundfont)
        
        const vocalSynth = (song.palette?.vocalSound !== undefined && song.palette?.vocalSound !== null) ? this.instruments.getInstrumentById(song.palette.vocalSound, 'Foreground', 'vocal', mixing.vocal) : null;
        const melodySynth = this.instruments.getInstrumentById(song.palette?.melodySound ?? InstrumentId.Acoustic_Grand, (song.palette?.vocalSound !== undefined && song.palette?.vocalSound !== null) ? 'Midground' : 'Foreground', 'melody', mixing.melody);
        const chordSynth = this.instruments.getInstrumentById(song.palette?.chordSound ?? InstrumentId.Warm_EP, 'Midground', 'chord', mixing.chord);

        // 🌟 3. 独立 Bass 采样器：根据乐器家族选择电贝斯或原声贝斯
        const bassSynth = this.instruments.getInstrumentById(song.palette?.bassSound ?? InstrumentId.Electric_Bass_Finger, 'Rhythm', 'bass', mixing.bass);
        const drumSynth = this.instruments.getInstrumentById(song.palette?.drumSound ?? InstrumentId.Standard_DrumKit, 'Rhythm', 'drums', mixing.drums); 

        if (this.isStopped) return;

        globalMidiScheduler.stop();

        const countInBeats = options?.withCountIn ? 4 : 0;

        // 构建通道映射表（平台层职责：synth channel 分配）
        // -1 表示该轨道无乐器，MidiConverter 通过 if (song.xxx) 守卫不会向 -1 通道发送事件
        const channelMap: ChannelMap = {
            vocal: vocalSynth ? vocalSynth.channel : -1,
            melody: melodySynth.channel,
            secondaryMelody: song.secondaryMelody && (song.palette?.secondaryMelodySound !== undefined && song.palette?.secondaryMelodySound !== null)
                ? this.instruments.getInstrumentById(song.palette.secondaryMelodySound, 'Foreground', 'secondaryMelody', mixing.secondaryMelody).channel
                : -1,
            chord: chordSynth.channel,
            bass: bassSynth.channel,
            drums: drumSynth.channel,
            counterMelody: song.counterMelody && (song.palette?.counterMelodySound !== undefined && song.palette?.counterMelodySound !== null)
                ? this.instruments.getInstrumentById(song.palette.counterMelodySound, 'Midground', 'counterMelody', mixing.counterMelody).channel
                : -1,
        };

        // 生成管道第四模块：纯数据转换
        const allEvents = MidiConverter.convert(song, channelMap, { countInBeats, drumDucking: this.drumDucking });

        // 计算总时长
        let maxOnset = 0;
        const tracks = [song.vocal, song.melody, song.secondaryMelody, song.pianoLH, song.pianoRH, song.drums, song.counterMelody, song.userMotif];
        for (const t of tracks) {
            if (t) for (const n of t) {
                const end = n.onset + (n.duration || 0.5);
                if (end > maxOnset) maxOnset = end;
            }
        }
        this.totalDurationSeconds = (maxOnset + countInBeats) * (60 / song.bpm);

        if (options?.loopStart !== undefined && options?.loopEnd !== undefined) {
            globalMidiScheduler.loop = true;
            globalMidiScheduler.loopStartTicks = globalMidiScheduler.beatsToTicks(options.loopStart + countInBeats);
            globalMidiScheduler.loopEndTicks = globalMidiScheduler.beatsToTicks(options.loopEnd + countInBeats);
        } else {
            globalMidiScheduler.loop = false;
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
}
