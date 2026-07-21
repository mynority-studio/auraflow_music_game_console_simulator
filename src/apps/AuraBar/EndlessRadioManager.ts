import { AudioEngine } from '../../core/audio/AudioEngine';
import { StyleId } from '../../core/generation/config/StyleFlags';
import { GlobalContext } from '../../core/generation/GlobalContext';
import { globalMidiScheduler } from '../../core/audio/MidiScheduler';
// ★ Q+N 主链路(qn_main_engine_takeover §9):AuraBar 走 MusicGenerationService + AudioEngine.playMusicGeneration。
//   播放视图走 Q+N PlaybackSong。
import { generateMusic } from '../../core/generation/musicGeneration/MusicGenerationService';
import type { MusicGenerationResult } from '../../core/generation/musicGeneration/types';
import { toPlaybackSong, type PlaybackSong } from '../../core/generation/musicGeneration/playbackView';

export type AppState = 'IDLE' | 'GENERATING' | 'PLAYING' | 'PREPARING_JAM' | 'JAMMING_DRUMS' | 'JAMMING_MELODY';

// bar 主题 StyleId → Q+N styleHint 映射。多风格 bar 随机选其一。
const STYLE_HINT_BY_ID: Partial<Record<StyleId, string>> = {
  [StyleId.ModernPop]: 'pop',
  [StyleId.ChillJazz]: 'jazz',
  [StyleId.NeoSoul]: 'rnb',
};

export class EndlessRadioManager {
  private state: AppState = 'IDLE';
  // history 存 Q+N 产物(MusicGenerationResult + styleName),供 prev/next 导航。
  private history: { result: MusicGenerationResult, styleName: string }[] = [];
  private historyIndex: number = -1;
  private generationId: number = 0;

  public currentStyleHint?: string;
  public currentSong?: PlaybackSong;  // ★ Q+N 播放视图(段/bpm/key/拍号)

  private stateChangeCallback?: (state: AppState) => void;
  public onStyleChange?: (styleName: string) => void;

  private allowedStyleIds: StyleId[] = [];

  // --- Jam Mode Recording State ---
  public userDrumPattern: { note: number, velocity: number, tick: number }[] = [];
  public jamStartTick: number = 0;
  public jamLengthTicks: number = 0;
  private originalDrumEvents: any[] = [];

  constructor(allowedStyleIds?: StyleId[]) {
    if (allowedStyleIds && allowedStyleIds.length > 0) {
      this.allowedStyleIds = allowedStyleIds;
    }
  }

  public setAllowedStyles(styleIds: StyleId[]) {
    this.allowedStyleIds = styleIds;
  }

  public onStateChange(callback: (state: AppState) => void) {
    this.stateChangeCallback = callback;
  }

  private setState(newState: AppState) {
    this.state = newState;
    if (this.stateChangeCallback) {
      this.stateChangeCallback(this.state);
    }
  }

  public getState(): AppState {
    return this.state;
  }

  public start = () => {
    if (this.state === 'IDLE') {
      this.triggerGeneration();
    }
  }

  private jamCheckInterval: any = null;

  public getCurrentChord(): any {
    // 当前播放视图不填 chords → 本方法恒返回 null(和弦显示惰性)。
    // 如需启用,可从 currentMusicGeneration.uiSnapshot.chords 派生(单独决策)。
    return null;
  }

  public stopPlayback = () => {
    this.generationId += 1;
    if (this.jamCheckInterval) {
        clearInterval(this.jamCheckInterval);
        this.jamCheckInterval = null;
    }
    AudioEngine.muteChannel(9, false);
    AudioEngine.muteChannel(1, false);
    AudioEngine.stop(); // ★ Q+N:统一停(内部停 globalMidiScheduler)
    this.setState('IDLE');
  }

  public stop = () => {
    this.stopPlayback();
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
    const beatsPerMeasure = timeSignature[0];
    const ticksPerMeasure = timeSignature[0] * (ppq * 4 / timeSignature[1]);

    // Calculate the start of the NEXT measure
    const currentMeasure = Math.floor(currentTick / ticksPerMeasure);
    const nextMeasureStartTick = (currentMeasure + 1) * ticksPerMeasure;
    
    // The count-in happens during the next measure
    const countInMeasureStartTick = nextMeasureStartTick;
    const jamStartTick = countInMeasureStartTick + ticksPerMeasure;

    if (type === 'drums' || type === 'melody') {
        this.jamStartTick = jamStartTick;
        
        // 1. Inject Count-in events (4 Crashes + Drum Fill)
        const ticksPerBeat = ppq * 4 / timeSignature[1];
        const fillEvents: any[] = [];
        
        for (let i = 0; i < beatsPerMeasure; i++) {
            const tick = countInMeasureStartTick + i * ticksPerBeat;
            // 4 Crashes on the beat
            fillEvents.push({ ticks: tick, type: 'noteOn', channel: 9, data1: 49, data2: 127 }); // Crash
            fillEvents.push({ ticks: tick + ppq/2, type: 'noteOff', channel: 9, data1: 49, data2: 0 });
            fillEvents.push({ ticks: tick, type: 'noteOn', channel: 9, data1: 36, data2: 100 }); // Kick
            fillEvents.push({ ticks: tick + ppq/2, type: 'noteOff', channel: 9, data1: 36, data2: 0 });
            
            // Drum fill on the last beat (e.g., 4th beat)
            if (i === beatsPerMeasure - 1) {
                // 16th note snare roll
                for (let j = 0; j < 4; j++) {
                    const subTick = tick + j * (ticksPerBeat / 4);
                    fillEvents.push({ ticks: subTick, type: 'noteOn', channel: 9, data1: 38, data2: 100 + j * 8 }); // Crescendo snare
                    fillEvents.push({ ticks: subTick + (ticksPerBeat / 8), type: 'noteOff', channel: 9, data1: 38, data2: 0 });
                }
            }
        }
        
        // Replace system drums during the count-in measure
        AudioEngine.replaceChannelEvents(9, countInMeasureStartTick, fillEvents, jamStartTick);

        if (type === 'drums') {
            // 2. Generate Closed Hi-Hat (42) events from jamStartTick to the end of the song
            const lastSection = this.currentSong.sections[this.currentSong.sections.length - 1];
            const totalTicks = lastSection ? lastSection.endBeat * ppq : 0;
            const hihatEvents: any[] = [];
            
            for (let tick = jamStartTick; tick < totalTicks; tick += ppq / 2) { // 8th notes
                hihatEvents.push({ ticks: tick, type: 'noteOn', channel: 9, data1: 42, data2: 70 });
                hihatEvents.push({ ticks: tick + ppq/4, type: 'noteOff', channel: 9, data1: 42, data2: 0 });
                hihatEvents.push({ 
                    ticks: tick, 
                    type: 'visual', 
                    channel: 9, 
                    data1: 42, 
                    data2: 70,
                    visualData: { type: 'drums', midiNote: 42, velocity: 70, source: 'system' }
                });
            }

            // Replace system drums with hi-hats from jamStartTick
            AudioEngine.replaceChannelEvents(9, jamStartTick, hihatEvents);
        }
    }

    if (this.jamCheckInterval) {
        clearInterval(this.jamCheckInterval);
    }

    // Schedule the transition to JAM state
    this.jamCheckInterval = setInterval(() => {
        if (this.state !== 'PREPARING_JAM' && this.state !== 'JAMMING_DRUMS' && this.state !== 'JAMMING_MELODY') {
            clearInterval(this.jamCheckInterval);
            this.jamCheckInterval = null;
            return;
        }
        
        const currentTick = AudioEngine.getCurrentTick();

        if (currentTick >= jamStartTick && this.state === 'PREPARING_JAM') {
            if (type === 'drums') {
                this.setState('JAMMING_DRUMS');
            } else {
                // Mute melody channels (assuming channel 0 for lead, maybe others)
                // For now, let's mute channel 0
                AudioEngine.muteChannel(1, true); 
                this.setState('JAMMING_MELODY');
            }
        }
    }, 50); // Check frequently
  }

  public exitJam() {
    console.log(`[Jam Mode] exitJam called. Current state: ${this.state}`);
    if (this.state === 'JAMMING_DRUMS' || this.state === 'JAMMING_MELODY' || this.state === 'PREPARING_JAM') {
        if (this.jamCheckInterval) {
            clearInterval(this.jamCheckInterval);
            this.jamCheckInterval = null;
        }
        
        AudioEngine.muteChannel(9, false);
        AudioEngine.muteChannel(1, false);
        
        if (this.state === 'PREPARING_JAM' && this.originalDrumEvents) {
            console.log(`[Jam Mode] Exited during preparation. Resuming original drums.`);
            const originalEventsToRestore = this.originalDrumEvents.filter(e => e.ticks >= this.jamStartTick);
            AudioEngine.replaceChannelEvents(9, this.jamStartTick, originalEventsToRestore);
        }
        
        // Calculate jam length based on current tick
        if (this.state === 'JAMMING_DRUMS' && this.jamStartTick > 0) {
            try {
                const currentTick = AudioEngine.getCurrentTick();
                const ppq = AudioEngine.getPpq();
                const timeSignature = GlobalContext.currentTimeSignature || [4, 4];
                const ticksPerMeasure = timeSignature[0] * (ppq * 4 / timeSignature[1]);
                
                // Round to the nearest measure to avoid empty measures if user is slightly late
                const elapsedTicks = currentTick - this.jamStartTick;
                const measures = Math.max(1, Math.round(elapsedTicks / ticksPerMeasure));
                this.jamLengthTicks = measures * ticksPerMeasure;
                
                console.log(`[Jam Mode] Recorded ${this.userDrumPattern.length} notes over ${measures} measures.`);
                
                // Apply the recorded drum loop with dynamic adaptation
                this.applyUserDrumLoop();
            } catch (e) {
                console.error(`[Jam Mode] Error applying user drum loop:`, e);
            }
        }
        
        this.setState('PLAYING');
    }
  }

  private applyUserDrumLoop() {
      if (!this.currentSong) return;

      const currentTick = AudioEngine.getCurrentTick();

      if (this.userDrumPattern.length === 0) {
          console.log(`[Jam Mode] No drum notes recorded. Resuming original drums.`);
          const originalEventsToRestore = this.originalDrumEvents.filter(e => e.ticks >= this.jamStartTick);
          AudioEngine.replaceChannelEvents(9, this.jamStartTick, originalEventsToRestore);
          return;
      }

      // Filter out any notes that were played after the calculated loop length
      const validPattern = this.userDrumPattern.filter(hit => hit.tick < this.jamLengthTicks);
      if (validPattern.length === 0) {
          console.log(`[Jam Mode] No valid drum notes within the loop length. Resuming original drums.`);
          const originalEventsToRestore = this.originalDrumEvents.filter(e => e.ticks >= this.jamStartTick);
          AudioEngine.replaceChannelEvents(9, this.jamStartTick, originalEventsToRestore);
          return;
      }

      const ppq = AudioEngine.getPpq();
      const lastSection = this.currentSong.sections[this.currentSong.sections.length - 1];
      const totalTicks = lastSection ? lastSection.endBeat * ppq : 0;

      console.log(`[Jam Mode] applyUserDrumLoop: currentTick=${currentTick}, jamStartTick=${this.jamStartTick}, jamLengthTicks=${this.jamLengthTicks}, totalTicks=${totalTicks}, validPatternLength=${validPattern.length}`);

      // We start generating the loop from jamStartTick to ensure the pattern aligns perfectly
      // with the musical grid.
      const loopStartTick = this.jamStartTick;

      const newDrumEvents: any[] = [];

      // Loop the pattern until the end of the song
      for (let tick = loopStartTick; tick < totalTicks; tick += this.jamLengthTicks) {
          const currentBeat = tick / ppq;
          
          // Find the current section to apply dynamic adaptation
          const section = this.currentSong.sections.find(s => currentBeat >= s.startBeat && currentBeat < s.endBeat) || this.currentSong.sections[0];
          
          const isBuild = section.name.toLowerCase().includes('build');

          // 1. Add crash at the start of high energy sections
          for (const s of this.currentSong.sections) {
              const isChorusSection = s.energyLevel >= 8 || s.name.toLowerCase().includes('chorus');
              if (isChorusSection) {
                  const sectionStartTick = s.startBeat * ppq;
                  if (sectionStartTick >= tick && sectionStartTick < tick + this.jamLengthTicks) {
                      newDrumEvents.push({ ticks: sectionStartTick, type: 'noteOn', channel: 9, data1: 49, data2: 120 });
                      newDrumEvents.push({ ticks: sectionStartTick + ppq/2, type: 'noteOff', channel: 9, data1: 49, data2: 0 });
                      newDrumEvents.push({ 
                          ticks: sectionStartTick, 
                          type: 'visual', 
                          channel: 9, 
                          data1: 49, 
                          data2: 120,
                          visualData: { type: 'drums', midiNote: 49, velocity: 120, source: 'system' }
                      });
                  }
              }
          }

          // 2. Loop the user's recorded pattern
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
              let shouldPlay = true;

              // --- Algorithmic Dynamic Adaptation ---
              if (hitIsBreakdown) {
                  // Breakdown: Soften kicks and snares, keep hi-hats
                  if (note === 36) velocity = Math.floor(velocity * 0.6); // Softer kick instead of removing
                  if (note === 38) { 
                      note = 37; // Snare -> Side stick
                      velocity = Math.floor(velocity * 0.7); 
                  } 
              } else if (hitIsBuild) {
                  // Build-up: Increase velocity
                  velocity = Math.min(127, velocity + 20);
              } else if (hitIsChorus) {
                  // Chorus: Maximize velocity for impact
                  velocity = Math.min(127, velocity + 10);
              }

              if (shouldPlay) {
                  newDrumEvents.push({ ticks: hitTick, type: 'noteOn', channel: 9, data1: note, data2: velocity });
                  newDrumEvents.push({ ticks: hitTick + ppq/4, type: 'noteOff', channel: 9, data1: note, data2: 0 });
                  newDrumEvents.push({ 
                      ticks: hitTick, 
                      type: 'visual', 
                      channel: 9, 
                      data1: note, 
                      data2: velocity,
                      visualData: { type: 'drums', midiNote: note, velocity: velocity, source: 'system' }
                  });
              }
          }

          // 3. Add Snare Roll for Build-up at the end of the loop
          if (isBuild) {
              // Add 16th note snares for the last beat of the loop
              const lastBeatTick = tick + this.jamLengthTicks - ppq;
              for (let i = 0; i < 4; i++) {
                  const rollTick = lastBeatTick + (i * ppq / 4);
                  if (rollTick < totalTicks) {
                      const rollVel = 80 + i * 10;
                      newDrumEvents.push({ ticks: rollTick, type: 'noteOn', channel: 9, data1: 38, data2: rollVel });
                      newDrumEvents.push({ ticks: rollTick + ppq/8, type: 'noteOff', channel: 9, data1: 38, data2: 0 });
                      newDrumEvents.push({ 
                          ticks: rollTick, 
                          type: 'visual', 
                          channel: 9, 
                          data1: 38, 
                          data2: rollVel,
                          visualData: { type: 'drums', midiNote: 38, velocity: rollVel, source: 'system' }
                      });
                  }
              }
          }
      }

      // Replace all future drum events with the adapted user loop
      console.log(`[Jam Mode] Generated ${newDrumEvents.length} new drum events. First few:`, newDrumEvents.slice(0, 5));
      AudioEngine.replaceChannelEvents(9, this.jamStartTick, newDrumEvents);
      console.log(`[Jam Mode] Applied user drum loop from tick ${loopStartTick} to end of track with dynamic adaptation.`);
  }

  public recordUserDrum(note: number, velocity: number) {
      if (this.state !== 'JAMMING_DRUMS' || this.jamStartTick === 0) return;
      
      const currentTick = AudioEngine.getCurrentTick();
      const ppq = AudioEngine.getPpq();
      const gridSize = ppq / 4; // 16th note quantization
      
      // Quantize to nearest grid point
      const quantizedTick = Math.round(currentTick / gridSize) * gridSize;
      const relativeTick = quantizedTick - this.jamStartTick;
      
      // Only record if it's not negative (before jam started)
      if (relativeTick >= 0) {
          this.userDrumPattern.push({ note, velocity, tick: relativeTick });
      }
  }

  private async playNewEngine(result: MusicGenerationResult, styleName: string, genId: number) {
    this.currentStyleHint = result.styleHint;
    if (this.onStyleChange) {
      this.onStyleChange(styleName);
    }

    // ★ Q+N 播放视图:段(prepareJam 定时/段命中用)取自 uiSnapshot。
    this.currentSong = toPlaybackSong(result);

    // ★ Q+N 正式播放:走 AudioEngine.playMusicGeneration(MusicalIR + uiSnapshot + 视觉)。
    const playId = await AudioEngine.playMusicGeneration(result); // 返回本次实际启动的会话 id

    if (genId !== this.generationId) return; // 更 newer radio 会话已接管 → 由它管状态
    if (playId === null) { this.setState('IDLE'); return; } // 被非-radio 源(上传/切后端)超越 → 回 IDLE，不注册续播

    this.setState('PLAYING');

    // 一首播完 → 自动续下一首(无限电台);复用 globalMidiScheduler.onTrackEnd。
    // playId 校验：上传试听/切后端等超越本会话后，本 listener 不再续播（防跨源劫持）。
    globalMidiScheduler.onTrackEnd(() => {
      if (genId === this.generationId && AudioEngine.currentPlaybackId() === playId) {
        this.playNext();
      }
    });
  }

  // bar 的 styleIds → newEngine styleHint(多风格随机选一;空则回退 pop)。
  private resolveStyleHints(): string[] {
    const hints = (this.allowedStyleIds ?? [])
      .map((id) => STYLE_HINT_BY_ID[id])
      .filter((h): h is string => !!h);
    return hints.length > 0 ? hints : ['pop'];
  }

  public triggerGeneration = async () => {
    const currentGenId = ++this.generationId;

    AudioEngine.stop();
    this.setState('GENERATING');

    try {
      // Simulate slight delay for UI to catch up
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (currentGenId !== this.generationId) return;

      // 随机 seed:毫秒 ^ 随机熵 → newEngine 内部由该 seed 驱动确定性 RNG(同 seed 同曲,可复现)。
      const seed = (Date.now() ^ Math.floor(Math.random() * 1000000)) >>> 0;
      // 按 bar 主题映射 styleHint(ModernPop→pop / ChillJazz→jazz / NeoSoul→rnb),多风格 bar 随机选一。
      const hints = this.resolveStyleHints();
      const styleHint = hints[Math.floor(Math.random() * hints.length)];
      console.log(`[Radio/newEngine] seed=${seed} style=${styleHint}`);

      const result = await generateMusic({ seed, styleHint, mood: 'calm-build', targetDuration: 120 });
      if (currentGenId !== this.generationId) return;
      if (result.status === 'failed' || !result.ir) throw new Error('Q+N 生成失败');

      const styleName = styleHint.toUpperCase();
      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push({ result, styleName });
      this.historyIndex++;

      await this.playNewEngine(result, styleName, currentGenId);
    } catch (error) {
      console.error('newEngine generation failed:', error);
      if (currentGenId === this.generationId) {
        this.setState('IDLE');
      }
    }
  }

  public playNext = async () => {
    if (this.historyIndex < this.history.length - 1) {
      const currentGenId = ++this.generationId;
      AudioEngine.stop();
      this.setState('GENERATING');

      this.historyIndex++;
      const h = this.history[this.historyIndex];
      await this.playNewEngine(h.result, h.styleName, currentGenId);
    } else {
      // 无限电台:历史到头 → 生成新随机 seed
      this.triggerGeneration();
    }
  }

  public playPrevious = async () => {
    if (this.historyIndex > 0) {
      const currentGenId = ++this.generationId;
      AudioEngine.stop();
      this.setState('GENERATING');

      this.historyIndex--;
      const h = this.history[this.historyIndex];
      await this.playNewEngine(h.result, h.styleName, currentGenId);
    }
  }
}
