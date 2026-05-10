import { AudioEngine } from '../../core/audio/AudioEngine';
import { StyleId } from '../../core/generation/config/StyleFlags';
import { AcgStyleConfig } from '../../core/generation/config/StyleRegistry';
import { GlobalContext } from '../../core/generation/GlobalContext';
import { MelodyEngine } from '../../core/generation/MelodyEngine';
// removed
import { GeneratedTrack, StyleConfig, MusicContext } from '../../core/generation/types';
import { PRNGManager } from '../../core/utils/PRNG';
import { globalMidiScheduler } from '../../core/audio/MidiScheduler';

export type AppState = 'IDLE' | 'GENERATING' | 'PLAYING' | 'PREPARING_JAM' | 'JAMMING_DRUMS' | 'JAMMING_MELODY';

export class EndlessRadioManager {
  private state: AppState = 'IDLE';
  private history: { track: GeneratedTrack, context: MusicContext, style: StyleConfig }[] = [];
  private historyIndex: number = -1;
  private generationId: number = 0;
  
  public currentTrack?: GeneratedTrack;
  public currentStyle?: StyleConfig;

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
    if (!this.currentTrack || !this.currentTrack.chords) return null;
    const currentTick = AudioEngine.getCurrentTick();
    const ppq = AudioEngine.getPpq();
    const currentBeat = currentTick / ppq;
    for (const chord of this.currentTrack.chords) {
        if (currentBeat >= chord.startBeat && currentBeat < chord.endBeat) {
            return chord;
        }
    }
    return null;
  }

  public stopPlayback = () => {
    this.generationId += 1;
    if (this.jamCheckInterval) {
        clearInterval(this.jamCheckInterval);
        this.jamCheckInterval = null;
    }
    AudioEngine.muteChannel(9, false);
    AudioEngine.muteChannel(0, false);
    AudioEngine.stop();
    this.setState('IDLE');
  }

  public stop = () => {
    this.stopPlayback();
  }

  public prepareJam(type: 'drums' | 'melody') {
    if (this.state !== 'PLAYING' || !this.currentTrack || !this.currentStyle) return;
    
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
        
        // Increase drum channel volume to max
        AudioEngine.injectMidiEvent({ ticks: currentTick, type: 'controlChange', channel: 9, data1: 7, data2: 127 });
        
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
            const lastSection = this.currentTrack.sections[this.currentTrack.sections.length - 1];
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
                AudioEngine.muteChannel(0, true); 
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
        AudioEngine.muteChannel(0, false);
        
        // Restore drum channel volume to normal
        AudioEngine.injectMidiEvent({ ticks: AudioEngine.getCurrentTick(), type: 'controlChange', channel: 9, data1: 7, data2: 100 });
        
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
      if (!this.currentTrack || !this.currentStyle) return;

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
      const lastSection = this.currentTrack.sections[this.currentTrack.sections.length - 1];
      const totalTicks = lastSection ? lastSection.endBeat * ppq : 0;

      console.log(`[Jam Mode] applyUserDrumLoop: currentTick=${currentTick}, jamStartTick=${this.jamStartTick}, jamLengthTicks=${this.jamLengthTicks}, totalTicks=${totalTicks}, validPatternLength=${validPattern.length}`);

      // Align loop start to the nearest measure boundary to ensure it stays in sync
      const timeSignature = GlobalContext.currentTimeSignature || [4, 4];
      
      // We start generating the loop from jamStartTick to ensure the pattern aligns perfectly
      // with the musical grid.
      const loopStartTick = this.jamStartTick;

      const newDrumEvents: any[] = [];

      // Loop the pattern until the end of the song
      for (let tick = loopStartTick; tick < totalTicks; tick += this.jamLengthTicks) {
          const currentBeat = tick / ppq;
          
          // Find the current section to apply dynamic adaptation
          const section = this.currentTrack.sections.find(s => currentBeat >= s.startBeat && currentBeat < s.endBeat) || this.currentTrack.sections[0];
          
          const isBuild = section.name.toLowerCase().includes('build');

          // 1. Add crash at the start of high energy sections
          for (const s of this.currentTrack.sections) {
              const isChorusSection = s.energyLevel >= 0.8 || s.name.toLowerCase().includes('chorus');
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
              const hitSection = this.currentTrack.sections.find(s => hitBeat >= s.startBeat && hitBeat < s.endBeat) || this.currentTrack.sections[0];
              const hitIsBreakdown = hitSection.energyLevel < 0.5;
              const hitIsChorus = hitSection.energyLevel >= 0.8 || hitSection.name.toLowerCase().includes('chorus');
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

  private async playTrack(track: GeneratedTrack, context: MusicContext, style: StyleConfig, genId: number) {
    const melodyEngine = new MelodyEngine();
    
    this.currentTrack = track;
    this.currentStyle = style;

    if (this.onStyleChange) {
      this.onStyleChange(style.name);
    }

    await AudioEngine.playSong(track, style.id, context, melodyEngine);
    
    if (genId !== this.generationId) return;
    
    this.setState('PLAYING');

    // Schedule next song using MidiScheduler's onTrackEnd
    globalMidiScheduler.onTrackEnd(() => {
      if (genId === this.generationId) {
        this.playNext();
      }
    });
  }

  public triggerGeneration = async () => {
    const currentGenId = ++this.generationId;
    
    AudioEngine.stop();
    this.setState('GENERATING');

    try {
      // Simulate slight delay for UI to catch up
      await new Promise(resolve => setTimeout(resolve, 100));
      if (currentGenId !== this.generationId) return;

      // §1.4 step 0: 每次生成前重新播种
      // Date.now() 提供毫秒级种子，Math.random()*1e6 补充额外熵（防止浏览器降低 Date 精度）
      const seed = (Date.now() ^ Math.floor(Math.random() * 1000000)) >>> 0;
      PRNGManager.setSeed(seed);
      // ACVE §5.1 — 入口快照点 A
      PRNGManager.recordSnapshot('A');
      console.log(`[Radio] New seed: ${seed}`);

      const melodyEngine = new MelodyEngine();
      // 从所有已注册的风格中随机选择（PRNG 驱动，确定性）
      const allStyleIds = [StyleId.ModernPop, StyleId.ChillJazz, StyleId.NeoSoul];
      const pool = (this.allowedStyleIds && this.allowedStyleIds.length > 0) ? this.allowedStyleIds : allStyleIds;
      const randomStyleId = pool[Math.floor(PRNGManager.next() * pool.length)];
      
      const rawTrack = melodyEngine.generateFullSong(randomStyleId);
      
      // We need to get the actual style config used by the engine
      // Since MelodyEngine doesn't return the style config directly, we'll import StyleRegistry
      const { StyleRegistry } = await import('../../core/generation/config/StyleRegistry');
      const randomStyle = StyleRegistry[randomStyleId] || AcgStyleConfig;
      
      if (currentGenId !== this.generationId) return;

      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push({ track: rawTrack.track, context: rawTrack.context, style: randomStyle });
      this.historyIndex++;

      await this.playTrack(rawTrack.track, rawTrack.context, randomStyle, currentGenId);

    } catch (error) {
      console.error("Generation failed:", error);
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
      const { track, context, style } = this.history[this.historyIndex];
      
      await this.playTrack(track, context, style, currentGenId);
    } else {
      this.triggerGeneration();
    }
  }

  public playPrevious = async () => {
    if (this.historyIndex > 0) {
      const currentGenId = ++this.generationId;
      AudioEngine.stop();
      this.setState('GENERATING'); 
      
      this.historyIndex--;
      const { track, context, style } = this.history[this.historyIndex];
      
      await this.playTrack(track, context, style, currentGenId);
    }
  }
}
