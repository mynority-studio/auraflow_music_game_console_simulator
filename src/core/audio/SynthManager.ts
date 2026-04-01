import { WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import { globalMidiScheduler } from './MidiScheduler';

export let spessaSynth: WorkletSynthesizer | null = null;
export let isSpessaSynthReady = false;

// Global AudioContext singleton
export const getAudioContext = (): AudioContext => {
    if (!(window as any).globalAudioContext) {
        (window as any).globalAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return (window as any).globalAudioContext as AudioContext;
};

let initPromise: Promise<void> | null = null;
let gm128Buffer: ArrayBuffer | null = null;

// Pre-fetch soundfonts immediately
fetch('/GM128_3MB.sf2')
    .then(r => r.arrayBuffer())
    .then(b => gm128Buffer = b)
    .catch(e => console.warn("Failed to prefetch GM128", e));

export const startAudioContext = async () => {
  const ctx = getAudioContext();
  if (ctx.state !== 'running') await ctx.resume();
  
  if (isSpessaSynthReady) return initPromise;
  
  if (!initPromise) {
      initPromise = (async () => {
          try {
              // console.log("[AudioEngine] Initializing SpessaSynth with native context");
              await ctx.audioWorklet.addModule(processorUrl);
              spessaSynth = new WorkletSynthesizer(ctx);
              
              // Note: AudioMixer will connect spessaSynth to its master bus later.
              // For now, connect directly to destination as a fallback if mixer isn't ready.
              try {
                  spessaSynth.connect(ctx.destination);
              } catch (e) {
                  console.warn("[AudioEngine] Could not connect spessaSynth to ctx.destination directly:", e);
              }
              
              // Initialize MidiScheduler
              globalMidiScheduler.init(spessaSynth);
              
              // Fetch and load GM128 soundfont
              if (!gm128Buffer) {
                  const response = await fetch('/GM128_3MB.sf2');
                  gm128Buffer = await response.arrayBuffer();
              }
              await spessaSynth.soundBankManager.addSoundBank(gm128Buffer, "main");
              
              await spessaSynth.isReady;
              
              isSpessaSynthReady = true;
              // console.log("[AudioEngine] SpessaSynth initialized and GM128 loaded.");
          } catch (e) {
              console.error("[AudioEngine] Failed to initialize SpessaSynth:", e);
              initPromise = null; // Allow retrying on failure
          }
      })();
  }
  
  return initPromise;
};
