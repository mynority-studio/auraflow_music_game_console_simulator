import { AudioEngine } from '../../core/audio/AudioEngine';
import { MelodyEngine } from '../../core/generation/MelodyEngine';
import { getAllAvailableStyles, getStyleConfig } from "../../core/generation/config/styles/StyleRegistry";
import { GeneratedTrack, StyleConfig } from '../../core/generation/types';
import { globalPRNG } from '../../core/utils/PRNG';
import { globalMidiScheduler } from '../../core/audio/MidiScheduler';

export type AppState = 'IDLE' | 'GENERATING' | 'PLAYING';

export class EndlessRadioManager {
  private state: AppState = 'IDLE';
  private history: { track: GeneratedTrack, style: StyleConfig }[] = [];
  private historyIndex: number = -1;
  private generationId: number = 0;
  
  private stateChangeCallback?: (state: AppState) => void;
  public onStyleChange?: (styleName: string) => void;

  constructor() {}

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
    } else if (this.state === 'PLAYING') {
      // Already playing, maybe resume if paused?
      // Currently AudioEngine.playSong handles it.
    }
  }

  public stopPlayback = () => {
    this.generationId += 1;
    AudioEngine.stop();
    this.setState('IDLE');
  }

  public stop = () => {
    this.stopPlayback();
  }

  private async playTrack(track: GeneratedTrack, style: StyleConfig, genId: number) {
    const melodyEngine = new MelodyEngine();
    
    if (this.onStyleChange) {
      this.onStyleChange(style.name);
    }

    await AudioEngine.playSong(track, style, melodyEngine);
    
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

      const melodyEngine = new MelodyEngine();
      const allStyles = getAllAvailableStyles();
      const randomStyleObj = allStyles[Math.floor(globalPRNG.next() * allStyles.length)];
      const randomStyle = getStyleConfig(randomStyleObj.id);
      
      const rawTrack = melodyEngine.generateFullSong(randomStyle.id);
      
      if (currentGenId !== this.generationId) return;

      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push({ track: rawTrack, style: randomStyle });
      this.historyIndex++;

      await this.playTrack(rawTrack, randomStyle, currentGenId);

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
      const { track, style } = this.history[this.historyIndex];
      
      await this.playTrack(track, style, currentGenId);
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
      const { track, style } = this.history[this.historyIndex];
      
      await this.playTrack(track, style, currentGenId);
    }
  }
}
