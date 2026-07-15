import { AudioEngine } from '../../core/audio/AudioEngine';
import { StyleId } from '../../core/generation/config/StyleFlags';
import { GlobalContext } from '../../core/generation/GlobalContext';
// ★ Q+N 主链路(qn_main_engine_takeover §10):AuraJam 录制 motif → generateMotifMusic(override.lead)→ playMusicGeneration。
import { generateMotifMusic } from '../../core/generation/musicGeneration/MusicGenerationService';
import { pcToKey } from '../../core/generation/musicGeneration/qnUiProjection';
import { toPlaybackSong, type PlaybackSong } from '../../core/generation/musicGeneration/playbackView';
import { NoteData } from '../../core/generation/types';
import { PRNGManager } from '../../core/utils/PRNG';
import { globalMidiScheduler } from '../../core/audio/MidiScheduler';
import { ScaleEngine, ScaleState } from './ScaleEngine';
import { MotifRecorder } from './MotifRecorder';
// bar 主题 styleId → Q+N styleHint。
const JAM_STYLE_HINT: Partial<Record<StyleId, string>> = {
    [StyleId.ModernPop]: 'pop', [StyleId.ChillJazz]: 'jazz', [StyleId.NeoSoul]: 'rnb',
};
// getStyleStage5Bundle 已不需要(motif 预处理 topologyConfig 已删 2026-05-24)

export type JamAppState =
    | 'SCALE_VIEW'
    | 'RECORDING'
    | 'GENERATING'
    | 'PLAYING'
    | 'PREPARING_JAM'
    | 'JAMMING_DRUMS'
    | 'JAMMING_MELODY';

export class JamSessionManager {
    private state: JamAppState = 'SCALE_VIEW';
    private stateChangeCallback?: (state: JamAppState) => void;
    private generationId: number = 0;

    public currentSong?: PlaybackSong;  // ★ Q+N 播放视图(取代旧 GeneratedTrack + StyleConfig 兼容投影)

    private scaleEngine: ScaleEngine;
    private recorder: MotifRecorder;

    // --- Jam Mode State (from EndlessRadioManager) ---
    public userDrumPattern: { note: number; velocity: number; tick: number }[] = [];
    public jamStartTick: number = 0;
    public jamLengthTicks: number = 0;
    private originalDrumEvents: any[] = [];
    private jamCheckInterval: any = null;

    constructor() {
        this.scaleEngine = new ScaleEngine();
        this.recorder = new MotifRecorder();
    }

    public onStateChange(callback: (state: JamAppState) => void) {
        this.stateChangeCallback = callback;
    }

    private setState(newState: JamAppState) {
        this.state = newState;
        if (this.stateChangeCallback) {
            this.stateChangeCallback(this.state);
        }
    }

    public getState(): JamAppState {
        return this.state;
    }

    public getScaleState(): ScaleState {
        return this.scaleEngine.getState();
    }

    // ================================================================
    // Scale View
    // ================================================================

    public refreshScale(): ScaleState {
        return this.scaleEngine.refresh(() => Math.random());
    }

    // ================================================================
    // Recording
    // ================================================================

    public startRecording(): void {
        this.recorder.start();
        this.setState('RECORDING');
    }

    public stopRecordingAndGenerate(): void {
        const motifNotes = this.recorder.stop();
        console.log(`[AuraJam] Recording stopped: ${motifNotes.length} notes captured`);
        if (motifNotes.length === 0) {
            console.log(`[AuraJam] No notes recorded, returning to SCALE_VIEW`);
            this.setState('SCALE_VIEW');
            return;
        }
        this.triggerGeneration(motifNotes);
    }

    public cancelRecording(): void {
        this.recorder.stop();
        this.setState('SCALE_VIEW');
    }

    public recordNoteOn(padIndex: number, midiNote: number, velocity: number): void {
        if (this.state !== 'RECORDING') return;
        this.recorder.noteOn(padIndex, midiNote, velocity);
    }

    public recordNoteOff(padIndex: number): void {
        if (this.state !== 'RECORDING') return;
        this.recorder.noteOff(padIndex);
    }

    public getRecordingInfo(): { eventCount: number; elapsedMs: number } {
        return {
            eventCount: this.recorder.getEventCount(),
            elapsedMs: this.recorder.getElapsedMs()
        };
    }

    // ================================================================
    // Generation + Playback
    // ================================================================

    private async triggerGeneration(motifNotes: NoteData[]): Promise<void> {
        const currentGenId = ++this.generationId;
        AudioEngine.stop();
        this.setState('GENERATING');

        try {
            await new Promise(resolve => setTimeout(resolve, 100));
            if (currentGenId !== this.generationId) return;

            const seed = (Date.now() ^ Math.floor(Math.random() * 1000000)) >>> 0;
            PRNGManager.setSeed(seed);
            // ACVE §5.1 — 入口快照点 A
            PRNGManager.recordSnapshot('A');

            const scaleState = this.scaleEngine.getState();

            const keyOffset = scaleState.key;

            // Style 随机选一个 → Q+N styleHint。
            const allStyleIds = [StyleId.ModernPop, StyleId.ChillJazz, StyleId.NeoSoul];
            const randomStyleId = allStyleIds[Math.floor(PRNGManager.next() * allStyleIds.length)];
            const styleHint = JAM_STYLE_HINT[randomStyleId] ?? 'pop';

            // ★ Q+N 续写(§10):用户录制 motif(绝对 MIDI)→ MotifLeadNote[](beats)→ override.lead。Q+N tile 满曲长
            //   + 预摆动 → 成为整编 lead;key/mode 由 Q+N 开局抽取,harmony/comp/bass/drum/pad/mix 按 style 生成。空 motif → 普通 Q+N 曲。
            const motifLead = motifNotes
                .filter((n) => n.duration > 0)
                .map((n) => ({
                    pitch: Math.round(n.pitch),
                    onsetBeat: n.onset,
                    durationBeat: Math.max(0.1, n.duration),
                    velocity: Math.max(1, Math.min(127, Math.round(n.velocity <= 1 ? n.velocity * 127 : n.velocity))),
                }));
            const result = await generateMotifMusic(
                { seed, styleHint, mood: 'build', targetDuration: 96 },
                motifLead.length ? { lead: motifLead } : {},
            );

            if (currentGenId !== this.generationId) return;
            if (result.status === 'failed' || !result.ir) throw new Error('Q+N motif 成曲失败');

            // ★ Q+N 播放视图:段(prepareJam 定时/段命中用)取自 uiSnapshot;不再假 GeneratedTrack/StyleConfig。
            this.currentSong = toPlaybackSong(result);

            const playId = await AudioEngine.playMusicGeneration(result); // 返回本次实际启动的会话 id

            if (currentGenId !== this.generationId) return; // 更 newer jam 会话已接管 → 由它管状态
            if (playId === null) { this.setState('SCALE_VIEW'); return; } // 被非-jam 源超越 → 回 SCALE_VIEW，不注册续播
            this.setState('PLAYING');

            globalMidiScheduler.onTrackEnd(() => {
                if (currentGenId === this.generationId && AudioEngine.currentPlaybackId() === playId) {
                    this.stopPlayback();
                }
            });
        } catch (error) {
            console.error('[AuraJam] Generation failed:', error);
            if (currentGenId === this.generationId) {
                this.setState('SCALE_VIEW');
            }
        }
    }

    public stopPlayback(): void {
        this.generationId++;
        if (this.jamCheckInterval) {
            clearInterval(this.jamCheckInterval);
            this.jamCheckInterval = null;
        }
        AudioEngine.muteChannel(9, false);
        AudioEngine.muteChannel(1, false);
        AudioEngine.stop();
        this.setState('SCALE_VIEW');
    }

    // ================================================================
    // Jam Mode (adapted from EndlessRadioManager)
    // ================================================================

    public getCurrentChord(): any {
        // 旧兼容投影从不填 chords → 本方法历来恒返回 null(和弦显示当前惰性)。迁移保持此行为。
        return null;
    }

    public prepareJam(type: 'drums' | 'melody') {
        if (this.state !== 'PLAYING' || !this.currentSong) return;

        this.setState('PREPARING_JAM');

        if (type === 'drums') {
            this.userDrumPattern = [];
            this.jamStartTick = 0;
            this.jamLengthTicks = 0;
            this.originalDrumEvents = AudioEngine.getChannelEvents(9);
        }

        const currentTick = AudioEngine.getCurrentTick();
        const ppq = AudioEngine.getPpq();
        const timeSignature = GlobalContext.currentTimeSignature || [4, 4];
        const ticksPerMeasure = timeSignature[0] * (ppq * 4 / timeSignature[1]);

        const currentMeasure = Math.floor(currentTick / ticksPerMeasure);
        const nextMeasureStartTick = (currentMeasure + 1) * ticksPerMeasure;
        const countInMeasureStartTick = nextMeasureStartTick;
        const jamStartTick = countInMeasureStartTick + ticksPerMeasure;

        this.jamStartTick = jamStartTick;

        AudioEngine.injectMidiEvent({ ticks: currentTick, type: 'cc', channel: 9, data1: 7, data2: 127 });

        // Count-in: Crash + Kick + Snare roll
        const beatsPerMeasure = timeSignature[0];
        const ticksPerBeat = ppq * 4 / timeSignature[1];
        const fillEvents: any[] = [];

        for (let i = 0; i < beatsPerMeasure; i++) {
            const tick = countInMeasureStartTick + i * ticksPerBeat;
            fillEvents.push({ ticks: tick, type: 'noteOn', channel: 9, data1: 49, data2: 127 });
            fillEvents.push({ ticks: tick + ppq / 2, type: 'noteOff', channel: 9, data1: 49, data2: 0 });
            fillEvents.push({ ticks: tick, type: 'noteOn', channel: 9, data1: 36, data2: 100 });
            fillEvents.push({ ticks: tick + ppq / 2, type: 'noteOff', channel: 9, data1: 36, data2: 0 });

            if (i === beatsPerMeasure - 1) {
                for (let j = 0; j < 4; j++) {
                    const subTick = tick + j * (ticksPerBeat / 4);
                    fillEvents.push({ ticks: subTick, type: 'noteOn', channel: 9, data1: 38, data2: 100 + j * 8 });
                    fillEvents.push({ ticks: subTick + (ticksPerBeat / 8), type: 'noteOff', channel: 9, data1: 38, data2: 0 });
                }
            }
        }

        AudioEngine.replaceChannelEvents(9, countInMeasureStartTick, fillEvents, jamStartTick);

        if (type === 'drums') {
            const lastSection = this.currentSong.sections[this.currentSong.sections.length - 1];
            const totalTicks = lastSection ? lastSection.endBeat * ppq : 0;
            const hihatEvents: any[] = [];

            for (let tick = jamStartTick; tick < totalTicks; tick += ppq / 2) {
                hihatEvents.push({ ticks: tick, type: 'noteOn', channel: 9, data1: 42, data2: 70 });
                hihatEvents.push({ ticks: tick + ppq / 4, type: 'noteOff', channel: 9, data1: 42, data2: 0 });
                hihatEvents.push({
                    ticks: tick, type: 'visual', channel: 9, data1: 42, data2: 70,
                    visualData: { type: 'drums', midiNote: 42, velocity: 70, source: 'system' }
                });
            }

            AudioEngine.replaceChannelEvents(9, jamStartTick, hihatEvents);
        }

        if (this.jamCheckInterval) {
            clearInterval(this.jamCheckInterval);
        }

        this.jamCheckInterval = setInterval(() => {
            if (this.state !== 'PREPARING_JAM' && this.state !== 'JAMMING_DRUMS' && this.state !== 'JAMMING_MELODY') {
                clearInterval(this.jamCheckInterval);
                this.jamCheckInterval = null;
                return;
            }
            const ct = AudioEngine.getCurrentTick();
            if (ct >= jamStartTick && this.state === 'PREPARING_JAM') {
                if (type === 'drums') {
                    this.setState('JAMMING_DRUMS');
                } else {
                    AudioEngine.muteChannel(1, true);
                    this.setState('JAMMING_MELODY');
                }
            }
        }, 50);
    }

    public exitJam() {
        if (this.state === 'JAMMING_DRUMS' || this.state === 'JAMMING_MELODY' || this.state === 'PREPARING_JAM') {
            if (this.jamCheckInterval) {
                clearInterval(this.jamCheckInterval);
                this.jamCheckInterval = null;
            }

            AudioEngine.muteChannel(9, false);
            AudioEngine.muteChannel(1, false);
            AudioEngine.injectMidiEvent({ ticks: AudioEngine.getCurrentTick(), type: 'cc', channel: 9, data1: 7, data2: 100 });

            if (this.state === 'PREPARING_JAM' && this.originalDrumEvents) {
                const restore = this.originalDrumEvents.filter((e: any) => e.ticks >= this.jamStartTick);
                AudioEngine.replaceChannelEvents(9, this.jamStartTick, restore);
            }

            if (this.state === 'JAMMING_DRUMS' && this.jamStartTick > 0) {
                try {
                    const currentTick = AudioEngine.getCurrentTick();
                    const ppq = AudioEngine.getPpq();
                    const timeSignature = GlobalContext.currentTimeSignature || [4, 4];
                    const ticksPerMeasure = timeSignature[0] * (ppq * 4 / timeSignature[1]);
                    const elapsedTicks = currentTick - this.jamStartTick;
                    const measures = Math.max(1, Math.round(elapsedTicks / ticksPerMeasure));
                    this.jamLengthTicks = measures * ticksPerMeasure;
                    this.applyUserDrumLoop();
                } catch (e) {
                    console.error('[AuraJam] Error applying user drum loop:', e);
                }
            }

            this.setState('PLAYING');
        }
    }

    public recordUserDrum(note: number, velocity: number) {
        if (this.state !== 'JAMMING_DRUMS' || this.jamStartTick === 0) return;
        const currentTick = AudioEngine.getCurrentTick();
        const ppq = AudioEngine.getPpq();
        const gridSize = ppq / 4;
        const quantizedTick = Math.round(currentTick / gridSize) * gridSize;
        const relativeTick = quantizedTick - this.jamStartTick;
        if (relativeTick >= 0) {
            this.userDrumPattern.push({ note, velocity, tick: relativeTick });
        }
    }

    private applyUserDrumLoop() {
        if (!this.currentSong) return;

        if (this.userDrumPattern.length === 0) {
            const restore = this.originalDrumEvents.filter((e: any) => e.ticks >= this.jamStartTick);
            AudioEngine.replaceChannelEvents(9, this.jamStartTick, restore);
            return;
        }

        const validPattern = this.userDrumPattern.filter(hit => hit.tick < this.jamLengthTicks);
        if (validPattern.length === 0) {
            const restore = this.originalDrumEvents.filter((e: any) => e.ticks >= this.jamStartTick);
            AudioEngine.replaceChannelEvents(9, this.jamStartTick, restore);
            return;
        }

        const ppq = AudioEngine.getPpq();
        const lastSection = this.currentSong.sections[this.currentSong.sections.length - 1];
        const totalTicks = lastSection ? lastSection.endBeat * ppq : 0;
        const loopStartTick = this.jamStartTick;
        const newDrumEvents: any[] = [];

        for (let tick = loopStartTick; tick < totalTicks; tick += this.jamLengthTicks) {
            // Crash at chorus starts
            for (const s of this.currentSong.sections) {
                const isChorus = s.energyLevel >= 8 || s.name.toLowerCase().includes('chorus');
                if (isChorus) {
                    const sTick = s.startBeat * ppq;
                    if (sTick >= tick && sTick < tick + this.jamLengthTicks) {
                        newDrumEvents.push({ ticks: sTick, type: 'noteOn', channel: 9, data1: 49, data2: 120 });
                        newDrumEvents.push({ ticks: sTick + ppq / 2, type: 'noteOff', channel: 9, data1: 49, data2: 0 });
                        newDrumEvents.push({
                            ticks: sTick, type: 'visual', channel: 9, data1: 49, data2: 120,
                            visualData: { type: 'drums', midiNote: 49, velocity: 120, source: 'system' }
                        });
                    }
                }
            }

            for (const hit of validPattern) {
                const hitTick = tick + hit.tick;
                if (hitTick >= totalTicks) continue;

                const hitBeat = hitTick / ppq;
                const hitSection = this.currentSong.sections.find(s => hitBeat >= s.startBeat && hitBeat < s.endBeat) || this.currentSong.sections[0];
                const hitIsBreakdown = hitSection.energyLevel < 5;
                const hitIsChorus = hitSection.energyLevel >= 8 || hitSection.name.toLowerCase().includes('chorus');
                const hitIsBuild = hitSection.name.toLowerCase().includes('build');

                let note = hit.note;
                let velocity = hit.velocity;

                if (hitIsBreakdown) {
                    if (note === 36) velocity = Math.floor(velocity * 0.6);
                    if (note === 38) { note = 37; velocity = Math.floor(velocity * 0.7); }
                } else if (hitIsBuild) {
                    velocity = Math.min(127, velocity + 20);
                } else if (hitIsChorus) {
                    velocity = Math.min(127, velocity + 10);
                }

                newDrumEvents.push({ ticks: hitTick, type: 'noteOn', channel: 9, data1: note, data2: velocity });
                newDrumEvents.push({ ticks: hitTick + ppq / 4, type: 'noteOff', channel: 9, data1: note, data2: 0 });
                newDrumEvents.push({
                    ticks: hitTick, type: 'visual', channel: 9, data1: note, data2: velocity,
                    visualData: { type: 'drums', midiNote: note, velocity, source: 'system' }
                });
            }

            // Build-up snare roll
            const currentBeat = tick / ppq;
            const section = this.currentSong.sections.find(s => currentBeat >= s.startBeat && currentBeat < s.endBeat);
            if (section && section.name.toLowerCase().includes('build')) {
                const lastBeatTick = tick + this.jamLengthTicks - ppq;
                for (let i = 0; i < 4; i++) {
                    const rollTick = lastBeatTick + (i * ppq / 4);
                    if (rollTick < totalTicks) {
                        const rollVel = 80 + i * 10;
                        newDrumEvents.push({ ticks: rollTick, type: 'noteOn', channel: 9, data1: 38, data2: rollVel });
                        newDrumEvents.push({ ticks: rollTick + ppq / 8, type: 'noteOff', channel: 9, data1: 38, data2: 0 });
                        newDrumEvents.push({
                            ticks: rollTick, type: 'visual', channel: 9, data1: 38, data2: rollVel,
                            visualData: { type: 'drums', midiNote: 38, velocity: rollVel, source: 'system' }
                        });
                    }
                }
            }
        }

        AudioEngine.replaceChannelEvents(9, this.jamStartTick, newDrumEvents);
    }
}
