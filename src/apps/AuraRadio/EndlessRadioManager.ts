import { AudioEngine } from '../../core/audio/AudioEngine';
import { MelodyEngine } from '../../core/generation/MelodyEngine';
import { StyleId } from '../../core/generation/config/StyleFlags';
import { AcgStyleConfig } from '../../core/generation/config/StyleRegistry';
import { GeneratedTrack, StyleConfig, MusicContext } from '../../core/generation/types';
import { PRNGManager } from '../../core/utils/PRNG';
import { globalMidiScheduler } from '../../core/audio/MidiScheduler';
import { buildComparisonLog } from '../../core/generation/utils/SongComparisonLogger';

const COMPARISON_LOG_KEY = 'AF_COMPARISON_LOG';
const COMPARISON_SEED_KEY = 'AF_COMPARISON_SEED';
const COMPARISON_GOLDEN_SEED = 12345;

function isComparisonLogEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(COMPARISON_LOG_KEY) === '1';
  } catch {
    return false;
  }
}

function getComparisonSeed(): number {
  try {
    const stored = localStorage.getItem(COMPARISON_SEED_KEY);
    if (stored) {
      const n = parseInt(stored, 10);
      if (Number.isFinite(n)) return n >>> 0;
    }
  } catch {}
  return COMPARISON_GOLDEN_SEED;
}

export type AppState = 'IDLE' | 'GENERATING' | 'PLAYING';

export class EndlessRadioManager {
  private state: AppState = 'IDLE';
  private history: { track: GeneratedTrack, context: MusicContext, style: StyleConfig }[] = [];
  private historyIndex: number = -1;
  private generationId: number = 0;
  
  private stateChangeCallback?: (state: AppState) => void;
  public onStyleChange?: (styleName: string) => void;

  private allowedStyleIds: StyleId[] = [];

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

  private async playTrack(track: GeneratedTrack, context: MusicContext, style: StyleConfig, genId: number) {
    const melodyEngine = new MelodyEngine();
    
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
      const comparisonMode = isComparisonLogEnabled();
      const seed = comparisonMode
        ? getComparisonSeed()
        : (Date.now() ^ Math.floor(Math.random() * 1000000)) >>> 0;
      PRNGManager.setSeed(seed);
      // ACVE §5.1 — 入口快照点 A（setSeed 之后、step 1 PRNG 消耗之前）
      PRNGManager.recordSnapshot('A');
      console.log(`[Radio] New seed: ${seed}${comparisonMode ? ' (comparison-log mode)' : ''}`);

      // 🌟 新管道：Stage 1 在内部抽风格+情绪，EndlessRadioManager 只传 allowedStyleIds 约束
      const { runPipeline } = await import('../../core/generation/pipeline');
      const allStyleIds: StyleId[] = [StyleId.ModernPop, StyleId.ChillJazz, StyleId.NeoSoul];
      const pool = (this.allowedStyleIds && this.allowedStyleIds.length > 0) ? this.allowedStyleIds : allStyleIds;
      const rawTrack = runPipeline({ allowedStyleIds: pool });

      const selectedStyleId = rawTrack.context.style?.id ?? StyleId.ModernPop;
      const { StyleRegistry } = await import('../../core/generation/config/StyleRegistry');
      const randomStyle = StyleRegistry[selectedStyleId] || AcgStyleConfig;

      if (comparisonMode) {
        console.log(buildComparisonLog({
          seed,
          styleName: randomStyle.name,
          track: rawTrack.track,
        }));
      }
      
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
