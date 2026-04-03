import { AudioEngine } from '../../core/audio/AudioEngine';
import { MelodyEngine } from '../../core/generation/MelodyEngine';
import { Orchestrator } from '../../core/generation/arrangement/Orchestrator';
import { GeneratedTrack, MusicContext, GenerationParams, getDefaultParams } from '../../core/generation/types';
import { createParams } from '../../core/generation/presets/PresetLoader';
import { PRNGManager } from '../../core/utils/PRNG';
import { globalMidiScheduler } from '../../core/audio/MidiScheduler';

export type AppState = 'IDLE' | 'GENERATING' | 'PLAYING';

export class EndlessRadioManager {
  private state: AppState = 'IDLE';
  private history: { track: GeneratedTrack, context: MusicContext }[] = [];
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

  private async playTrack(track: GeneratedTrack, context: MusicContext, genId: number) {
    if (this.onStyleChange) {
      this.onStyleChange('Default');
    }

    // 管道在 App 层完成：generate → arrange → playSong
    const arrangedSong = Orchestrator.arrange(track, createParams(), context);
    await AudioEngine.playSong(arrangedSong);

    if (genId !== this.generationId) return;

    this.setState('PLAYING');

    // Schedule next song using MidiScheduler's onTrackEnd
    globalMidiScheduler.onTrackEnd(() => {
      if (genId === this.generationId) {
        this.playNext();
      }
    });
  }

  public triggerGeneration = async (seed?: number) => {
    const currentGenId = ++this.generationId;

    AudioEngine.stop();
    this.setState('GENERATING');

    try {
      // §1.4 step 0: 种子初始化（默认 Date.now()，传入固定值可复现）
      PRNGManager.setSeed(seed !== undefined ? seed : Date.now());

      // Simulate slight delay for UI to catch up
      await new Promise(resolve => setTimeout(resolve, 100));
      if (currentGenId !== this.generationId) return;

      // 消耗一次 PRNG 以保持与原管道的 PRNG 消耗序列对齐（原来用于选风格）
      PRNGManager.next();

      const rawTrack = new MelodyEngine().generateFullSong(createParams());

      if (currentGenId !== this.generationId) return;

      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push({ track: rawTrack.track, context: rawTrack.context });
      this.historyIndex++;

      await this.playTrack(rawTrack.track, rawTrack.context, currentGenId);

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
      const { track, context } = this.history[this.historyIndex];

      await this.playTrack(track, context, currentGenId);
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
      const { track, context } = this.history[this.historyIndex];

      await this.playTrack(track, context, currentGenId);
    }
  }
}
