# Source Code Export

## File Tree

```
.env.example
.gitignore
AURA_ARCHITECTURE.md
index.html
metadata.json
package.json
tsconfig.json
vite.config.ts
src/App.tsx
src/core/generation/Dictionary.ts
src/core/generation/PlaybackEngine.ts
src/core/generation/engines/arrangement/ArrangementEngine.ts
src/core/generation/engines/arrangement/idioms/BaseAccompIdiom.ts
src/core/generation/engines/arrangement/idioms/BouncePianoIdiom.ts
src/core/generation/engines/arrangement/idioms/IdiomDispatcher.ts
src/core/generation/engines/arrangement/idioms/IdiomUtils.ts
src/core/generation/engines/arrangement/idioms/LickDictionary.ts
src/core/generation/engines/arrangement/idioms/ModernPianoIdiom.ts
src/core/generation/engines/arrangement/idioms/PopPadIdiom.ts
src/core/generation/engines/arrangement/idioms/SynthLeadIdiom.ts
src/core/generation/engines/arrangement/idioms/synth/Synth80sPlugin.ts
src/core/generation/engines/arrangement/idioms/synth/SynthRiffPlugin.ts
src/core/generation/engines/arrangement/plugins/ArrangementPlugin.ts
src/core/generation/engines/arrangement/plugins/MelodyEvasionPlugin.ts
src/core/generation/engines/arrangement/plugins/SynthBreathPlugin.ts
src/core/generation/engines/arrangement/plugins/SynthLegatoPlugin.ts
src/core/generation/engines/composition/CompositionEngine.ts
src/core/generation/engines/groove/GrooveEngine.ts
src/core/generation/engines/groove/plugins/DrumFillPlugin.ts
src/core/generation/engines/groove/plugins/GroovePlugin.ts
src/core/generation/engines/groove/plugins/HumanizePlugin.ts
src/core/generation/engines/harmony/GlobalVoicer.ts
src/core/generation/engines/harmony/HarmonyEngine.ts
src/core/generation/engines/harmony/plugins/AnticipationPlugin.ts
src/core/generation/engines/harmony/plugins/EnhancedColorPlugin.ts
src/core/generation/engines/harmony/plugins/HarmonyPlugin.ts
src/core/generation/engines/harmony/plugins/PassingChordPlugin.ts
src/core/generation/engines/melody/GrooveEngine.ts
src/core/generation/engines/melody/MelodicContourEngine.ts
src/core/generation/engines/melody/MelodyEngine.ts
src/core/generation/engines/melody/MotifManager.ts
src/core/generation/engines/melody/RhythmCells.ts
src/core/generation/engines/melody/plugins/ApproachNotePlugin.ts
src/core/generation/engines/melody/plugins/DelayedNotePlugin.ts
src/core/generation/engines/melody/plugins/EnclosurePlugin.ts
src/core/generation/engines/melody/plugins/GraceNotePlugin.ts
src/core/generation/engines/melody/plugins/HarmonizationPlugin.ts
src/core/generation/engines/melody/plugins/MelodyHumanizePlugin.ts
src/core/generation/engines/melody/plugins/PassingNotePlugin.ts
src/core/generation/engines/melody/plugins/PickupNotePlugin.ts
src/core/generation/engines/melody/plugins/SyncopationPlugin.ts
src/core/generation/engines/melody/plugins/ToplinePlugin.ts
src/core/generation/engines/melody/plugins/ToplinePluginManager.ts
src/core/generation/engines/melody/plugins/TrillPlugin.ts
src/core/generation/instruments/ElectricBass.ts
src/core/generation/instruments/ElectricPiano.ts
src/core/generation/instruments/GrandPiano.ts
src/core/generation/instruments/StandardDrumKit.ts
src/core/generation/instruments/SynthLead.ts
src/core/generation/instruments/SynthPad.ts
src/core/generation/manifests/InstrumentRegistry.ts
src/core/generation/manifests/MusicianRegistry.ts
src/core/generation/manifests/StyleRegistry.ts
src/core/generation/personas/AlexPopPiano.ts
src/core/generation/personas/BillyBouncePiano.ts
src/core/generation/personas/DavePopDrums.ts
src/core/generation/personas/LeoSynthLead.ts
src/core/generation/personas/PennyPopPad.ts
src/core/generation/styles/PopStyle.ts
src/core/generation/styles/Shared.ts
src/core/generation/theory/HarmonicSeries.ts
src/core/generation/theory/MusicTheory.ts
src/core/generation/types.ts
src/core/utils/PRNG.ts
src/main.tsx
src/utils/GMInstruments.ts
src/vite-env.d.ts
src/index.css
```

## Component & Architecture Overview

---

## Source Files

### File: `.env.example`

```example
# GEMINI_API_KEY: Required for Gemini AI API calls.
# AI Studio automatically injects this at runtime from user secrets.
# Users configure this via the Secrets panel in the AI Studio UI.
GEMINI_API_KEY="MY_GEMINI_API_KEY"

# APP_URL: The URL where this applet is hosted.
# AI Studio automatically injects this at runtime with the Cloud Run service URL.
# Used for self-referential links, OAuth callbacks, and API endpoints.
APP_URL="MY_APP_URL"

```

### File: `.gitignore`

```text
node_modules/
build/
dist/
coverage/
.DS_Store
*.log
.env*
!.env.example

```

### File: `index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Google AI Studio App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>


```

### File: `metadata.json`

```json
{
  "name": "Remix: AuraFlow Tap模拟器V4",
  "description": "",
  "requestFramePermissions": [],
  "majorCapabilities": []
}
```

### File: `package.json`

```json
{
  "name": "react-example",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite --port=3000 --host=0.0.0.0",
    "build": "vite build",
    "preview": "vite preview",
    "clean": "rm -rf dist",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@google/genai": "^1.29.0",
    "@tailwindcss/vite": "^4.1.14",
    "@vitejs/plugin-react": "^5.0.4",
    "dotenv": "^17.2.3",
    "express": "^4.21.2",
    "lucide-react": "^0.546.0",
    "motion": "^12.23.24",
    "react": "^19.0.1",
    "react-dom": "^19.0.1",
    "spessasynth_lib": "^4.2.15",
    "vite": "^6.2.3"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.14.0",
    "autoprefixer": "^10.4.21",
    "tailwindcss": "^4.1.14",
    "tsx": "^4.21.0",
    "typescript": "~5.8.2",
    "vite": "^6.2.3"
  }
}

```

### File: `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "experimentalDecorators": true,
    "useDefineForClassFields": false,
    "module": "ESNext",
    "lib": [
      "ES2022",
      "DOM",
      "DOM.Iterable"
    ],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "isolatedModules": true,
    "moduleDetection": "force",
    "allowJs": true,
    "jsx": "react-jsx",
    "paths": {
      "@/*": [
        "./*"
      ]
    },
    "allowImportingTsExtensions": true,
    "noEmit": true
  }
}

```

### File: `vite.config.ts`

```typescript
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});

```

### File: `src/App.tsx`

```typescript
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import { PRNGManager } from './core/utils/PRNG';
import { CompositionEngine } from './core/generation/engines/composition/CompositionEngine';
import { ArrangementEngine } from './core/generation/engines/arrangement/ArrangementEngine';
import { PlaybackEngine } from './core/generation/PlaybackEngine';
import { MusicContext, ArrangedTrack, RoleType, BandMusician, VibeType } from './core/generation/types';
import { getMusiciansByRole, getMusicianById } from './core/generation/manifests/MusicianRegistry';
import { StyleRegistry } from './core/generation/manifests/StyleRegistry';
import { TonalityName } from './core/generation/theory/MusicTheory';
import { GMInstruments, GM_CATEGORIES } from './utils/GMInstruments';

export default function App() {
  const [contextVal, setContextVal] = useState<MusicContext | null>(null);
  const [arrangedTrackVal, setArrangedTrackVal] = useState<ArrangedTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSf2Loaded, setIsSf2Loaded] = useState(false);
  const [loadingSf2, setLoadingSf2] = useState(true);
  const engineRef = useRef<PlaybackEngine | null>(null);

  const [bandSelection, setBandSelection] = useState<Record<RoleType, string | null>>({
      [RoleType.Vocal]: null,
      [RoleType.MainInst]: null,
      [RoleType.AccompInst]: 'accomp_alex_pop',
      [RoleType.Pad]: null,
      [RoleType.Bass]: null,
      [RoleType.Drums]: 'drums_dave_pop'
  });

  const [instrumentOverrides, setInstrumentOverrides] = useState<Record<RoleType, number | null>>({
      [RoleType.Vocal]: null,
      [RoleType.MainInst]: null,
      [RoleType.AccompInst]: null,
      [RoleType.Pad]: null,
      [RoleType.Bass]: null,
      [RoleType.Drums]: null
  });

  const [duration, setDuration] = useState<number>(150);
  const [vibe, setVibe] = useState<VibeType>(VibeType.Standard);
  const [passingProb, setPassingProb] = useState<number>(0.2);
  const [anticipationProb, setAnticipationProb] = useState<number>(0.3);
  const [currentSeed, setCurrentSeed] = useState<number | null>(null);
  const [customSeedInput, setCustomSeedInput] = useState<string>('');

  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const initSf2 = async () => {
        try {
            console.log("Fetching Aura25_GM128.sf2...");
            const resp = await fetch("/Aura25_GM128.sf2");
            if (!resp.ok) throw new Error("SF2 fetch failed. Status: " + resp.status);
            const buffer = await resp.arrayBuffer();
            if (!engineRef.current) {
                engineRef.current = new PlaybackEngine();
            }
            await engineRef.current.loadSoundfont(buffer);
            setIsSf2Loaded(true);
            console.log("SF2 loaded successfully.");
        } catch (err) {
            console.error("Failed to auto-load SF2:", err);
            // Fallback: let user know or handle error state
        } finally {
            setLoadingSf2(false);
        }
    };
    initSf2();
  }, []);

  const generate = () => {
    if (!isSf2Loaded || !engineRef.current || isGenerating) return;

    // Determine random seed based on clock just for initial seeding, 
    // generation strictly uses PRNGManager.
    const seed = customSeedInput.trim() !== '' ? parseInt(customSeedInput, 10) : Date.now();
    if (isNaN(seed)) {
        alert("Invalid seed number. Please enter a valid integer.");
        return;
    }
    PRNGManager.setSeed(seed);
    setCurrentSeed(seed);

    const wasPlaying = isPlaying;
    if (wasPlaying) {
        engineRef.current.stop();
        setIsPlaying(false);
    }
    
    setIsGenerating(true);

    // Yield control to the browser so it can stop the audio context properly 
    // and re-render the UI with generating state before the heavy computation blocks the main thread.
    setTimeout(() => {
        try {
            // Resolve Band
            const activeBand = Object.entries(bandSelection)
                .map(([role, id]) => {
                    if (!id) return null;
                    const profile = getMusicianById(id as string);
                    if (!profile) return null;
                    const overriddenId = instrumentOverrides[role as RoleType];
                    const finalInstrumentId = overriddenId !== null && overriddenId !== undefined 
                                    ? overriddenId 
                                    : profile.instrumentId;
                                    
                    console.log(`[Band Config] Role: ${role}, Original: ${profile.instrumentId}, Overridden: ${overriddenId}, Final: ${finalInstrumentId}`);
                    
                    return {
                        id: id as string,
                        role: role as RoleType,
                        styleId: profile.styleId,
                        instrumentId: finalInstrumentId,
                        persona: profile.persona
                    };
                })
                .filter(m => m !== null) as BandMusician[];

            // Leader-Driven Style Resolution
            const leader = activeBand.find(m => m.role === RoleType.MainInst) 
                        || activeBand.find(m => m.role === RoleType.AccompInst);
            
            const dominantStyleId = leader ? leader.styleId : 'Pop';
            const styleConfig = StyleRegistry[dominantStyleId] || StyleRegistry['Pop'];

            // 1. Generation Engine
            // Generates Structure & Harmony & Melody
            const { track, context } = CompositionEngine.generateFullSong({ 
                targetDurationSec: duration,
                passingChordProb: passingProb,
                anticipationProb: anticipationProb,
                style: styleConfig,
                band: activeBand,
                seed: seed,
                vibe: vibe
            });
            
            // Inject Band into Context
            context.band = activeBand;
            context.swingRatio = styleConfig.swingRatio;
            
            // 2. Orchestration Engine
            // Expands track over 4 specific instruments via Idioms
            const arrangedTrack = ArrangementEngine.arrange(track, context);

            setContextVal(context);
            setArrangedTrackVal(arrangedTrack);
            
            // We removed auto-play upon generate to match user expectations.
            // If the user wants to play, they must explicitly click Play.
        } finally {
            setIsGenerating(false);
        }
    }, 50);
  };

  const play = async () => {
    if (!isSf2Loaded || !engineRef.current || !arrangedTrackVal || !contextVal) return;
    
    // Ensure AudioContext is running before playback
    if (engineRef.current && engineRef.current['ac'] && engineRef.current['ac'].state === 'suspended') {
        await engineRef.current['ac'].resume();
    }

    // 3. Playback Engine
    await engineRef.current.play(arrangedTrackVal, contextVal);
    setIsPlaying(true);
  };

  const stop = () => {
    if (engineRef.current) {
      engineRef.current.stop();
      setIsPlaying(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#4A453E] font-sans p-8 flex flex-col">
      <div className="max-w-2xl mx-auto w-full space-y-6">
        <header className="flex flex-col gap-1 pb-4">
          <h1 className="font-serif text-4xl font-medium tracking-tight text-[#5A5A40]">AuraRadio Engine <span className="text-sm italic opacity-60 ml-2 font-serif">ACG Light Music</span></h1>
          <p className="text-[10px] uppercase tracking-[0.2em] font-semibold text-[#8C867A]">Pure Algorithmic Generation • SpessaSynth Audio</p>
        </header>

        <section className="bg-white rounded-[24px] p-6 shadow-sm border border-[#E5E1DA] flex flex-col gap-4">
          {loadingSf2 && (
            <div className="flex flex-col gap-2 p-4 bg-[#FAF8F5] rounded-xl border border-dashed border-[#E5E1DA]">
                <p className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]">
                    Initializing SF2 Engine...
                </p>
                <p className="text-[10px] text-[#8C867A]">Fetching and decoding Aura25_GM128.sf2...</p>
            </div>
          )}
          {!loadingSf2 && !isSf2Loaded && (
            <div className="flex flex-col gap-2 p-4 bg-[#FAF8F5] rounded-xl border border-dashed border-[#E5E1DA]">
                <p className="text-xs font-bold uppercase text-red-500">
                    Failed to load SF2
                </p>
                <p className="text-[10px] text-[#8C867A]">Please ensure /public/Aura25_GM128.sf2 exists.</p>
            </div>
          )}

            <div className="flex flex-col gap-6 mb-4">
              <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#8C867A] mb-2 block">
                    Target Duration (sec): {duration}
                  </label>
                  <input 
                    type="range" 
                    min="30" max="240" step="10" 
                    value={duration} 
                    onChange={(e) => setDuration(parseInt(e.target.value))}
                    className="w-full h-1 bg-[#E5E1DA] rounded-full appearance-none outline-none cursor-pointer"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#8C867A] mb-2 block">
                    Song Vibe (Feel)
                  </label>
                  <select
                      value={vibe}
                      onChange={(e) => setVibe(e.target.value as VibeType)}
                      className="w-full px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5E1DA] rounded-lg outline-none focus:border-[#C4BFAF] transition-colors"
                  >
                      <option value={VibeType.Standard}>Standard (Default)</option>
                      <option value={VibeType.Chill}>Chill / Lazy</option>
                      <option value={VibeType.Energetic}>Energetic / Driving</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#8C867A] mb-2 block">
                    Seed (Optional)
                  </label>
                  <input
                    type="text"
                    value={customSeedInput}
                    onChange={(e) => setCustomSeedInput(e.target.value)}
                    placeholder="Leave empty for random"
                    className="w-full px-3 py-2 text-sm bg-[#FAF8F5] border border-[#E5E1DA] rounded-lg outline-none focus:border-[#C4BFAF] transition-colors font-mono"
                  />
                </div>
              </div>

            <div className="flex flex-col gap-3">
               <h3 className="text-xs font-bold uppercase tracking-widest text-[#5A5A40] border-b border-[#E5E1DA] pb-2">Band Musicians Roster</h3>
               <div className="flex flex-col gap-3">
                 {[RoleType.Vocal, RoleType.MainInst, RoleType.AccompInst, RoleType.Pad, RoleType.Bass, RoleType.Drums].map((role) => {
                    const availableModels = getMusiciansByRole(role);
                    const selectedId = bandSelection[role];
                    const selectedProfile = selectedId ? getMusicianById(selectedId) : null;
                    return (
                    <div key={role} className="flex flex-col sm:flex-row gap-4 p-3 bg-[#FAF8F5] border border-[#E5E1DA] rounded-xl items-start sm:items-center">
                       <div className="w-24 shrink-0">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[#8C867A]">{role}</span>
                       </div>
                       <div className="flex-1 w-full flex flex-col gap-2">
                           <div className="flex flex-col sm:flex-row gap-2">
                               <select 
                                    value={selectedId || ''} 
                                    onChange={(e) => {
                                        setBandSelection(prev => ({ ...prev, [role]: e.target.value === '' ? null : e.target.value }));
                                        // Reset override when musician changes
                                        setInstrumentOverrides(prev => ({ ...prev, [role]: null }));
                                    }}
                                    className="w-full sm:w-64 bg-white border border-[#E5E1DA] rounded-lg px-3 py-2 text-xs font-semibold text-[#5A5A40] outline-none"
                                >
                                    <option value="">-- Empty (None) --</option>
                                    {availableModels.map(m => (
                                        <option key={m.id} value={m.id}>{m.name} ({m.styleId})</option>
                                    ))}
                                </select>

                                {selectedProfile && (
                                    <select
                                        value={String(instrumentOverrides[role as RoleType] ?? selectedProfile.instrumentId)}
                                        onChange={(e) => setInstrumentOverrides(prev => ({ ...prev, [role as RoleType]: parseInt(e.target.value) }))}
                                        className="w-full sm:w-48 bg-white border border-[#E5E1DA] rounded-lg px-3 py-2 text-xs font-semibold text-[#5A5A40] outline-none"
                                    >
                                        <option value={String(selectedProfile.instrumentId)}>Default Patch ({selectedProfile.instrumentId})</option>
                                        {GM_CATEGORIES.map(category => (
                                            <optgroup key={category} label={category}>
                                                {GMInstruments.filter(inst => inst.category === category).map(inst => (
                                                    <option key={inst.id} value={String(inst.id)}>{inst.id}: {inst.name}</option>
                                                ))}
                                            </optgroup>
                                        ))}
                                    </select>
                                )}
                           </div>
                            {selectedProfile && (
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-2">
                                    <div className="text-[9px] uppercase tracking-wider text-[#8C867A]">Sparse: {Math.round(selectedProfile.persona.sparsityTendency * 100)}%</div>
                                    <div className="text-[9px] uppercase tracking-wider text-[#8C867A]">Sync: {Math.round(selectedProfile.persona.syncopationAssault * 100)}%</div>
                                    <div className="text-[9px] uppercase tracking-wider text-[#8C867A]">Ext: {Math.round(selectedProfile.persona.colorBias * 100)}%</div>
                                    <div className="text-[9px] uppercase tracking-wider text-[#8C867A]">Dyn: {selectedProfile.persona.dynamicRange[0]}-{selectedProfile.persona.dynamicRange[1]}</div>
                                </div>
                            )}
                       </div>
                    </div>
                 )})}
               </div>
            </div>
          </div>

          <div className="flex gap-4">
            <button 
              onClick={generate}
              disabled={!isSf2Loaded || isGenerating}
              className="bg-[#5A5A40] text-[#FAF8F5] rounded-full text-xs font-semibold tracking-widest uppercase px-6 py-3 cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating ? 'Generating...' : 'Generate'}
            </button>
            <button 
              onClick={play}
              disabled={!isSf2Loaded || !arrangedTrackVal || isGenerating}
              className="bg-[#3A3A28] text-[#FAF8F5] rounded-full text-xs font-semibold tracking-widest uppercase px-6 py-3 cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Play
            </button>
            <button 
              onClick={stop}
              disabled={!isPlaying || isGenerating}
              className="bg-transparent border border-[#E5E1DA] text-[#5A5A40] rounded-full text-xs font-semibold tracking-widest uppercase px-6 py-3 cursor-pointer hover:bg-gray-50 disabled:opacity-50 transition-all"
            >
              Stop
            </button>
            <div className={`ml-auto w-10 h-10 rounded-full border border-[#E5E1DA] flex items-center justify-center ${isPlaying ? 'bg-[#FAF8F5]' : ''}`}>
              <div className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`}></div>
            </div>
          </div>
        </section>

        {contextVal && (
          <section className="bg-white rounded-[24px] p-8 shadow-sm border border-[#E5E1DA] flex flex-col gap-6">
            <h2 className="text-xs font-bold uppercase tracking-widest text-[#8C867A]">Generated Context</h2>
            
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="p-4 bg-[#FAF8F5] rounded-xl flex flex-col gap-1">
                <span className="text-[10px] text-[#8C867A] uppercase font-bold tracking-wider mb-1">Seed</span>
                <span className="font-mono text-lg font-semibold truncate" title={currentSeed?.toString()}>{currentSeed || 'None'}</span>
              </div>
              <div className="p-4 bg-[#FAF8F5] rounded-xl flex flex-col gap-1">
                <span className="text-[10px] text-[#8C867A] uppercase font-bold tracking-wider mb-1">Tempo</span>
                <span className="font-mono text-lg font-semibold">{contextVal.bpm} BPM</span>
              </div>
              <div className="p-4 bg-[#FAF8F5] rounded-xl flex flex-col gap-1">
                <span className="text-[10px] text-[#8C867A] uppercase font-bold tracking-wider mb-1">Time Signature</span>
                <span className="font-mono text-lg font-semibold">{contextVal.timeSignature[0]} / {contextVal.timeSignature[1]}</span>
              </div>
              <div className="p-4 bg-[#FAF8F5] rounded-xl flex flex-col gap-1">
                <span className="text-[10px] text-[#8C867A] uppercase font-bold tracking-wider mb-1">Key</span>
                <span className="font-mono text-lg font-semibold">{arrangedTrackVal?.key || 'C'}</span>
              </div>
              <div className="p-4 bg-[#FAF8F5] rounded-xl flex flex-col gap-1">
                <span className="text-[10px] text-[#8C867A] uppercase font-bold tracking-wider mb-1">Scale</span>
                <span className="font-mono text-lg font-semibold">{TonalityName[contextVal.tonality]?.replace('_', ' ') || 'Unknown'}</span>
              </div>
            </div>

            <div>
               <span className="text-[10px] text-[#8C867A] uppercase font-bold tracking-widest mb-3 block">Structure Breakdown</span>
               <div className="w-full bg-[#FAF8F5] p-2 rounded-2xl border border-[#E5E1DA] flex flex-col gap-2">
                  {contextVal.sections.map((sec, idx) => {
                    const secChords = arrangedTrackVal?.chords?.filter(c => c.startBeat >= sec.startBeat && c.startBeat < sec.endBeat) || [];
                    return (
                    <div key={idx} className="bg-white border border-[#E5E1DA] p-3 rounded-xl flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-[#5A5A40]">Section {sec.name}</span>
                        <span className="font-mono text-xs opacity-60">Beat {sec.startBeat} - {sec.endBeat}</span>
                        <div className="flex items-center gap-2">
                           <span className="text-[10px] font-bold text-[#8C867A]">NRG</span>
                           <div className="w-16 h-1.5 bg-[#FAF8F5] rounded-full overflow-hidden border border-[#E5E1DA]">
                              <div className="h-full bg-[#E9967A]" style={{ width: `${(sec.energyLevel / 10) * 100}%` }}></div>
                           </div>
                        </div>
                      </div>
                      {secChords.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-2 border-t border-[#E5E1DA]/50">
                          {secChords.map((c, i) => (
                            <div key={i} className="px-2 py-1 bg-[#FAF8F5] text-[#5A5A40] text-xs font-mono font-medium rounded-md border border-[#E5E1DA]/60">
                              {c.numeral}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )})}
               </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

```

### File: `src/core/generation/Dictionary.ts`

```typescript
export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
export const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
export const PENTATONIC_MINOR = [0, 3, 5, 7, 10];
export const DORIAN = [0, 2, 3, 5, 7, 9, 10];

export const ROOT_KEYS = [0, 2, 4, 5, 7, 9, 10]; // C, D, E, F, G, A, Bb

export const CHORD_ROUTINGS_ACG = [
    // IV - V - iii - vi (relative to major scale degrees: 4, 5, 3, 6)
    [3, 4, 2, 5],
    // IV - V - I - vi
    [3, 4, 0, 5],
    // vi - IV - I - V
    [5, 3, 0, 4]
];

export enum ChordQuality {
    MAJOR = 0,
    MINOR = 1,
    DOM7 = 2,
    MAJ7 = 3,
    MIN7 = 4,
    DIM = 5
}

// Fixed mathematical truth mapping standard chords to half-step intervals
export const ChordDictionaries: Record<ChordQuality, number[]> = {
    [ChordQuality.MAJOR]: [0, 4, 7],
    [ChordQuality.MINOR]: [0, 3, 7],
    [ChordQuality.DOM7]:  [0, 4, 7, 10],
    [ChordQuality.MAJ7]:  [0, 4, 7, 11],
    [ChordQuality.MIN7]:  [0, 3, 7, 10],
    [ChordQuality.DIM]:   [0, 3, 6]
};

export const TIME_SIGNATURES = [
    { num: 4, den: 4 },
    { num: 3, den: 4 },
    { num: 6, den: 8 }
];

```

### File: `src/core/generation/PlaybackEngine.ts`

```typescript
import { ArrangedTrack, MusicContext, NoteData } from './types';
import { getInstrumentConfig } from './manifests/InstrumentRegistry';
import { WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';

export interface MidiEvent {
    time: number;
    type: number; // 0 for NoteOn, 1 for NoteOff, 2 for CC
    pitch: number;    // note number, OR CC controller number
    velocity: number; // attack velocity, OR CC value
    instrument: number; // channel
}

// Web Audio API lightweight synthesizer mapping
export class PlaybackEngine {
    private ac: AudioContext | null = null;
    private synth: WorkletSynthesizer | null = null;
    private initPromise: Promise<void> | null = null;
    
    private nextEventIdx = 0;
    private events: MidiEvent[] = [];
    private startTime = 0;
    private isPlaying = false;
    private timerWorker: Worker | null = null;

    public async init(): Promise<void> {
        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = (async () => {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            this.ac = new AudioContextClass();
            
            await this.ac.audioWorklet.addModule(processorUrl);
            
            this.synth = new WorkletSynthesizer(this.ac);
            await this.synth.isReady;
            
            // Connect synthesizer to output destination via a Master Bus
            // 1. Warmth (Low Shelf)
            const lowShelf = this.ac.createBiquadFilter();
            lowShelf.type = "lowshelf";
            lowShelf.frequency.value = 300; 
            lowShelf.gain.value = 1.5; // Slight body bump

            // 2. High-Frequency Tamer (High Shelf)
            // This is the core fix for "piercing high notes / too sharp highs"
            const tamingFilter = this.ac.createBiquadFilter();
            tamingFilter.type = "highshelf";
            // The human ear is most sensitive around 2.5kHz - 5kHz.
            tamingFilter.frequency.value = 2500; 
            tamingFilter.gain.value = -4.0; // Pull down heights effectively acting as a master warm EQ
            
            // 3. Master Gain to prevent clipping, boosted for stronger overall perceived volume
            const masterGain = this.ac.createGain();
            masterGain.gain.value = 2.5;
            
            // Patch it up
            this.synth.connect(lowShelf);
            lowShelf.connect(tamingFilter);
            tamingFilter.connect(masterGain);
            masterGain.connect(this.ac.destination);

            // Initialize inline worker for background timing
            const workerCode = `
                let interval;
                self.onmessage = function(e) {
                    if (e.data === 'start') {
                        if (interval) clearInterval(interval);
                        interval = setInterval(() => self.postMessage('tick'), 25); // Run every 25ms for tighter scheduling
                    } else if (e.data === 'stop') {
                        clearInterval(interval);
                        interval = null;
                    }
                };
            `;
            const blob = new Blob([workerCode], { type: 'application/javascript' });
            this.timerWorker = new Worker(URL.createObjectURL(blob));
            this.timerWorker.onmessage = () => {
                this.schedule();
            };
        })();

        return this.initPromise;
    }

    public isInitialized(): boolean {
        return this.synth !== null;
    }

    public async loadSoundfont(buffer: ArrayBuffer): Promise<void> {
        if (!this.synth) await this.init();
        await this.synth!.soundBankManager.addSoundBank(buffer, "custom-sf2");
        this.applyMixConfig();
    }

    private applyMixConfig(): void {
        if (!this.synth) return;
        
        // --- Piano Arrangement & Mix Configuration ---
        // 1. Instrument Selection (Program Change)
        // Melody (Ch 0): Flute (73) or Synth Voice (54) to represent the "Vocalist"
        this.synth.programChange(0, 73);
        // Accompaniment RH (Ch 1): Acoustic Grand (0)
        this.synth.programChange(1, 0);
        // Accompaniment LH (Ch 2): Acoustic Grand (0)
        this.synth.programChange(2, 0);

        // 2. Mix (Volume & Pan)
        this.synth.controllerChange(0, 7, 110);   // Melody volume
        this.synth.controllerChange(1, 7, 100);  // Accompaniment RH volume
        this.synth.controllerChange(2, 7, 85);  // Accompaniment LH volume
        this.synth.controllerChange(9, 7, 110);  // Drums volume

        // Pan: push melody center, accompaniment LH left, accompaniment RH right to simulate piano keyboard spacing
        this.synth.controllerChange(0, 10, 64); // Center
        this.synth.controllerChange(1, 10, 85); // Right
        this.synth.controllerChange(2, 10, 43); // Left
        
        // 3. Reverb for a nice grand piano sound
        this.synth.controllerChange(0, 91, 75); 
        this.synth.controllerChange(1, 91, 85); 
        this.synth.controllerChange(2, 91, 85); 
        this.synth.controllerChange(9, 91, 50); // Less reverb on drums
    }

    public async play(arranged: ArrangedTrack, context: MusicContext): Promise<void> {
        this.stop(); // Stop existing

        if (!this.synth) {
            console.warn("Synthesizer not initialized or sf2 not loaded");
            return; // Needs an explicit init and SF2 load first.
        }
        
        this.applyMixConfig(); // Re-apply base mix

        // 1. Dynamic Instrument Selection (Program Change) based on Band Configuration
        const melodicMusicians = context.band?.filter(m => m.role !== 'drums') || [];
        const isSoloMelodic = melodicMusicians.length === 1;

        let leadChannel = 0;
        let accompChannel = 1;
        let bassChannel = 2;
        let padChannel = 3;

        if (isSoloMelodic) {
            // A single musician is playing all melodic/harmonic parts (e.g. Solo Piano)
            const soleInstId = melodicMusicians[0].instrumentId;
            
            // Route all to Channel 1
            leadChannel = 1;
            accompChannel = 1;
            bassChannel = 1;
            padChannel = 1;
            
            // Set program and unified mix for the single instrument
            this.synth.programChange(1, soleInstId);
            this.synth.controllerChange(1, 7, 100);  // Unified Volume
            this.synth.controllerChange(1, 10, 64); // Centered Pan for the whole instrument
            this.synth.controllerChange(1, 91, 85); // Unified Reverb
            
            console.log(`[PlaybackEngine] Solo Melodic Mode Detected. Routing all to Channel 1 (Instrument ID: ${soleInstId})`);
        } else {
            const mainMusician = context.band?.find(m => m.role === 'mainInst' || m.role === 'vocal');
            const accompMusician = context.band?.find(m => m.role === 'accompInst') || mainMusician;
            const bassMusician = context.band?.find(m => m.role === 'bass');
            const padMusician = context.band?.find(m => m.role === 'pad');
            const drumMusician = context.band?.find(m => m.role === 'drums');

            accompChannel = 1;

            // Melody (Ch 0)
            this.synth.programChange(0, mainMusician ? mainMusician.instrumentId : (accompMusician ? accompMusician.instrumentId : 73));
            this.synth.controllerChange(0, 7, 100); // Volume
            this.synth.controllerChange(0, 10, 64); // Center Pan
            this.synth.controllerChange(0, 91, 50); // Moderate Reverb
            
            // Accompaniment RH (Ch 1)
            const accompInstId = accompMusician ? accompMusician.instrumentId : 0;
            const accompConfig = getInstrumentConfig(accompInstId);
            this.synth.programChange(1, accompInstId);
            
            if (accompConfig.isElectronic) {
                // Mix for Synth/Electronic Accomp
                this.synth.controllerChange(1, 7, 75); // Slightly lower volume to prevent piercing
                this.synth.controllerChange(1, 10, 64); // Center pan for punchy electronic feel
                this.synth.controllerChange(1, 91, 50); // Less reverb, tighter sound
                this.synth.controllerChange(1, 93, 40); // Add a bit of chorus for width
            } else {
                // Mix for acoustic/electric piano
                this.synth.controllerChange(1, 7, 95); // Volume
                this.synth.controllerChange(1, 10, 60); // Pan Slightly Left/Center (Unified Piano)
                this.synth.controllerChange(1, 91, 70); // More Reverb
            }
            
            // Accompaniment LH / Bass
            if (bassMusician) {
                bassChannel = 2;
                this.synth.programChange(2, bassMusician.instrumentId);
                this.synth.controllerChange(2, 7, 95); // Bass is louder
                this.synth.controllerChange(2, 10, 64); // Center 
                this.synth.controllerChange(2, 91, 20); // Low Reverb for Bass
            } else {
                bassChannel = accompChannel; // Unify LH into the RH Piano instance perfectly!
            }
            
            // Pad (Ch 3)
            if (padMusician) {
                this.synth.programChange(3, padMusician.instrumentId);
                this.synth.controllerChange(3, 7, 55); // Pad volume - increased to 55 per user request
                this.synth.controllerChange(3, 10, 64); // Center pan
                this.synth.controllerChange(3, 91, 127); // Max Reverb for huge soundstage
                this.synth.controllerChange(3, 93, 80); // Chorus effect to widen the stereo image
            }

            // Drums (Ch 9)
            this.synth.programChange(9, drumMusician ? drumMusician.instrumentId : 0);
            this.synth.controllerChange(9, 7, 95);  // Drum Volume
            this.synth.controllerChange(9, 91, 30); // Low-Moderate Reverb for Drums
        }
        
        if (this.ac!.state === 'suspended') {
            await this.ac!.resume();
        }

        const absoluteEvents: MidiEvent[] = [];
        const secondsPerBeat = 60 / context.bpm;

        const applySwing = (beat: number): number => {
            if (!context.swingRatio || context.swingRatio <= 0.5) return beat;
            const whole = Math.floor(beat);
            const frac = beat - whole;
            
            if (frac === 0) return whole;
            
            // Map the 0.0 - 0.5 range to 0.0 - swingRatio
            // Map the 0.5 - 1.0 range to swingRatio - 1.0
            if (frac < 0.5) {
                return whole + (frac / 0.5) * context.swingRatio;
            } else {
                return whole + context.swingRatio + ((frac - 0.5) / 0.5) * (1 - context.swingRatio);
            }
        };

        const processTrack = (notes: NoteData[] | undefined, channel: number) => {
            if (!notes) return;
            for (const note of notes) {
                const swungOnset = applySwing(note.onset);
                const swungEnd = applySwing(note.onset + note.duration);
                const actualDuration = Math.max(0.01, swungEnd - swungOnset);

                const startTimeSec = swungOnset * secondsPerBeat;
                const durationSec = actualDuration * secondsPerBeat;
                
                absoluteEvents.push({
                    time: startTimeSec,
                    type: 0,
                    pitch: Math.round(note.pitch),
                    velocity: Math.max(1, Math.min(127, Math.round(note.velocity * 127))),
                    instrument: channel
                });

                absoluteEvents.push({
                    time: startTimeSec + durationSec,
                    type: 1,
                    pitch: Math.round(note.pitch),
                    velocity: 0,
                    instrument: channel
                });
            }
        };

        const hasMelodyPlayer = arranged.melody && arranged.melody.length > 0;
        
        if (hasMelodyPlayer) {
            processTrack(arranged.melody, leadChannel);
        }
        
        processTrack(arranged.pianoRH, accompChannel);
        processTrack(arranged.pianoLH, bassChannel);
        processTrack(arranged.pad, padChannel);
        processTrack(arranged.drums, 9); // Drum Channel
        
        // --- Intelligent Sustain Pedal (CC 64) for Piano ---
        // Simulates a player holding the pedal and clearing it on chord changes
        if (context.harmonicFrames) {
            let pedalChannels: number[] = [];
            if (isSoloMelodic) {
                const config = getInstrumentConfig(context.band?.filter(m => m.role !== 'drums')[0]?.instrumentId || 0);
                if (config.supportsSustainPedal !== false) {
                    pedalChannels = [1];
                }
            } else {
                const accompMusician = context.band?.find(m => m.role === 'accompInst') || context.band?.find(m => m.role === 'mainInst' || m.role === 'vocal');
                const bassMusician = context.band?.find(m => m.role === 'bass');
                
                const accompConfig = getInstrumentConfig(accompMusician ? accompMusician.instrumentId : 0);
                if (accompConfig.supportsSustainPedal !== false) {
                    pedalChannels.push(accompChannel);
                }
                
                const bassConfig = getInstrumentConfig(bassMusician ? bassMusician.instrumentId : (accompMusician ? accompMusician.instrumentId : 0));
                if (bassConfig.supportsSustainPedal !== false) {
                    if (!pedalChannels.includes(bassChannel)) {
                        pedalChannels.push(bassChannel);
                    }
                }
            }
            
            for (const frame of context.harmonicFrames) {
                const swungStart = applySwing(frame.startBeat);
                const startSec = swungStart * secondsPerBeat;
                
                for (const ch of pedalChannels) {
                    if (frame.startBeat > 0) {
                        // Quick pedal reset (up then down) on chord change
                        absoluteEvents.push({
                            time: startSec - 0.05, 
                            type: 2, pitch: 64, velocity: 0, instrument: ch
                        });
                    }
                    // Pedal Down
                    absoluteEvents.push({
                        time: startSec + 0.01,
                        type: 2, pitch: 64, velocity: 127, instrument: ch
                    });
                }
            }
            // Final pedal off
            if (context.harmonicFrames.length > 0) {
                const lastFrame = context.harmonicFrames[context.harmonicFrames.length - 1];
                const endSec = applySwing(lastFrame.endBeat) * secondsPerBeat;
                for (const ch of pedalChannels) {
                    absoluteEvents.push({
                        time: endSec,
                        type: 2, pitch: 64, velocity: 0, instrument: ch
                    });
                }
            }
        }

        // The base mix is already applied via applyMixConfig().
        // Dynamics are handed natively and smoothly via note velocities calculated in the Idioms.

        absoluteEvents.sort((a, b) => a.time - b.time);
        
        console.log(`[PlaybackEngine] Prepared ${absoluteEvents.length} MIDI events from the track.`);
        
        this.events = absoluteEvents;
        this.nextEventIdx = 0;
        // Start playing soon, not 1s in the future, to avoid massive initial buffer push
        this.startTime = this.ac!.currentTime + 0.1; 
        this.isPlaying = true;

        if (this.timerWorker) {
            this.timerWorker.postMessage('start');
        }
        
        // Immediately schedule the first batch of notes to prevent stutter/starvation 
        // while the timer worker starts up.
        this.schedule();
    }

    public stop(): void {
        this.isPlaying = false;
        // Important: Stop the schedule loop from processing any more notes
        this.events = [];
        this.nextEventIdx = 0;

        if (this.timerWorker) {
            this.timerWorker.postMessage('stop');
        }
        if (this.synth) {
            this.synth.stopAll(true);
            
            if (this.ac) {
                const now = this.ac.currentTime;
                // Dispatch across the lookahead buffer (which is now 0.1s + small margin)
                for (let ch = 0; ch < 16; ch++) {
                    try {
                        for (let offset = 0; offset <= 0.2; offset += 0.05) {
                            (this.synth as any).controllerChange(ch, 120, 0, { time: now + offset });
                            (this.synth as any).controllerChange(ch, 123, 0, { time: now + offset });
                            (this.synth as any).controllerChange(ch, 64, 0, { time: now + offset });
                        }
                    } catch (e) {
                         this.synth.controllerChange(ch, 120, 0);
                         this.synth.controllerChange(ch, 123, 0);
                         this.synth.controllerChange(ch, 64, 0);
                    }
                }
            }
        }
    }

    private schedule = (): void => {
        if (!this.isPlaying || !this.synth || !this.ac) return;

        const currentTime = this.ac.currentTime;
        // Keep lookahead small (100ms) so that 'stop' responds quickly and we don't block the main thread pushing everything
        const lookahead = 0.1;

        while (this.nextEventIdx < this.events.length) {
            const ev = this.events[this.nextEventIdx];
            const targetTime = this.startTime + ev.time;

            if (targetTime < currentTime + lookahead) {
                const channel = ev.instrument as number;

                if (ev.type === 0) { 
                    this.synth.noteOn(channel, ev.pitch, ev.velocity, { time: targetTime });
                } else if (ev.type === 1) {
                    this.synth.noteOff(channel, ev.pitch, { time: targetTime });
                } else if (ev.type === 2) {
                    try {
                        // Attempt to pass targetTime if supported by underlying implementation
                        (this.synth as any).controllerChange(channel, ev.pitch, ev.velocity, { time: targetTime });
                    } catch (e) {
                         this.synth.controllerChange(channel, ev.pitch as any, ev.velocity);
                    }
                }
                
                if (this.nextEventIdx === 0) {
                    console.log(`[PlaybackEngine] Dispatching first event: type=${ev.type} pitch=${ev.pitch} targetTime=${targetTime}`);
                }
                
                this.nextEventIdx++;
            } else {
                break;
            }
        }

        if (this.nextEventIdx >= this.events.length) {
            this.stop();
        } else if (!this.timerWorker) {
            // fallback if worker failed to initialize for some reason
            setTimeout(this.schedule, 50);
        }
    }
}


```

### File: `src/core/generation/engines/arrangement/ArrangementEngine.ts`

```typescript
import { ArrangedTrack, GeneratedTrack, MusicContext, NoteData, SectionType, RoleType, IdiomType, InstrumentConfig, MusicalRole, VibeType } from '../../types';
import { GrooveEngine } from '../groove/GrooveEngine';
import { IdiomDispatcher } from './idioms/IdiomDispatcher';
import { getInstrumentConfig } from '../../manifests/InstrumentRegistry';
import { MelodyEvasionPlugin } from './plugins/MelodyEvasionPlugin';

export class ArrangementEngine {
    private static applyPhysicalConstraints(notes: NoteData[], config: InstrumentConfig): NoteData[] {
        let result = [...notes];
        
        // 1. Min/Max Pitch Clamping
        result = result.map(n => {
            let p = n.pitch;
            while (p < config.minPitch) p += 12;
            while (p > config.maxPitch) p -= 12;
            return { ...n, pitch: p };
        });

        // 2. Anti-Mud Mechanism
        // Group notes by onset (with a tiny tolerance)
        result.sort((a, b) => a.onset - b.onset || a.pitch - b.pitch);
        
        const onsets: Record<string, NoteData[]> = {};
        result.forEach(n => {
            const key = (Math.round(n.onset * 100) / 100).toString();
            if (!onsets[key]) onsets[key] = [];
            onsets[key].push(n);
        });

        const finalNotes: NoteData[] = [];
        Object.values(onsets).forEach(chordNotes => {
            // Check anti-mud
            if (config.antiMudThreshold > 0) {
                // sort bottom to top
                chordNotes.sort((a, b) => a.pitch - b.pitch);
                for (let i = 0; i < chordNotes.length - 1; i++) {
                    const lower = chordNotes[i];
                    const upper = chordNotes[i+1];
                    // If both are below the mud threshold and strictly closer than a minor 3rd (3 semitones)
                    if (lower.pitch < config.antiMudThreshold && upper.pitch < config.antiMudThreshold) {
                        const interval = upper.pitch - lower.pitch;
                        if (interval > 0 && interval < 3) { // muddy!
                            upper.pitch += 12; 
                        }
                    }
                }
            }
            finalNotes.push(...chordNotes);
        });

        return finalNotes.sort((a, b) => a.onset - b.onset);
    }

    public static arrange(track: GeneratedTrack, context: MusicContext): ArrangedTrack {
        const lastChordEnd = track.chords.length > 0 ? track.chords[track.chords.length - 1].endBeat : 0;
        const lastSectionEnd = track.sections.length > 0 ? track.sections[track.sections.length - 1].endBeat : 0;
        const totalBeats = Math.max(lastChordEnd, lastSectionEnd);
        
        let drumTrack: NoteData[] = track.drums || [];
        let grooveDNA: import('../../types').GrooveDNA = track.grooveDNA || context.grooveDNA || { anchors: [0], density: 0.5, intensity: 0.5 };

        if (!track.drums && context.style) {
            // Fallback just in case it wasn't generated
            const groove = GrooveEngine.generateGroove(context.style, totalBeats, context);
            drumTrack = groove.drumTrack;
            grooveDNA = groove.dna;
        }

        // --- Capability Negotiation ---
        const band = context.band || [];
        
        // Define all roles that need to be met for a complete song
        const neededRoles = [MusicalRole.Lead, MusicalRole.Accomp, MusicalRole.Bass];
        
        // Map from Musician ID to the roles they are assigned
        const musicianRoleAssignments = new Map<string, MusicalRole[]>();
        band.forEach(m => musicianRoleAssignments.set(m.id, []));
        
        // Attempt to assign each needed role to capable musicians
        for (const role of neededRoles) {
            // Find musicians in band capable of this role, favoring their primary designated role if possible
            const capableMusicians = band.filter(m => {
                const config = getInstrumentConfig(m.instrumentId);
                return config.capabilities?.includes(role);
            });
            
            if (capableMusicians.length > 0) {
                // Priority assignment (e.g. Lead role goes to MainInst if possible)
                let chosen = capableMusicians[0];
                if (role === MusicalRole.Lead) {
                    chosen = capableMusicians.find(m => m.role === RoleType.MainInst) || chosen;
                } else if (role === MusicalRole.Bass) {
                    chosen = capableMusicians.find(m => m.role === RoleType.Bass) || chosen;
                } else if (role === MusicalRole.Accomp) {
                    chosen = capableMusicians.find(m => m.role === RoleType.AccompInst) || chosen;
                }
                musicianRoleAssignments.get(chosen.id)?.push(role);
            }
        }
        
        // --- Dispatch Accompaniment ---
        context.melody = track.melody;
        
        // We accumulate generated notes from all musicians
        let finalMelody: NoteData[] = [];
        let finalPianoRH: NoteData[] = [];
        let finalPianoLH: NoteData[] = [];
        let finalPad: NoteData[] = [];
        
        band.forEach(musician => {
            const roles = musicianRoleAssignments.get(musician.id) || [];
            if (roles.length === 0 && musician.role !== RoleType.Drums && musician.role !== RoleType.Pad) return; // Unused or drums
            
            // Allow Pad to always play if present
            const activeRoles = [...roles];
            if (musician.role === RoleType.Pad && !activeRoles.includes(MusicalRole.Accomp)) {
                activeRoles.push(MusicalRole.Accomp);
            }

            // Generate for this musician with their specific roles
            // Here we dispatch to IdiomDispatcher but we pass the roles so the idiom knows what to do
            const idiomOutput = IdiomDispatcher.generateForMusician(
                musician,
                activeRoles,
                track,
                grooveDNA,
                context
            );
            
            const config = getInstrumentConfig(musician.instrumentId);
            
            // Merge results with physical constraints applied
            if (idiomOutput.melody) {
                finalMelody.push(...this.applyPhysicalConstraints(idiomOutput.melody, config));
            }
            if (idiomOutput.pianoRH) {
                finalPianoRH.push(...this.applyPhysicalConstraints(idiomOutput.pianoRH, config));
            }
            if (idiomOutput.pianoLH) {
                finalPianoLH.push(...this.applyPhysicalConstraints(idiomOutput.pianoLH, config));
            }
            if (idiomOutput.pad) {
                finalPad.push(...this.applyPhysicalConstraints(idiomOutput.pad, config));
            }
        });

        // If no band was provided, fallback to default generic behavior
        if (band.length === 0) {
            const { pianoLH, pianoRH } = IdiomDispatcher.generateAccompaniment(track.chords, track.sections, grooveDNA, context);
            finalMelody = track.melody.map(n => ({ ...n, pitch: n.pitch + track.keyOffset + 60 }));
            finalPianoRH = pianoRH.map(n => ({ ...n, pitch: n.pitch + track.keyOffset + 60 }));
            finalPianoLH = pianoLH.map(n => ({ ...n, pitch: n.pitch + track.keyOffset + 60 }));
            
            finalMelody = this.applyPhysicalConstraints(finalMelody, getInstrumentConfig(0));
            finalPianoRH = this.applyPhysicalConstraints(finalPianoRH, getInstrumentConfig(0));
            finalPianoLH = this.applyPhysicalConstraints(finalPianoLH, getInstrumentConfig(2));
        }

        // --- Apply Post-Processing Plugins ---
        // Plugins only mutate the properties of generated notes, they do not create pitches from scratch.
        const plugins = [
            new MelodyEvasionPlugin()
        ];
        
        plugins.sort((a, b) => a.priority - b.priority);

        const buildState = (notes: NoteData[], category: 'melody' | 'pianoRH' | 'pianoLH' | 'pad' | 'bass' | 'drums') => ({
            notes,
            chords: track.chords,
            sections: track.sections,
            context,
            grooveDNA,
            trackKeyOffset: track.keyOffset,
            instrumentCategory: category
        });

        plugins.forEach(p => p.apply(buildState(finalPianoRH, 'pianoRH')));
        plugins.forEach(p => p.apply(buildState(finalPianoLH, 'pianoLH')));
        plugins.forEach(p => p.apply(buildState(finalPad, 'pad')));

        // Vibe Post-Processing
        if (context.vibe === VibeType.Chill) {
            const applyChill = (notes: NoteData[], dragAmt: number) => {
                return notes.map(n => ({
                    ...n,
                    velocity: Math.max(0.1, n.velocity * 0.75), // Much softer
                    onset: n.onset + dragAmt // Laid back (behind the beat)
                }));
            };
            
            finalMelody = applyChill(finalMelody, 0.08); // Melody drags the most
            finalPianoRH = applyChill(finalPianoRH, 0.03); 
            finalPianoLH = applyChill(finalPianoLH, 0.04);
            finalPad = applyChill(finalPad, 0.02);
            drumTrack = applyChill(drumTrack, 0.0); // Drums keep time but play softer
        } else if (context.vibe === VibeType.Energetic) {
            const applyEnergy = (notes: NoteData[]) => {
                return notes.map(n => ({
                    ...n,
                    velocity: Math.min(1.0, n.velocity * 1.25), // Harder
                    onset: Math.max(0, n.onset - 0.01) // Slightly on top of the beat
                }));
            };
            finalMelody = applyEnergy(finalMelody);
            finalPianoRH = applyEnergy(finalPianoRH);
            finalPianoLH = applyEnergy(finalPianoLH);
            finalPad = applyEnergy(finalPad);
            drumTrack = applyEnergy(drumTrack);
        }

        return {
            bpm: track.bpm,
            key: track.key,
            absoluteStartBeat: track.absoluteStartBeat,
            timeSignature: track.timeSignature,
            melody: finalMelody,
            pianoLH: finalPianoLH,
            pianoRH: finalPianoRH,
            pad: finalPad,
            chords: track.chords,
            sections: track.sections,
            drums: drumTrack
        };
    }
}

```

### File: `src/core/generation/engines/arrangement/idioms/BaseAccompIdiom.ts`

```typescript
import { NoteData, GeneratedChord, SectionMetadata, GrooveDNA, ContourType, PianoMotifDNA, LHRole, RHRole, MusicContext, Tonality, ChordQuality, RoleType } from '../../../types';
import { MusicTheory, ChordQualityEnum } from '../../../theory/MusicTheory';
import { PRNGManager } from '../../../../utils/PRNG';
import { LickDictionary } from './LickDictionary';

export class RhythmSectionIdiom {
    public static generateAccompaniment(chords: GeneratedChord[], sections: SectionMetadata[], grooveDNA: GrooveDNA, context: MusicContext): { pianoLH: NoteData[]; pianoRH: NoteData[] } {
        const pianoLH: NoteData[] = [];
        const pianoRH: NoteData[] = [];
        
        let currentVoicing: number[] = [];
        let prevTopNote = -1;
        let consecutivePlays = 0; // Anti-typewriter mechanism

        // Attempt to extract personas from band configuration
        const accompMusician = context.band?.find(m => m.role === RoleType.AccompInst);
        const bassMusician = context.band?.find(m => m.role === RoleType.Bass);
        
        const accompPersona = accompMusician?.persona || { colorBias: 0.5, sparsityTendency: 0.5, contourPreference: ContourType.Alternating, syncopationAssault: 0.5, dynamicRange: [40, 100] };
        const bassPersona = bassMusician?.persona || { colorBias: 0.1, sparsityTendency: 0.5, contourPreference: ContourType.Alternating, syncopationAssault: 0.5, dynamicRange: [40, 100] };

        // Map Accomp Persona to RH DNA
        let rhRole = RHRole.Sparse;
        const busyLevel = 1.0 - accompPersona.sparsityTendency;
        if (busyLevel > 0.7) rhRole = RHRole.Linear;
        else if (accompPersona.syncopationAssault > 0.8) rhRole = RHRole.Comp;
        else if (busyLevel < 0.3) rhRole = RHRole.Block;
        else if (accompPersona.syncopationAssault > 0.6) rhRole = RHRole.Arp;

        // Map Bass Persona to LH DNA
        let lhRole = LHRole.Anchor;
        const bassBusyLevel = 1.0 - bassPersona.sparsityTendency;
        if (bassBusyLevel > 0.7 && bassPersona.syncopationAssault > 0.4) lhRole = LHRole.Walking;
        else if (bassPersona.syncopationAssault > 0.7 && bassBusyLevel > 0.5) lhRole = LHRole.Stride;
        else if (bassBusyLevel > 0.6) lhRole = LHRole.Comp;
        else if (bassBusyLevel > 0.8) lhRole = LHRole.Arp;

        const dna: PianoMotifDNA = {
            voicingPreference: accompPersona.colorBias, // 0 = close triads, 1 = wide extensions
            rhythmicAnchor: accompPersona.syncopationAssault, // 0 = on-beat, 1 = syncopated
            contour: accompPersona.contourPreference,
            densityBaseline: busyLevel,
            lhRole: lhRole,
            rhRole: rhRole,
            interlock: accompPersona.syncopationAssault > 0.5 ? 0.8 : 0.2 // High syncopation pushes hocketing
        };

        for (let ci = 0; ci < chords.length; ci++) {
            const chord = chords[ci];
            
            let currentSection = sections[0];
            let energy = 5;
            for (let i = 0; i < sections.length; i++) {
                if (chord.startBeat >= sections[i].startBeat - 0.001 && chord.startBeat < sections[i].endBeat - 0.001) { 
                    currentSection = sections[i];
                    energy = sections[i].energyLevel; 
                    break; 
                }
            }

            // Level 2: Section-level Evolution (Transformation Matrix)
            // As energy rises, we don't change the theme, we just multiply/scale the DNA parameters
            const normalizedEnergy = Math.max(0.1, energy / 10);
            
            // Mutated DNA for this section
            const sectionDensity = Math.min(1.0, dna.densityBaseline * (0.5 + normalizedEnergy));
            const sectionVoicingSpan = dna.voicingPreference + (normalizedEnergy - 0.5) * 0.5; // High energy expands voicing
            const sectionSyncopationTendency = Math.min(1.0, dna.rhythmicAnchor * (1.0 + normalizedEnergy * 0.5));

            const intervals = MusicTheory.getChordTones(chord.quality);
            const isAdvanced = intervals.length >= 4;
            
            let corePitches: number[] = [];
            let extPitches: number[] = [];
            for (let j = 0; j < intervals.length; j++) {
                // Rootless for RH if advanced
                if (isAdvanced && intervals[j] === 0) continue; 

                // Limit extensions based on tensionLimits
                let degree = (j * 2) + 1;
                if (context.style?.tensionLimits !== undefined && degree > context.style.tensionLimits) {
                    continue; 
                }
                
                let pitch = chord.root + intervals[j];
                if (intervals[j] < 12 && corePitches.length < 4) {
                    corePitches.push(pitch);
                } else {
                    extPitches.push(pitch);
                }
            }
            if (corePitches.length === 0) corePitches.push(chord.root);

            // Calculate Target Voicing (Voice Leading)
            let prevCenter = 0;
            if (currentVoicing.length > 0) {
                prevCenter = currentVoicing.reduce((a, b) => a + b, 0) / currentVoicing.length;
            }

            let bestVoicing: number[] = [];
            let bestDist = Infinity;
            let bestOct = 0;

            for (let inv = 0; inv < corePitches.length; inv++) {
                let invCore = [...corePitches];
                for (let i = 0; i < inv; i++) {
                    invCore[i] += 12;
                }
                invCore.sort((a,b) => a - b);
                
                for (let oct = -1; oct <= 1; oct++) {
                    let candidate = invCore.map(p => p + (oct * 12));
                    let center = candidate.reduce((a,b) => a + b, 0) / candidate.length;
                    let dist = Math.abs(center - prevCenter) + Math.abs(center) * 0.1;
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestVoicing = candidate;
                        bestOct = oct;
                    }
                }
            }

            let outVoicing = [...bestVoicing];
            for (let ext of extPitches) {
                let target = ext + (bestOct * 12);
                // Shift target up only if it's below the lowest note of the voicing
                // to prevent mud, but allow it to intermingle with core notes.
                // We just want it reasonably voiced. 
                while (target < outVoicing[0] + 5) target += 12;
                
                // Cap extreme high pitches - if target > 24 (C6), lower an octave
                if (target > 24 && target - 12 > outVoicing[0]) target -= 12;
                
                outVoicing.push(target);
            }

            const rawVoicing = outVoicing.sort((a, b) => a - b);
            currentVoicing = sectionVoicingSpan > 0.6 ? MusicTheory.getDrop2Voicing(rawVoicing) : rawVoicing;
            let rhVoicing = [...currentVoicing];

            const actualBassPc = chord.bassOverride !== undefined ? chord.bassOverride : chord.root;
            const bassPitch = actualBassPc - 24;

            // --- 新增：为大师级左手准备高级音程库 (Shell Voicing Intervals) ---
            const thirdExt = intervals.find(i => i === 3 || i === 4) || 4; // 大/小三度
            const fifthExt = intervals.find(i => i === 6 || i === 7 || i === 8) || 7;
            const seventhExt = intervals.find(i => i === 10 || i === 11) || 0; // 大/小七度

            let currentBeat = chord.startBeat;
            let lastLhIdx = -1;
            let lastRhStartIdx = -1;
            let lastRhCount = 0;

            let beatWithinChord = 0;
            
            // 🌟 【新增】：深沉低音记忆锁，防止左手像打桩机一样在一个和弦里重复砸根音
            let lhPlayedDeepRootThisChord = false; 

            // 🌟 【新增】：80/20 法则 (Persona Injection) 
            // 如果在此触发了乐手的特殊习惯 (Signature Licks)，则替换常规物理引擎推演
            const isSignaturePhrase = (accompPersona.signatureLickProb && PRNGManager.nextFloat(0, 1) < accompPersona.signatureLickProb);
            
            if (isSignaturePhrase) {
                // =========================================================
                // 【20% 乐手独有演绎】：查字典调用 Lick，并智能吸附到当前和弦
                // =========================================================
                const lick = LickDictionary.getRandomLick();
                const chordScale = [...corePitches, ...extPitches]; // 当前和弦合法的色彩音池
                
                lick.lh.forEach(note => {
                    const onset = currentBeat + note.offset;
                    if (onset < chord.endBeat) {
                        let rawPitch = bassPitch + 24 + note.pitchOffset;
                        // 🌟 修复：左手强制吸附到和弦内音，防止大小三度打架
                        let smartPitch = MusicTheory.snapToPool(rawPitch, corePitches);
                        let vel = note.velocity * 0.65; // 将字典里的“死”力度整体拉弱，保持优雅
                        pianoLH.push({ pitch: smartPitch, onset: onset, duration: note.duration, velocity: vel });
                    }
                });

                lick.rh.forEach(note => {
                    const onset = currentBeat + note.offset;
                    if (onset < chord.endBeat) {
                        let rawPitch = bassPitch + 24 + note.pitchOffset;
                        // 🌟 修复：右手吸附到包含延伸音的爵士音阶
                        let smartPitch = MusicTheory.snapToPool(rawPitch, chordScale);
                        let vel = note.velocity * 0.65;
                        if (smartPitch > 72) vel *= Math.max(0.6, 1.0 - (smartPitch - 72) * 0.015);
                        pianoRH.push({ pitch: smartPitch, onset: onset, duration: note.duration, velocity: vel });
                        prevTopNote = smartPitch; // 记录音高，为后面的 Solo 做平滑过渡
                    }
                });
                
                currentBeat += lick.durationBeats;
                if (currentBeat > chord.endBeat) currentBeat = chord.endBeat;

            } else {
                // =========================================================
                // 【80% 共性 / 基础框架演绎】：使用下面的微观物理约束求解器
                // =========================================================
                // Level 3: Microscopic Rendering - Physics Constraint Solver
                while (currentBeat < chord.endBeat - 0.001) {
                const relativeBeat = currentBeat % 4;
                
                // =========================================================
                // 🌟 1. 宏观建筑学：幽灵主唱遮罩 (Phantom Vocal Mask)
                // =========================================================
                const absoluteMeasure = Math.floor(currentBeat / 4);
                const barWithinPhrase = absoluteMeasure % 4; // 0, 1, 2, 3

                let phantomVocalActive = false;
                let isFillZone = false; 

                // 铺设 4 小节的伴奏剧本 (仅中高能量适用)
                if (normalizedEnergy > 0.3) {
                    if (barWithinPhrase === 0 || barWithinPhrase === 1) {
                        phantomVocalActive = true;     // 第 1、2 小节：主唱主场，钢琴必须让路
                    } else if (barWithinPhrase === 2) {
                        phantomVocalActive = false;    // 第 3 小节：主唱喘息，适合切分呼应
                    } else if (barWithinPhrase === 3) {
                        // 并不是每个 4 小节尽头都要加花！克制是美德。增加基于小节号的伪随机概率。
                        const phraseSeed = (absoluteMeasure * 137) % 100;
                        if (relativeBeat >= 2.0 && normalizedEnergy > 0.5 && phraseSeed > 80) { // 仅 20% 概率触发长加花
                            isFillZone = true;
                        }
                    }
                }

                // 🌟 2. 动机锁定 (Motif Locking) 替代 纯随机
                // 真正的律动不是靠 nextFloat 掷骰子，而是严格咬死底鼓的律动锚点
                const isMotifAnchor = grooveDNA.anchors.some(a => Math.abs(a - relativeBeat) < 0.05);

                // 动态修正当前的密度和右手角色
                let currentRHRole = dna.rhRole; 
                let dynamicDensity = sectionDensity;

                if (phantomVocalActive) {
                    dynamicDensity *= 0.75; // 歌手发声时略微留白，绝不改变核心织体 (Role)！
                }
                if (isFillZone && normalizedEnergy > 0.4 && currentRHRole !== RHRole.Linear) {
                    // 不需要强制每次句尾都切华丽音阶，这会导致极其刻意且出戏
                    // PhraseFillPlugin 会聪明地填补空白，这里不要改变伴奏手法
                }

                // Advanced step sizing: reduce busyness by defaulting to 8th notes (0.5), only use 16ths when very intense
                let stepDur = 0.5; 
                if (normalizedEnergy > 0.7 && (currentRHRole === RHRole.Linear || isFillZone)) {
                    stepDur = 0.25; 
                } 
                
                if (currentBeat + stepDur > chord.endBeat) {
                    stepDur = chord.endBeat - currentBeat;
                }
                if (stepDur < 0.05) stepDur = 0.25; // failsafe

                const isChordStart = Math.abs(currentBeat - chord.startBeat) < 0.01;
                const isWeakBeat = Math.abs(relativeBeat % 1) > 0.05;
                const isOffBeat16th = Math.abs(relativeBeat % 0.5) > 0.05 && stepDur === 0.25;
                const isGrooveAnchor = isMotifAnchor; // 统一锚点逻辑

                // 探测抢拍 (Push / Anticipation) 与过渡
                const timeToNextChord = chord.endBeat - currentBeat;
                // 如果距离下一个和弦 <= 0.5 拍，且当前是弱拍，视为“抢拍点”
                const isAnticipation = timeToNextChord > 0 && timeToNextChord <= 0.5 && isOffBeat16th;

                // --- 3. 约束求解器打分 (The Masked Solver) ---
                let playScoreLH = 0;
                let playScoreRH = 0;
                let isRestRH = false;
                let isRestLH = false;

                if (isGrooveAnchor) { 
                    playScoreRH += 30; // 🌟 律动主导权完全交给右手！
                    if (!phantomVocalActive && (dna.lhRole === LHRole.Comp || dna.lhRole === LHRole.Stride)) {
                        playScoreLH += 10; // 左手只做极其轻微的响应，废除30分无脑重砸
                    }
                }

                if (isFillZone) {
                    // 【情境 A：主唱换气，右手疯狂加花】
                    playScoreRH += 50; 
                    if (isOffBeat16th) playScoreRH += 20; 
                    playScoreLH -= 80; // 🌟 绝对避让：右手秀操作时，左手彻底闭嘴，严防低频浑浊！
                } 
                else if (phantomVocalActive) {
                    // 【情境 B：主唱正在开口，铺底期】
                    if (isChordStart) {
                        playScoreRH += 45; 
                        playScoreLH += 80; // 强拍稳稳砸下定海神针
                    } else if (!isMotifAnchor) {
                        playScoreRH -= 100; 
                        playScoreLH -= 100; 
                    } else {
                        if (PRNGManager.nextFloat(0,1) > dynamicDensity) playScoreRH -= 50;
                        playScoreLH -= 80; // 人声演唱期间，严禁左手在弱拍乱弹碎音
                    }
                } 
                else {
                    // 【情境 C：正常律动呼应】
                    if (isMotifAnchor) playScoreRH += 30;
                    if (isOffBeat16th && PRNGManager.nextFloat(0, 1) < dynamicDensity) playScoreRH += 15;
                }

                // 🌟 确保每个和弦有左手骨架支撑
                if (isChordStart || (relativeBeat === 0 && !lhPlayedDeepRootThisChord)) {
                    playScoreLH += 60; 
                } else if (relativeBeat === 2 && !phantomVocalActive) {
                    playScoreLH += 15; 
                    if (dna.lhRole === LHRole.Anchor) playScoreLH += 20;
                }

                // LH penalty on offbeats unless comping or arpeggiating
                if (isOffBeat16th && (dna.lhRole === LHRole.Anchor || dna.lhRole === LHRole.Stride)) {
                    playScoreLH -= 40;
                }
                
                // Walking bass wants to play on every quarter note (and sometimes skip/syncopate eighths)
                if (dna.lhRole === LHRole.Walking) {
                    if (isWeakBeat) playScoreLH += 40; // Play on 2 and 4!
                    if (relativeBeat % 1 === 0) playScoreLH += 50; // Play on 1 and 3!
                    if (isOffBeat16th) {
                        if (PRNGManager.nextFloat(0, 1) > 0.7) playScoreLH += 20; // occassional ghost eighths
                        else playScoreLH -= 50;
                    }
                }

                // 大师级节奏灵魂：奖励提前抢拍 (Push Beat)
                if (isAnticipation && sectionSyncopationTendency > 0.4 && !phantomVocalActive) {
                    playScoreLH += 50 * sectionSyncopationTendency; // 左手主动引导滑向下一个和弦
                    playScoreRH += 30 * sectionSyncopationTendency;
                }

                // 🌟 左右手智能互锁 (Hocketing)：避免齐奏硬砸，形成一问一答的 Call & Response
                if (dna.interlock > 0.4 && !isChordStart && !isAnticipation) {
                    if (playScoreRH > playScoreLH) {
                        playScoreLH -= 30 * dna.interlock; // 右手想表现，左手就安静退让
                    } else if (playScoreLH > playScoreRH) {
                        playScoreRH -= 30 * dna.interlock; 
                    }
                }

                if (currentRHRole === RHRole.Sparse) playScoreRH -= 15;

                // 5. Anti-Typewriter Fatigue & State Memory
                if (consecutivePlays >= 3 && currentRHRole !== RHRole.Linear) {
                    playScoreRH -= Math.pow(consecutivePlays, 2) * 10;
                } else if (consecutivePlays === 0 && !isChordStart && !phantomVocalActive) {
                    playScoreRH += dynamicDensity * 15;
                }

                // Decision Threshold
                const thresholdRH = 25 - (normalizedEnergy * 10); 
                const thresholdLH = 30 - (normalizedEnergy * 10); 
                
                let fireLH = playScoreLH > thresholdLH;
                let fireRH = playScoreRH > thresholdRH;

                if (fireRH) consecutivePlays++;
                else {
                    isRestRH = true;
                    consecutivePlays = 0;
                }
                
                if (!fireLH) isRestLH = true;

                // --- Rendering (Humanization & Dynamics) --- //
                // Phrase Breathing: long sine wave across measures for push/pull dynamics
                const phraseSwell = Math.sin((currentBeat / 8) * Math.PI) * 0.15 + 0.85; 
                let rhythmVel = isWeakBeat ? 0.35 : 0.55; // Lowered baseline velocity
                if (isGrooveAnchor) rhythmVel += 0.10;
                rhythmVel = Math.min(0.8, rhythmVel * (0.6 + normalizedEnergy * 0.25)) * phraseSwell; // Even softer overall

                // Micro-timing offset to simulate human imperfection
                const timingOffset = PRNGManager.nextFloat(-0.015, 0.015);

                // Left Hand
                if (fireLH) {
                    let lhPitches: number[] = [];
                    let lhDurations: number[] = [];
                    
                    // 🌟 核心判断：这次发声，是奠定和弦基调的“重低音首击”吗？
                    const isPrimaryBassHit = (isChordStart || isAnticipation || !lhPlayedDeepRootThisChord);

                    // 1. 半音经过音 (Chromatic Approach) - REMOVED (causes dissonant mud with pedal)
                    if (isAnticipation && timeToNextChord <= stepDur * 1.5 && timeToNextChord > 0 && ci < chords.length - 1 && normalizedEnergy > 0.4 && lhPlayedDeepRootThisChord && PRNGManager.nextFloat(0,1) < 0.0) {
                        // this block is never hit due to PRNG check < 0.0
                        let nextBassPc = chords[ci+1].bassOverride !== undefined ? chords[ci+1].bassOverride : chords[ci+1].root;
                        let nextBassPitch = nextBassPc - 24;
                        lhPitches.push(nextBassPitch > bassPitch ? nextBassPitch - 1 : nextBassPitch + 1);
                        lhDurations.push(stepDur * 0.8);
                    } 
                    // 2. 钢琴大师语态 (Root & Tenor Bounce Split)
                    else {
                        if (dna.lhRole === LHRole.Arp && !isPrimaryBassHit) {
                            let elapsedBeats = currentBeat - chord.startBeat;
                            let arpStep = normalizedEnergy > 0.6 ? 0.5 : 1.0;
                            
                            if (Math.abs(elapsedBeats % arpStep) < 0.05) {
                                let stepIdx = Math.round(elapsedBeats / arpStep);
                                
                                let arpPool = [bassPitch + fifthExt, bassPitch + 12];
                                if (thirdExt) arpPool.push(bassPitch + 12 + thirdExt);
                                if (seventhExt) arpPool.push(bassPitch + 12 + seventhExt);

                                // 增加琶音的样式多样性 (随小节变化而不同)
                                let pIdx = 0;
                                let maxIdx = arpPool.length - 1;
                                const arpSeed = absoluteMeasure % 4;

                                if (arpSeed === 0) {
                                    // 经典流向 (向上)
                                    pIdx = (stepIdx - 1) % arpPool.length;
                                } else if (arpSeed === 1) {
                                    // 流行折返 1-5-8-5
                                    let pattern = maxIdx > 1 ? [0, 1, 2, 1] : [0, 1, 0, 1];
                                    pIdx = pattern[(stepIdx - 1) % pattern.length];
                                } else if (arpSeed === 2) {
                                    // 更宽的跳跃
                                    let pattern = maxIdx > 1 ? [1, 2, 0, 2] : [1, 0, 1, 0];
                                    pIdx = pattern[(stepIdx - 1) % pattern.length];
                                } else {
                                    // 往复流动 (ping-pong sequence)
                                    let period = maxIdx > 0 ? maxIdx * 2 : 1;
                                    let pos = (stepIdx - 1) % period;
                                    if (pos < 0) pos += period;
                                    pIdx = pos <= maxIdx ? pos : period - pos;
                                }
                                
                                lhPitches.push(arpPool[pIdx]);
                                lhDurations.push(arpStep * 1.8); 
                            }
                        } 
                        else if (dna.lhRole === LHRole.Walking && !isPrimaryBassHit) {
                            // 3. Boogie/Walking Bass: Drive the rhythm with moving bass lines
                            let timeInBeat = (currentBeat - chord.startBeat);
                            let quarterStep = Math.floor(timeInBeat) % 4; // 0, 1, 2, 3
                            
                            let pattern = [bassPitch, bassPitch + thirdExt, bassPitch + fifthExt, bassPitch + 12];
                            // Mix it up slightly with 6ths or dom 7ths
                            if (seventhExt) pattern[3] = bassPitch + seventhExt;
                            
                            // To make it more natural, sometimes walk down
                            if (PRNGManager.nextFloat(0,1) > 0.8) {
                                pattern = [bassPitch, bassPitch + fifthExt, bassPitch + thirdExt, bassPitch];
                            }
                            
                            let noteP = pattern[quarterStep % pattern.length];
                            
                            // Ghost notes on offbeats or anticipations
                            if (isOffBeat16th || isAnticipation) {
                                noteP = pattern[(quarterStep + 1) % pattern.length];
                            }

                            lhPitches.push(noteP);
                            lhDurations.push(stepDur * 0.9);
                        }
                        else if (isPrimaryBassHit) {
                            // ==========================================
                            // 【贝斯手】：换和弦的第一击，砸下深沉的低音基石！
                            // ==========================================
                            lhPitches.push(bassPitch); // 极低频根音
                            if (normalizedEnergy > 0.7) lhPitches.push(bassPitch - 12); // 高潮加八度
                            
                            // 铺开宽广的声部 (1-5 或 1-10)
                            if (dna.lhRole === LHRole.Anchor || normalizedEnergy > 0.5) {
                                if (seventhExt && PRNGManager.nextFloat(0,1) > 0.5) lhPitches.push(bassPitch + 12 + seventhExt);
                                else lhPitches.push(bassPitch + 12 + thirdExt); 
                            }
                            
                            lhDurations.push(Math.max(2.0, timeToNextChord > 0 ? timeToNextChord : 4.0)); // 死死踩住延音踏板
                            lhPlayedDeepRootThisChord = true; // 🔒 锁定记忆：本和弦内，不准再砸重低音！
                        } 
                        else {
                            // ==========================================
                            // 【吉他手/律动大师】：弱拍的律动呼应 (Rootless Tenor Bounce)
                            // ==========================================
                            // 绝对不碰笨重的 bassPitch！手抬高到次中音区弹极其轻巧的壳和弦
                            let tenorBase = bassPitch + 12; 
                            
                            if (dna.lhRole === LHRole.Stride || dna.lhRole === LHRole.Comp) {
                                // 🌟 核心修复：如果右手去跑单音 Solo 了，左手必须接管复杂的爵士色彩和弦！
                                if (currentRHRole === RHRole.Linear || currentRHRole === RHRole.Arp) {
                                    // 提取算好的华丽声部（包含了 9/11/13 音），降八度作为左手无根音伴奏 (Rootless Voicing)
                                    let shellNotes = rhVoicing.map(p => p - 12);
                                    // 过滤掉太低的音防止浑浊，保留上方 3 个色彩音
                                    shellNotes = shellNotes.filter(p => p > bassPitch + 5).slice(-3);
                                    
                                    if (shellNotes.length > 0) {
                                        lhPitches.push(...shellNotes);
                                    } else {
                                        if (thirdExt) lhPitches.push(tenorBase + thirdExt);
                                        if (seventhExt) lhPitches.push(tenorBase + seventhExt);
                                    }
                                    lhDurations.push(stepDur * 1.5);
                                } else {
                                    // 右手在弹和弦，左手正常弹壳和弦
                                    if (thirdExt) lhPitches.push(tenorBase + thirdExt);
                                    if (seventhExt && PRNGManager.nextFloat(0,1) > 0.3) lhPitches.push(tenorBase + seventhExt);
                                    if (lhPitches.length === 0) lhPitches.push(tenorBase + fifthExt);
                                    lhDurations.push(stepDur * 1.2); 
                                }
                            }
                        }
                    }

                    // 3. 真实物理与微观触键渲染 (Ghost Notes 动态魔法)
                    for (let i = 0; i < lhPitches.length; i++) {
                        let strumOffset = (lhPitches.length > 1) ? i * PRNGManager.nextFloat(0.015, 0.03) : 0;
                        
                        let baseLhVel = rhythmVel * 0.65; // 左手基础力度要明显弱于右手
                        let noteVel = baseLhVel * PRNGManager.nextFloat(0.9, 1.05);
                        
                        if (i > 0) noteVel *= 0.55; // 减弱内声部，防止盖过右手旋律
                        
                        if (isPrimaryBassHit) {
                            noteVel *= 1.05; // 第一下强拍地基，扎实沉稳不过度
                        } else if (isAnticipation) {
                            noteVel *= 0.85; // 经过音
                        } else {
                            // 幽灵音 (Ghost Notes)
                            noteVel *= 0.55; 
                        }

                        if (lhPitches[i] !== undefined) {
                            pianoLH.push({
                                pitch: lhPitches[i],
                                onset: currentBeat + timingOffset + strumOffset,
                                duration: lhDurations[i] || stepDur,
                                velocity: Math.max(0, Math.min(1, noteVel))
                            });
                        }
                    }
                } else if (isRestLH) {
                    // 延音已交由 isPrimaryBassHit 的长 duration 接管，直接静默即可
                }

                // Right Hand & True Contour Resolution
                if (fireRH) {
                    lastRhStartIdx = pianoRH.length;
                    lastRhCount = 0;
                    
                    let availableNotes = [...rhVoicing];
                    let selectedNotes: number[] = [];
                    
                    if (currentRHRole === RHRole.Block || currentRHRole === RHRole.Comp || currentRHRole === RHRole.Sparse) {
                        selectedNotes = availableNotes;
                        
                        // Thin out the block chord if low energy, BUT NOT for Comp (which preserves extensions)
                        if ((currentRHRole === RHRole.Block || currentRHRole === RHRole.Sparse) && normalizedEnergy < 0.4 && selectedNotes.length > 2) {
                            // Retain top and bottom to avoid muddiness, but keep color if possible
                            selectedNotes = selectedNotes.length === 3 ? selectedNotes : [selectedNotes[0], selectedNotes[1], selectedNotes[selectedNotes.length - 1]];
                            selectedNotes = Array.from(new Set(selectedNotes)).sort((a,b)=>a-b);
                        }
                    } else if (currentRHRole === RHRole.Linear) {
                        // linear single-note lines
                        if (prevTopNote !== -1 && PRNGManager.nextFloat(0, 1) < 0.75) {
                            let dir = PRNGManager.nextFloat(0, 1) > 0.5 ? 1 : -1;
                            let target = prevTopNote;
                            // 倾向于级进 (Stepwise motion)
                            target += dir * (PRNGManager.nextFloat(0,1) > 0.6 ? 2 : 1);
                            
                            // 🌟 核心修复：吸附到当前和弦的延伸音池，绝不使用全局大调！
                            let chordScalePcs = [...corePitches, ...extPitches];
                            target = MusicTheory.snapToPool(target, chordScalePcs);
                            
                            // Cap extreme wandering
                            if (target > 24) target -= 12;
                            else if (target < 0) target += 12;
                            
                            selectedNotes = [target];
                        } else {
                            // 偶尔大跳到和弦核心音
                            const idx = Math.floor(PRNGManager.nextFloat(0, 1) * availableNotes.length);
                            selectedNotes = [availableNotes[idx]];
                        }
                    } else { // Arp
                        // Smart, evolving arpeggiator and syncopated rhythmic cell resolution
                        let extendedNotes = [...availableNotes];
                        // 扩展音域的高八度供琶音使用，特别是高能量区段
                        if (normalizedEnergy > 0.6) {
                            extendedNotes.push(availableNotes[0] + 12);
                            if (availableNotes.length > 1) extendedNotes.push(availableNotes[1] + 12);
                            extendedNotes.sort((a,b) => a - b);
                        }

                        let pLen = extendedNotes.length;
                        let smartPattern: number[];
                        
                        // 基于不同的 Contour 动态生成琶音 pattern，而不是固定的 [0,2,1,3]
                        // Introduce absoluteMeasure to evolve the pattern over time
                        const altSeed = absoluteMeasure % 3;
                        if (dna.contour === ContourType.Downward) {
                            smartPattern = Array.from({length: pLen}, (_, i) => pLen - 1 - i);
                        } else if (dna.contour === ContourType.Upward) {
                            smartPattern = Array.from({length: pLen}, (_, i) => i);
                        } else if (dna.contour === ContourType.Alternating) {
                            // 动态交替，随小节变化
                            if (pLen >= 4) {
                                if (altSeed === 0) smartPattern = [0, 2, 1, 3, 2, 4 % pLen, 3 % pLen, Math.min(5, pLen-1)];
                                else if (altSeed === 1) smartPattern = [0, 1, 2, 3, pLen-1, pLen-2, 1, 2];
                                else smartPattern = [0, 2, pLen-1, 1, 3, Math.min(4, pLen-1)];
                            }
                            else smartPattern = [0, pLen-1, Math.min(1, pLen-1), Math.max(0, pLen-2)];
                        } else {
                            // 随机倾向
                            smartPattern = [Math.floor(PRNGManager.nextFloat(0, 1) * pLen)];
                        }

                        let pIdx = smartPattern[beatWithinChord % smartPattern.length] % pLen;
                        let targetPitch = extendedNotes[pIdx];

                        selectedNotes = [targetPitch];
                    }

                    if (selectedNotes.length === 0) selectedNotes = [availableNotes[0]];
                    
                    // High energy adds block thickness even for arpeggios
                    if (currentRHRole !== RHRole.Block && selectedNotes.length === 1 && normalizedEnergy > 0.6 && isGrooveAnchor) {
                        selectedNotes.push(availableNotes[0]); 
                    }

                    // Humanized Strumming and Dynamics for RH
                    for (let i = 0; i < selectedNotes.length; i++) {
                        const pitch = selectedNotes[i];
                        
                        // Unison avoidance: check if LH just hit this exact pitch
                        let isUnison = false;
                        for (let l = Math.max(0, pianoLH.length - 3); l < pianoLH.length; l++) {
                             if (Math.abs(pianoLH[l].onset - (currentBeat + timingOffset)) < 0.05 && pianoLH[l].pitch === pitch) {
                                  isUnison = true; break;
                             }
                        }
                        if (isUnison) continue; // Drop the RH note to avoid double triggering
                        
                        // Slightly stagger notes in block chords (like a real hand rolling the chord)
                        let strumOffset = (selectedNotes.length > 1) ? i * PRNGManager.nextFloat(0.005, 0.012) : 0;
                        
                        // 伴奏钢琴不需要极其突出的“主旋律音”，而是追求整体的和弦色彩融合
                        // 特别是在爵士乐中，过亮的最高音会破坏和弦的暗色调张力
                        let topNoteMultiplier = (i === selectedNotes.length - 1 && selectedNotes.length > 1) ? 0.85 : 
                                                (i === 0 && selectedNotes.length > 2) ? 0.85 : 0.80; 

                        // 移除无脑的 * 1.1 全局提亮，使用更平缓的 Base Velocity
                        let rhVel = rhythmVel * topNoteMultiplier * PRNGManager.nextFloat(0.9, 1.05);

                        // 高音柔化：如果音高在C5(72)以上，线性降低力度避免刺耳
                        if (pitch > 72) {
                            rhVel *= Math.max(0.6, 1.0 - (pitch - 72) * 0.015);
                        }
                        
                        // --- 4. 智能延音踏板 (Smart Sustain) ---
                        // Simulate a real sustain pedal by explicitly keeping the notes playing until the chord changes, unless staccato.
                        let isPedaled = false;
                        if (currentRHRole === RHRole.Sparse || currentRHRole === RHRole.Block || currentRHRole === RHRole.Arp) {
                            // Arpeggios, blocks, and sparse chords all use heavy pedal
                            isPedaled = true;
                        }
                        if (isFillZone && normalizedEnergy > 0.6) isPedaled = false; // Lift pedal during dense fills
                        
                        let rhDur = stepDur * 0.8; // Default somewhat articulate
                        if (isPedaled) {
                            // Extend the note duration almost to the end of the current chord
                            // Add a max bound to prevent infinite ringing
                            rhDur = Math.min(4.0, Math.max(stepDur * 1.5, chord.endBeat - currentBeat - 0.05));
                        } else if (currentRHRole === RHRole.Comp) {
                            rhDur = stepDur * 0.7; // Brisk
                        }

                        pianoRH.push({ 
                            pitch, 
                            onset: currentBeat + timingOffset + strumOffset, 
                            duration: rhDur, 
                            velocity: Math.max(0, Math.min(1, rhVel)) 
                        });
                        lastRhCount++;
                    }
                    if (selectedNotes.length > 0) prevTopNote = selectedNotes[selectedNotes.length - 1];

                } else if (lastRhStartIdx !== -1) {
                    // Holding logic was moved directly into duration generation via isPedaled.
                    // Doing probabilistic duration extension here was causing weird staccato artifacts and clipping.
                }
                
                currentBeat += stepDur;
                if (fireRH) beatWithinChord++;
            }
            } // Close the else block for isSignaturePhrase
        }
        return { pianoLH, pianoRH };
    }
}

```

### File: `src/core/generation/engines/arrangement/idioms/BouncePianoIdiom.ts`

```typescript
import { GeneratedChord, SectionMetadata, GrooveDNA, MusicContext, NoteData, ChordQuality } from '../../../types';
import { PRNGManager } from '../../../../utils/PRNG';
import { MusicTheory } from '../../../theory/MusicTheory';

export class BouncePianoIdiom {
    public static generate(chords: GeneratedChord[], sections: SectionMetadata[], grooveDNA: GrooveDNA, context: MusicContext): { pianoLH: NoteData[]; pianoRH: NoteData[] } {
        const pianoLH: NoteData[] = [];
        const pianoRH: NoteData[] = [];
        
        let previousRhVoicing: number[] = [];

        const getEnergy = (beat: number) => {
            const sec = sections.find(s => beat >= s.startBeat && beat < s.endBeat) || sections[0];
            return sec ? sec.energyLevel : 5;
        };

        const hOffset = () => PRNGManager.nextFloat(-0.015, 0.015);
        const hVel = (v: number) => Math.min(1.0, Math.max(0.0, v * PRNGManager.nextFloat(0.9, 1.1)));

        for (let ci = 0; ci < chords.length; ci++) {
            const chord = chords[ci];
            const start = chord.startBeat;
            const end = chord.endBeat;
            const duration = end - start;
            const energy = getEnergy(start);
            const normalizedEnergy = energy / 10.0;
            
            const bassPc = chord.bassOverride !== undefined ? chord.bassOverride : chord.root;
            const kOffset = chord.keyOffset || 0;
            
            // LH Base Pitch around C2(36) to G2(43)
            let bassPitch = bassPc - 24; 
            if ((bassPitch + kOffset + 60) > 43) {
                bassPitch -= 12;
            }

            // LH alternate pitch (the 5th)
            let alternateBassPitch = (bassPitch + 7);
            if ((alternateBassPitch + kOffset + 60) > 43) {
                alternateBassPitch -= 12;
            }

            // RH Voicing Logic
            const third = MusicTheory.getChordTones(chord.quality).includes(3) ? 3 : 4;
            const intervals = MusicTheory.getChordTones(chord.quality);
            let rhPcs = intervals.map(i => (chord.root + i) % 12);
            
            let rhVoicing: number[] = [];
            
            if (previousRhVoicing.length === 0) {
                const relativeAnchor = 64 - 60 - kOffset;
                rhPcs.forEach((pc, idx) => {
                    let oct = Math.round((relativeAnchor - pc) / 12);
                    rhVoicing.push(pc + oct * 12);
                });
                rhVoicing.sort((a,b)=>a-b);
            } else {
                rhPcs.forEach(pc => {
                    let bestPitch = pc;
                    let bestDist = Infinity;
                    const relativeAnchor = 64 - 60 - kOffset;

                    for (let oct = -1; oct <= 1; oct++) {
                        let p = pc + oct * 12;
                        let dist = previousRhVoicing.reduce((min, prev) => Math.min(min, Math.abs(prev - p)), Infinity);
                        dist += Math.abs(p - relativeAnchor) * 0.5;
                        
                        if (dist < bestDist) {
                            bestDist = dist;
                            bestPitch = p;
                        }
                    }
                    rhVoicing.push(bestPitch);
                });
                
                rhVoicing = Array.from(new Set(rhVoicing));
                rhVoicing.sort((a,b)=>a-b);
            }
            previousRhVoicing = rhVoicing;

            // Generate "Oom-Pah" Lemon Tree Bounce Rhythm
            // LH plays on strong beats (0, 2 or 0, 1, 2, 3 depending on energy)
            // RH plays chords on upbeats (0.5, 1.5, 2.5, 3.5)
            
            const isHighEnergy = energy >= 6;
            
            for (let b = 0; b < duration; b += 0.5) {
                let currentBeat = start + b;
                
                // Downbeat (0.0, 1.0, 2.0, 3.0)
                if (b % 1 === 0) {
                    // Play Bass
                    let isPrimaryBeat = (b % 2 === 0);
                    let bp = (isPrimaryBeat) ? bassPitch : alternateBassPitch;
                    
                    let vel = isPrimaryBeat ? 0.75 : 0.65;
                    let dur = isHighEnergy ? 0.3 : 0.5; // staccato if high energy
                    
                    pianoLH.push({
                        pitch: bp,
                        onset: currentBeat + hOffset(),
                        duration: dur,
                        velocity: hVel(vel)
                    });
                } 
                // Upbeat (0.5, 1.5, 2.5, 3.5)
                else {
                    // Play Chords
                    rhVoicing.forEach((p, i) => {
                        let offset = i * 0.005; // very tight roll
                        let topNoteVelBoost = (i === rhVoicing.length - 1) ? 1.05 : 0.9;
                        let dur = 0.25; // bounce is short and staccato
                        let vel = 0.6;
                        
                        pianoRH.push({ 
                            pitch: p, 
                            onset: currentBeat + offset + hOffset(), 
                            duration: dur, 
                            velocity: hVel(vel * topNoteVelBoost) 
                        });
                    });
                }
            }
        }

        return { pianoLH, pianoRH };
    }
}

```

### File: `src/core/generation/engines/arrangement/idioms/IdiomDispatcher.ts`

```typescript
import { GeneratedChord, SectionMetadata, GrooveDNA, MusicContext, NoteData, IdiomType, RoleType, BandMusician, MusicalRole, GeneratedTrack } from '../../../types';
import { RhythmSectionIdiom as GenericPianoIdiom } from './BaseAccompIdiom';
import { PopPadIdiom } from './PopPadIdiom';
import { ModernPianoIdiom } from './ModernPianoIdiom';
import { BouncePianoIdiom } from './BouncePianoIdiom';
import { SynthLeadIdiom } from './SynthLeadIdiom';
import { getInstrumentConfig } from '../../../manifests/InstrumentRegistry';
import { ArrangementEngine } from '../ArrangementEngine';

export class IdiomDispatcher {
    public static getIdiomType(styleId: string, instrumentId: number): IdiomType {
        return IdiomType.GenericPiano;
    }

    public static generateAccompaniment(
        chords: GeneratedChord[], 
        sections: SectionMetadata[], 
        grooveDNA: GrooveDNA, 
        context: MusicContext,
        persona?: any
    ): { pianoLH: NoteData[]; pianoRH: NoteData[] } {
        if (persona && persona.idiomPreference === IdiomType.BouncePiano) {
            return BouncePianoIdiom.generate(chords, sections, grooveDNA, context);
        }
        return ModernPianoIdiom.generate(chords, sections, grooveDNA, context);
    }

    public static generateForMusician(
        musician: BandMusician,
        roles: MusicalRole[],
        track: GeneratedTrack,
        grooveDNA: GrooveDNA,
        context: MusicContext
    ): { melody?: NoteData[]; pianoRH?: NoteData[]; pianoLH?: NoteData[]; pad?: NoteData[] } {
        
        if (musician.role === RoleType.Pad || (musician.instrumentId >= 88 && musician.instrumentId <= 95)) {
            const { pianoLH, pianoRH } = PopPadIdiom.generate(track.chords, track.sections, grooveDNA, context);
            const padNotes = [...pianoRH, ...pianoLH].map(n => ({ ...n, pitch: n.pitch + track.keyOffset + 60 }));
            return { pad: padNotes };
        }

        const result: { melody?: NoteData[]; pianoRH?: NoteData[]; pianoLH?: NoteData[] } = {};

        // Dispatch Synth Lead (instrument Id 80-87)
        if (musician.instrumentId >= 80 && musician.instrumentId <= 87) {
            if (roles.includes(MusicalRole.Accomp) || roles.includes(MusicalRole.CounterMelody)) {
                const { pianoLH, pianoRH } = SynthLeadIdiom.generate(track.chords, track.sections, grooveDNA, context);
                // Map the output to pianoRH/LH for the engine
                result.pianoRH = pianoRH.map(n => ({ ...n, pitch: n.pitch + track.keyOffset + 60 }));
                result.pianoLH = pianoLH.map(n => ({ ...n, pitch: n.pitch + track.keyOffset + 60 }));
            }
            if (roles.includes(MusicalRole.Lead)) {
                result.melody = track.melody.map(n => ({
                    ...n,
                    pitch: n.pitch + track.keyOffset + 60,
                    velocity: Math.min(1.0, n.velocity * 0.9) // softened slightly
                }));
            }
            return result;
        }

        // If this musician handles the accompaniment or bass
        if (roles.includes(MusicalRole.Accomp) || roles.includes(MusicalRole.Bass)) {
            let pianoLH, pianoRH;
            
            if (musician.persona && musician.persona.idiomPreference === IdiomType.BouncePiano) {
                const res = BouncePianoIdiom.generate(track.chords, track.sections, grooveDNA, context);
                pianoLH = res.pianoLH;
                pianoRH = res.pianoRH;
            } else {
                const res = ModernPianoIdiom.generate(track.chords, track.sections, grooveDNA, context);
                pianoLH = res.pianoLH;
                pianoRH = res.pianoRH;
            }

            
            if (roles.includes(MusicalRole.Bass)) {
                result.pianoLH = pianoLH.map(n => ({ ...n, pitch: n.pitch + track.keyOffset + 60 }));
            }
            if (roles.includes(MusicalRole.Accomp)) {
                result.pianoRH = pianoRH.map(n => ({ ...n, pitch: n.pitch + track.keyOffset + 60 }));
                // If it's pure accompaniment (no bass), we still might want some LH context 
                // but the engine combines them later anyway.
                if (!roles.includes(MusicalRole.Bass)) {
                     result.pianoLH = pianoLH.map(n => ({ ...n, pitch: n.pitch + track.keyOffset + 60 }));
                }
            }
        }

        // If this musician handles the lead melody
        if (roles.includes(MusicalRole.Lead)) {
            let srcMelody = track.melody.map(n => ({
                ...n,
                pitch: n.pitch + track.keyOffset + 60,
                // Soften slightly when played by band
                velocity: Math.min(1.0, n.velocity * 0.9)
            }));
            
            // If they are also playing accompaniment, don't output overlapping notes in RH? 
            // Actually, the user's "third hand" complaint means we should just output the melody to the melody track.
            result.melody = srcMelody;
        }

        return result;
    }
}


```

### File: `src/core/generation/engines/arrangement/idioms/IdiomUtils.ts`

```typescript
import { GeneratedChord, Tonality } from '../../../types';
import { MusicTheory } from '../../../theory/MusicTheory';

export class IdiomUtils {
    // Calculates core vs extended pitches and optimal voice leading
    public static calculateVoicing(
        chord: GeneratedChord,
        currentVoicing: number[],
        sectionVoicingSpan: number,
        tensionLimits?: number, // Limit like 7, 9, 11, 13
        allocatedTargetPcs?: number[],
        colorBias: number = 0.5
    ): { rhVoicing: number[], actualBassPc: number, bassPitch: number, intervals: number[] } {
        const intervals = MusicTheory.getChordTones(chord.quality);
        const isAdvanced = intervals.length >= 4;
        
        let corePitches: number[] = [];
        let extPitches: number[] = [];
        
        if (allocatedTargetPcs && allocatedTargetPcs.length > 0) {
            // Distinguish essentials from tensions
            // Assuming the first 3 or 4 allocations are essentials if they map to 1 3 5 7
            for (const pc of allocatedTargetPcs) {
                const isEssential = intervals.some(i => (chord.root + i) % 12 === pc) && (corePitches.length < 4);
                if (isEssential) {
                    corePitches.push(pc);
                } else {
                    // 🧠 核心修复：如果这个音是宏观大脑生成的高阶变化和弦（如 7b9 的 b9音）所明确包含的，必须100%强制渲染！
                    const isExplicitTension = intervals.some(i => (chord.root + i) % 12 === pc);
                    if (isExplicitTension || (Math.random() < colorBias && extPitches.length < 2)) {
                        extPitches.push(pc);
                    }
                }
            }
        } else {
            // Fallback: Use standard chord tones and tension limits
            for (let j = 0; j < intervals.length; j++) {
                if (isAdvanced && intervals[j] === 0) continue; // Rootless 
                let pitch = chord.root + intervals[j];
                
                // Limit extensions based on tensionLimits
                let degree = (j * 2) + 1; // approx representation
                if (tensionLimits !== undefined && degree > tensionLimits) {
                    continue; 
                }

                if (intervals[j] < 12 && corePitches.length < 4) {
                    corePitches.push(pitch);
                } else {
                    if (Math.random() < colorBias && extPitches.length < 2) {
                        extPitches.push(pitch);
                    }
                }
            }
        }

        if (corePitches.length === 0) corePitches.push(chord.root);

        // Make all pitches positive module 12
        corePitches = corePitches.map(p => {
            while(p < 0) p += 12;
            return p % 12;
        });
        
        // Remove duplicates
        corePitches = Array.from(new Set(corePitches));

        let prevCenter = 0;
        if (currentVoicing.length > 0) {
            prevCenter = currentVoicing.reduce((a, b) => a + b, 0) / currentVoicing.length;
        }

        let bestVoicing: number[] = [];
        let bestDist = Infinity;
        let bestOct = 0;

        for (let inv = 0; inv < corePitches.length; inv++) {
            let invCore = [...corePitches];
            for (let i = 0; i < inv; i++) {
                invCore[i] += 12;
            }
            invCore.sort((a,b) => a - b);
            
            let penalty = 0;
            if (invCore.length > 1 && (invCore[1] - invCore[0] <= 2)) penalty = 12; // High penalty for minor/major 2nd at the bottom
            
            for (let oct = -1; oct <= 1; oct++) {
                let candidate = invCore.map(p => p + (oct * 12));
                let center = candidate.reduce((a,b) => a + b, 0) / candidate.length;
                let dist = Math.abs(center - prevCenter) + Math.abs(center) * 0.1 + penalty;
                if (dist < bestDist) {
                    bestDist = dist;
                    bestVoicing = candidate;
                    bestOct = oct;
                }
            }
        }

        let outVoicing = [...bestVoicing];
        for (let ext of extPitches) {
            let target = ext + (bestOct * 12);
            while (target < outVoicing[0] + 3) target += 12; // Avoid muddying bass
            while (target > outVoicing[0] + 16) target -= 12; // Keep compact
            outVoicing.push(target);
            outVoicing.sort((a, b) => a - b);
        }

        const rawVoicing = outVoicing;
        let finalVoicing = sectionVoicingSpan > 0.6 && rawVoicing.length <= 4 ? MusicTheory.getDrop2Voicing(rawVoicing) : rawVoicing;

        const actualBassPc = chord.bassOverride !== undefined ? chord.bassOverride : chord.root;
        const bassPitch = actualBassPc - 24;

        return { rhVoicing: finalVoicing, actualBassPc, bassPitch, intervals };
    }
}

```

### File: `src/core/generation/engines/arrangement/idioms/LickDictionary.ts`

```typescript
import { NoteData } from '../../../types';
import { PRNGManager } from '../../../../utils/PRNG';

export interface Lick {
    name: string;
    durationBeats: number;
    // offsets are relative to chord start, pitches are relative to chord root (0 = root)
    lh: { offset: number, duration: number, pitchOffset: number, velocity: number }[];
    rh: { offset: number, duration: number, pitchOffset: number, velocity: number }[];
}

export class LickDictionary {
    private static licks: Lick[] = [
        {
            name: "Bebop II-V-I Run",
            durationBeats: 4,
            lh: [
                { offset: 0, duration: 1.5, pitchOffset: -12, velocity: 0.8 }, // Root
                { offset: 0, duration: 1.5, pitchOffset: 4, velocity: 0.7 },   // Third
                { offset: 0, duration: 1.5, pitchOffset: 10, velocity: 0.7 },  // Seventh
                { offset: 2.5, duration: 1, pitchOffset: 4, velocity: 0.6 },
                { offset: 2.5, duration: 1, pitchOffset: 10, velocity: 0.6 }
            ],
            rh: [
                { offset: 0.5, duration: 0.25, pitchOffset: 14, velocity: 0.9 }, // 9th
                { offset: 0.75, duration: 0.25, pitchOffset: 12, velocity: 0.8 }, // Octave
                { offset: 1.0, duration: 0.25, pitchOffset: 10, velocity: 0.85 }, // 7th
                { offset: 1.25, duration: 0.25, pitchOffset: 9, velocity: 0.8 }, // 13th
                { offset: 1.5, duration: 0.25, pitchOffset: 7, velocity: 0.9 }, // 5th
                { offset: 1.75, duration: 0.25, pitchOffset: 5, velocity: 0.75 }, // 11th
                { offset: 2.0, duration: 0.25, pitchOffset: 4, velocity: 0.85 }, // 3rd
                { offset: 2.25, duration: 0.5, pitchOffset: -1, velocity: 0.7 }, // Chromatic approach
                { offset: 2.75, duration: 1.25, pitchOffset: 0, velocity: 0.95 } // Resolve to root
            ]
        },
        {
            name: "Syncopated Latin Comp",
            durationBeats: 2,
            lh: [
                { offset: 0, duration: 0.5, pitchOffset: -12, velocity: 0.85 }, 
                { offset: 1.5, duration: 0.5, pitchOffset: -5, velocity: 0.8 } 
            ],
            rh: [
                { offset: 0.5, duration: 0.5, pitchOffset: 4, velocity: 0.85 },
                { offset: 0.5, duration: 0.5, pitchOffset: 7, velocity: 0.85 },
                { offset: 0.5, duration: 0.5, pitchOffset: 10, velocity: 0.85 },
                { offset: 1.5, duration: 0.5, pitchOffset: 4, velocity: 0.9 },
                { offset: 1.5, duration: 0.5, pitchOffset: 7, velocity: 0.9 },
                { offset: 1.5, duration: 0.5, pitchOffset: 10, velocity: 0.9 }
            ]
        },
        {
            name: "Bluesy Double Stop Lick",
            durationBeats: 2,
            lh: [
                { offset: 0, duration: 1.5, pitchOffset: -12, velocity: 0.9 },
                { offset: 0, duration: 1.5, pitchOffset: -5, velocity: 0.8 }
            ],
            rh: [
                { offset: 0, duration: 0.25, pitchOffset: 3, velocity: 0.8 }, // Minor 3rd slide
                { offset: 0.25, duration: 0.25, pitchOffset: 4, velocity: 0.9 }, // Major 3rd
                { offset: 0.25, duration: 0.25, pitchOffset: 7, velocity: 0.9 }, 
                { offset: 0.75, duration: 0.5, pitchOffset: 10, velocity: 0.85 }, // Minor 7th
                { offset: 0.75, duration: 0.5, pitchOffset: 15, velocity: 0.85 }, 
                { offset: 1.5, duration: 0.5, pitchOffset: 12, velocity: 1.0 } // Root octave
            ]
        },
        {
            name: "Charlie Parker Style Triplet",
            durationBeats: 2,
            lh: [
                { offset: 0, duration: 1.0, pitchOffset: -12, velocity: 0.8 },
                { offset: 0, duration: 1.0, pitchOffset: 4, velocity: 0.7 },
                { offset: 0, duration: 1.0, pitchOffset: 10, velocity: 0.7 }
            ],
            rh: [
                { offset: 0, duration: 0.33, pitchOffset: 14, velocity: 0.8 },
                { offset: 0.33, duration: 0.33, pitchOffset: 12, velocity: 0.85 },
                { offset: 0.66, duration: 0.33, pitchOffset: 10, velocity: 0.8 },
                { offset: 1.0, duration: 0.5, pitchOffset: 14, velocity: 0.9 },
                { offset: 1.5, duration: 0.5, pitchOffset: 16, velocity: 0.9 }
            ]
        }
    ];

    public static getRandomLick(): Lick {
        const idx = Math.floor(PRNGManager.nextFloat(0, 1) * this.licks.length);
        return this.licks[idx];
    }
}

```

### File: `src/core/generation/engines/arrangement/idioms/ModernPianoIdiom.ts`

```typescript
import { GeneratedChord, SectionMetadata, GrooveDNA, MusicContext, NoteData, MusicalRole, ChordQuality } from '../../../types';
import { PRNGManager } from '../../../../utils/PRNG';
import { MusicTheory } from '../../../theory/MusicTheory';

export class ModernPianoIdiom {
    public static generate(chords: GeneratedChord[], sections: SectionMetadata[], grooveDNA: GrooveDNA, context: MusicContext): { pianoLH: NoteData[]; pianoRH: NoteData[] } {
        const pianoLH: NoteData[] = [];
        const pianoRH: NoteData[] = [];
        
        let previousRhVoicing: number[] = [];

        // Determine general velocity coefficient
        const getEnergy = (beat: number) => {
            const sec = sections.find(s => beat >= s.startBeat && beat < s.endBeat) || sections[0];
            return sec ? sec.energyLevel : 5;
        };

        const hOffset = () => PRNGManager.nextFloat(-0.015, 0.015);
        const hVel = (v: number) => Math.min(1.0, Math.max(0.0, v * PRNGManager.nextFloat(0.9, 1.1)));

        for (let ci = 0; ci < chords.length; ci++) {
            const chord = chords[ci];
            const start = chord.startBeat;
            const end = chord.endBeat;
            const duration = end - start;
            const energy = getEnergy(start);
            const normalizedEnergy = energy / 10.0;
            
            const bassPc = chord.bassOverride !== undefined ? chord.bassOverride : chord.root;
            const kOffset = chord.keyOffset || 0;
            let bassPitch = bassPc - 24; 
            // Absolute bass pitch will be bassPc + kOffset + 36. 
            // We want the absolute bass pitch to stay between C2(36) and G2(43) approximately.
            if ((bassPitch + kOffset + 60) > 43) { // If it goes above G2
                bassPitch -= 12;
            }

            // --- 1. LH: Anchor & Foundation (Root, 5th, 10th) ---
            let lhVoicing: number[] = [bassPitch];
            const third = MusicTheory.getChordTones(chord.quality).includes(3) ? 3 : 4;
            
            if (energy >= 4) {
                lhVoicing.push(bassPitch + 7); // Perfect 5th
            }
            if (energy >= 6) {
                // Determine the 10th (or 4th for sus)
                if (chord.quality === ChordQuality.Sus4 || chord.quality === ChordQuality.Dominant7Sus4) {
                    lhVoicing.push(bassPitch + 12 + 5); 
                } else if ([ChordQuality.Minor, ChordQuality.Minor7, ChordQuality.Minor9, ChordQuality.Minor11, ChordQuality.Diminished, ChordQuality.Diminished7, ChordQuality.HalfDiminished].includes(chord.quality)) {
                    lhVoicing.push(bassPitch + 12 + 3); 
                } else {
                    lhVoicing.push(bassPitch + 12 + third);
                }
            }

            // --- 2. RH: Color & Voice Leading (Rootless Extensions) ---
            // Extract the upper extensions from the chord symbol
            const intervals = MusicTheory.getChordTones(chord.quality);
            let rhPcs = intervals.filter(i => i !== 0 && i !== 7).map(i => (chord.root + i) % 12); // Remove root and 5th
            
            // If it's a simple triad, just use 3 and 5, perhaps add a 9th for color
            if (rhPcs.length === 0) {
                 rhPcs = [(chord.root + third) % 12, (chord.root + 7) % 12];
                 if (PRNGManager.nextFloat(0,1) > 0.5) rhPcs.push((chord.root + 2) % 12); // add 9
            } else if (rhPcs.length === 1) { // Only 3rd
                 rhPcs.push((chord.root + 7) % 12);
            }
            
            // Ensure unique pitch classes
            rhPcs = Array.from(new Set(rhPcs));

            let rhVoicing: number[] = [];
            
            // Initial voicing or voice leading
            if (previousRhVoicing.length === 0) {
                const relativeAnchor = 64 - 60 - kOffset;
                rhPcs.forEach((pc, idx) => {
                    let oct = Math.round((relativeAnchor - pc) / 12); // Start around the anchor
                    // Spread out slightly
                    oct += Math.floor(idx / 3);
                    rhVoicing.push(pc + oct * 12);
                });
                rhVoicing.sort((a,b)=>a-b);
            } else {
                // Smooth Voice Leading: find the nearest available note in the next chord
                rhPcs.forEach(pc => {
                    let bestPitch = pc; // fallback
                    let bestDist = Infinity;
                    // Target absolute anchor around E4 (64)
                    const absoluteAnchor = 64;
                    const relativeAnchor = absoluteAnchor - 60 - kOffset;

                    // Check over standard RH range: G3(-5) to C6(24) in relative pitch
                    for (let oct = -2; oct <= 2; oct++) {
                        let p = pc + oct * 12;
                        let dist = previousRhVoicing.reduce((min, prev) => Math.min(min, Math.abs(prev - p)), Infinity);
                        
                        // Anchor to absolute E4 to prevent infinite drift
                        dist += Math.abs(p - relativeAnchor) * 0.5; 
                        
                        // Penalize extremes (below C3 or above G5)
                        const absP = p + kOffset + 60;
                        if (absP < 48) dist += 100;
                        if (absP > 79) dist += 100;
                        
                        const prevTop = previousRhVoicing[previousRhVoicing.length - 1];
                        if (prevTop !== undefined) {
                            dist += Math.abs(p - prevTop) * 0.4;
                        }

                        if (dist < bestDist) {
                            bestDist = dist;
                            bestPitch = p;
                        }
                    }
                    rhVoicing.push(bestPitch);
                });
                
                rhVoicing = Array.from(new Set(rhVoicing));
                rhVoicing.sort((a,b)=>a-b);
                
                // Prevent tight clusters at the bottom
                let shifts = 0;
                while (rhVoicing.length > 2 && rhVoicing[1] - rhVoicing[0] <= 3 && shifts < 2) {
                    rhVoicing[0] += 12; 
                    rhVoicing.sort((a,b)=>a-b);
                    shifts++;
                }

                // Hard fallback to prevent extremely high voicings
                const avgPitch = rhVoicing.reduce((a,b)=>a+b, 0) / Math.max(1, rhVoicing.length);
                const absAvgPitch = avgPitch + kOffset + 60;
                if (absAvgPitch > 74) { // D5
                    rhVoicing = rhVoicing.map(p => p - 12);
                } else if (absAvgPitch < 55) { // G3
                    rhVoicing = rhVoicing.map(p => p + 12);
                }
            }
            previousRhVoicing = rhVoicing;

            // --- 3. Rendering Rhythm and Interlocking ---
            const baseLhVel = 0.65;
            const baseRhVel = 0.60;
            
            // LH PLAYS
            // LH anchors on beat 1. If energy is high and duration > 2, it might play a passing note before next chord
            lhVoicing.forEach((p, idx) => {
                const tOffset = (idx > 0 && PRNGManager.nextFloat(0,1) > 0.5) ? idx * 0.5 : idx * 0.02; // Small roll or slow arpeggio
                if (tOffset < duration) {
                    pianoLH.push({ pitch: p, onset: start + tOffset + hOffset(), duration: duration - tOffset, velocity: hVel(baseLhVel * 0.9) });
                }
            });

            // RH PLAYS
            // Define rhythmic grid based on energy
            let rhRhythm: number[] = [];
            if (normalizedEnergy < 0.4) {
                // Block chords, mostly on weak beats or sustained
                rhRhythm = [0.5, 2.5].filter(b => b < duration);
                if (duration <= 2) rhRhythm = [0.5].filter(b => b < duration);
            } else if (normalizedEnergy < 0.7) {
                // Syncopated comping
                rhRhythm = [0.5, 1.5, 2.5, 3.0].filter(b => b < duration);
                // Randomly drop some to create space
                rhRhythm = rhRhythm.filter(() => PRNGManager.nextFloat(0,1) > 0.3);
            } else {
                // Busy driving arpeggios or rhythmic interlock
                for (let b = 0.5; b < duration; b += 0.5) {
                    if (PRNGManager.nextFloat(0,1) > 0.2) rhRhythm.push(b);
                }
            }
            
            // If completely empty, guarantee one hit
            if (rhRhythm.length === 0) rhRhythm.push(Math.min(0.5, duration / 2));

            const isArp = normalizedEnergy >= 0.6 && PRNGManager.nextFloat(0,1) > 0.5;
            
            rhRhythm.forEach(timeOffset => {
                let currentBeat = start + timeOffset;
                
                if (isArp) {
                    // Play a single note from the voicing
                    let noteIdx = Math.floor(PRNGManager.nextFloat(0, rhVoicing.length));
                    let p = rhVoicing[noteIdx];
                    let dur = (duration >= 2) ? 1.0 : 0.5;
                    pianoRH.push({ pitch: p, onset: currentBeat + hOffset(), duration: dur, velocity: hVel(baseRhVel) });
                } else {
                    // Play block chord
                    rhVoicing.forEach((p, i) => {
                        let offset = i * 0.015; // slight roll
                        let topNoteVelBoost = (i === rhVoicing.length - 1) ? 1.1 : 0.9;
                        let dur = (duration >= 2) ? 1.5 : 0.8;
                        pianoRH.push({ pitch: p, onset: currentBeat + offset + hOffset(), duration: dur, velocity: hVel(baseRhVel * topNoteVelBoost) });
                    });
                }
            });
        }

        return { pianoLH, pianoRH };
    }
}

```

### File: `src/core/generation/engines/arrangement/idioms/PopPadIdiom.ts`

```typescript
import { GeneratedChord, SectionMetadata, GrooveDNA, MusicContext, NoteData, RoleType } from '../../../types';
import { PRNGManager } from '../../../../utils/PRNG';
import { IdiomUtils } from './IdiomUtils';

export class PopPadIdiom {
    public static generate(chords: GeneratedChord[], sections: SectionMetadata[], grooveDNA: GrooveDNA, context: MusicContext): { pianoLH: NoteData[]; pianoRH: NoteData[] } {
        const pianoLH: NoteData[] = [];
        const pianoRH: NoteData[] = [];
        let currentVoicing: number[] = [];

        for (let ci = 0; ci < chords.length; ci++) {
            const chord = chords[ci];
            let energy = 5;
            for (let i = 0; i < sections.length; i++) {
                if (chord.startBeat >= sections[i].startBeat - 0.001 && chord.startBeat < sections[i].endBeat - 0.001) { 
                    energy = sections[i].energyLevel;
                    break; 
                }
            }

            const { rhVoicing, bassPitch } = IdiomUtils.calculateVoicing(
                chord, 
                currentVoicing, 
                energy / 10 + 0.5,
                context.style?.tensionLimits
            );
            currentVoicing = rhVoicing;

            const duration = chord.endBeat - chord.startBeat;
            const normalizedEnergy = Math.max(0.1, energy / 10);
            
            // Pad is usually very stable and even, lower velocity to avoid overpowering
            const vel = (0.4 + normalizedEnergy * 0.3) * 0.7; 
            
            // Overlapping legato for pad
            const legatoDuration = duration * 1.05;

            // Simple warm block chords
            const hOffset = () => PRNGManager.nextFloat(-0.02, 0.02);

            pianoLH.push({ pitch: bassPitch, onset: chord.startBeat + hOffset(), duration: legatoDuration, velocity: vel * 0.8 });
            pianoLH.push({ pitch: bassPitch + 7, onset: chord.startBeat + 0.1 + hOffset(), duration: legatoDuration, velocity: vel * 0.7 });

            rhVoicing.forEach((p, idx) => {
                pianoRH.push({ pitch: p, onset: chord.startBeat + idx * 0.05 + hOffset(), duration: legatoDuration, velocity: vel * 0.75 });
            });
            
            // Pulse on the half measure if duration is 4
            if (duration >= 4) {
                const midBeat = chord.startBeat + duration / 2;
                rhVoicing.forEach((p, idx) => {
                    pianoRH.push({ pitch: p, onset: midBeat + idx * 0.05 + hOffset(), duration: legatoDuration / 2, velocity: vel * 0.5 });
                });
            }
        }
        
        return { pianoLH, pianoRH };
    }
}

```

### File: `src/core/generation/engines/arrangement/idioms/SynthLeadIdiom.ts`

```typescript
import { GeneratedChord, SectionMetadata, GrooveDNA, MusicContext, NoteData } from '../../../types';
import { PRNGManager } from '../../../../utils/PRNG';
import { Synth80sPlugin } from './synth/Synth80sPlugin';
import { SynthRiffPlugin } from './synth/SynthRiffPlugin';
import { SynthLegatoPlugin } from '../plugins/SynthLegatoPlugin';
import { SynthBreathPlugin } from '../plugins/SynthBreathPlugin';

export class SynthLeadIdiom {
    public static generate(chords: GeneratedChord[], sections: SectionMetadata[], grooveDNA: GrooveDNA, context: MusicContext): { pianoLH: NoteData[]; pianoRH: NoteData[] } {
        // Intelligently choose the core texture for the synth lead accompaniment in this song
        const is80sStyle = context.style?.name?.toLowerCase().includes('80s') || PRNGManager.nextFloat(0, 1) > 0.5;

        let result;
        if (is80sStyle) {
            result = Synth80sPlugin.generate(chords, sections, grooveDNA, context);
        } else {
            result = SynthRiffPlugin.generate(chords, sections, grooveDNA, context);
        }

        // Apply universally requested synth traits
        // 1. Legato (连奏) to connect the "choppy" separated segmented notes
        result.pianoLH = SynthLegatoPlugin.apply(result.pianoLH, 0.2); // slight overlap
        result.pianoRH = SynthLegatoPlugin.apply(result.pianoRH, 0.15);

        // 2. Breath effect (呼吸感) to add dynamic swells to the otherwise static synth riffs
        result.pianoLH = SynthBreathPlugin.apply(result.pianoLH, 4.0); // 1-bar breath cycle
        result.pianoRH = SynthBreathPlugin.apply(result.pianoRH, 2.0); // half-bar phrase swells

        return result;
    }
}

```

### File: `src/core/generation/engines/arrangement/idioms/synth/Synth80sPlugin.ts`

```typescript
import { GeneratedChord, SectionMetadata, GrooveDNA, MusicContext, NoteData } from '../../../../types';
import { PRNGManager } from '../../../../../utils/PRNG';
import { IdiomUtils } from '../IdiomUtils';

export class Synth80sPlugin {
    public static generate(chords: GeneratedChord[], sections: SectionMetadata[], grooveDNA: GrooveDNA, context: MusicContext): { pianoLH: NoteData[]; pianoRH: NoteData[] } {
        const pianoLH: NoteData[] = [];
        const pianoRH: NoteData[] = [];
        let currentVoicing: number[] = [];

        // 80s texture core pattern selection
        const use16thBass = PRNGManager.nextFloat(0, 1) > 0.5;
        const useArpRH = PRNGManager.nextFloat(0, 1) > 0.2; // slight bias towards arp for synth
        
        // Define base arp pattern if ARP is used
        let arpPattern = [0, 1, 2, 1]; // relative indices to voicing

        for (let ci = 0; ci < chords.length; ci++) {
            const chord = chords[ci];
            let energy = 5;
            let sectionStartBeat = 0;
            // let sectionEndBeat = 0;
            for (let i = 0; i < sections.length; i++) {
                if (chord.startBeat >= sections[i].startBeat - 0.001 && chord.startBeat < sections[i].endBeat - 0.001) { 
                    energy = sections[i].energyLevel;
                    sectionStartBeat = sections[i].startBeat;
                    // sectionEndBeat = sections[i].endBeat;
                    break; 
                }
            }

            const duration = chord.endBeat - chord.startBeat;
            const normalizedEnergy = Math.max(0.1, energy / 10);
            const vel = 0.6 + normalizedEnergy * 0.3;

            // Arpeggio Direction & Pattern Variation Logic
            const barsSinceSectionStart = Math.floor((chord.startBeat - sectionStartBeat) / 4);
            const isChorusOrHighEnergy = energy >= 8;
            
            // Introduce subtle variation on the 9th bar (barsSinceSectionStart % 4 == 2 or 3 usually, or simply on odd 8-bar cycles)
            // Or just vary if energy is high. We keep it stable for 4 bars at a time.
            let currentArpPattern = [...arpPattern];
            let isDescending = false;

            if (isChorusOrHighEnergy) {
                // In chorus, maybe descend instead of ascend to provide contrast
                isDescending = true;
                currentArpPattern = [2, 1, 0, 1]; 
            } else if (barsSinceSectionStart % 4 >= 2) { // e.g. after 8 bars in a long section
                // Introduce a color variation pattern, maybe reaching higher
                currentArpPattern = [0, 2, 3, 1];
            }

            const { rhVoicing, bassPitch } = IdiomUtils.calculateVoicing(
                chord, 
                currentVoicing, 
                0.2, 
                context.style?.tensionLimits
            );
            currentVoicing = rhVoicing;

            // --- LH: Driving Bass ---
            const stepDurationLength = use16thBass ? 0.25 : 0.5;
            for (let b = chord.startBeat; b < chord.endBeat; b += stepDurationLength) {
                const beatInBar = b % 4;
                const isStrongBeat = beatInBar === 0 || beatInBar === 2;
                const isOffbeat = (b % 1) !== 0;
                
                const pitchChoice = (use16thBass && isOffbeat) ? bassPitch + 12 : bassPitch;
                
                pianoLH.push({
                    pitch: pitchChoice,
                    onset: b,
                    duration: stepDurationLength * 0.8,
                    velocity: vel * (isStrongBeat ? 1.0 : 0.8)
                });
            }

            // --- RH: Arp or Offbeat Pads ---
            if (useArpRH) {
                // Determine scale degrees and color emphasis
                const scaleDegrees = Array.from(new Set([bassPitch + 12, ...rhVoicing])).sort((a, b) => a - b);
                if (scaleDegrees.length === 0) scaleDegrees.push(chord.root + 60);

                let step = 0;
                for (let b = chord.startBeat; b < chord.endBeat; b += 0.5) { // 8th note arp by default
                    // 16th note arp for high energy
                    const stepSize = isChorusOrHighEnergy ? 0.25 : 0.5;
                    // Reset step within loop to handle different step sizes safely
                    
                    for(let subB = b; subB < Math.min(b + 0.5, chord.endBeat); subB += stepSize) {
                        const pitchIndex = currentArpPattern[step % currentArpPattern.length] % scaleDegrees.length;
                        
                        // If descending, we invert the index
                        let finalIndex = pitchIndex;
                        if (isDescending) {
                            finalIndex = (scaleDegrees.length - 1) - (pitchIndex % scaleDegrees.length);
                        }
                        
                        const pitch = scaleDegrees[Math.max(0, Math.min(scaleDegrees.length - 1, finalIndex))];
                        pianoRH.push({ 
                            pitch, 
                            onset: subB, 
                            duration: stepSize * 0.8, 
                            velocity: vel * 0.9 
                        });
                        step++;
                    }
                }
            } else {
                // Offbeat stab Pads
                for (let b = chord.startBeat; b < chord.endBeat; b += 1) {
                    const offbeat = b + 0.5;
                    if (offbeat < chord.endBeat) {
                        rhVoicing.forEach(p => {
                            pianoRH.push({ 
                                pitch: p, 
                                onset: offbeat, 
                                duration: 0.4, 
                                velocity: vel * 0.8 
                            });
                        });
                    }
                }
            }
        }
        
        return { pianoLH, pianoRH };
    }
}

```

### File: `src/core/generation/engines/arrangement/idioms/synth/SynthRiffPlugin.ts`

```typescript
import { GeneratedChord, SectionMetadata, GrooveDNA, MusicContext, NoteData } from '../../../../types';
import { PRNGManager } from '../../../../../utils/PRNG';
import { IdiomUtils } from '../IdiomUtils';
import { MusicTheory } from '../../../../theory/MusicTheory';

export class SynthRiffPlugin {
    public static generate(chords: GeneratedChord[], sections: SectionMetadata[], grooveDNA: GrooveDNA, context: MusicContext): { pianoLH: NoteData[]; pianoRH: NoteData[] } {
        const pianoLH: NoteData[] = [];
        const pianoRH: NoteData[] = [];

        // 1. Generate a 1-bar rhythmic motif for the riff
        const riffRhythm = this.generateRiffRhythm();
        // 2. Generate a relative contour motif (indices of chord tones)
        const baseContour = this.generateRiffContour(riffRhythm.length);

        let currentVoicing: number[] = [];

        for (let ci = 0; ci < chords.length; ci++) {
            const chord = chords[ci];
            let energy = 5;
            let sectionStartBeat = 0;
            for (let i = 0; i < sections.length; i++) {
                if (chord.startBeat >= sections[i].startBeat - 0.001 && chord.startBeat < sections[i].endBeat - 0.001) { 
                    energy = sections[i].energyLevel;
                    sectionStartBeat = sections[i].startBeat;
                    break; 
                }
            }

            const duration = chord.endBeat - chord.startBeat;
            const normalizedEnergy = Math.max(0.1, energy / 10);
            const vel = 0.6 + normalizedEnergy * 0.3;

            // Riff Variation Logic
            const barsSinceSectionStart = Math.floor((chord.startBeat - sectionStartBeat) / 4);
            const isChorusOrHighEnergy = energy >= 8;
            
            let currentContour = [...baseContour];
            let isDescending = false;

            if (isChorusOrHighEnergy) {
                // In chorus, invert the contour for energetic contrast
                isDescending = true;
            } else if (barsSinceSectionStart % 4 >= 2) {
                // Introduce a color/register variation pattern (shift contour up)
                currentContour = currentContour.map(c => c + 1);
            }

            const { rhVoicing, bassPitch } = IdiomUtils.calculateVoicing(
                chord, 
                currentVoicing, 
                0.2, 
                context.style?.tensionLimits
            );
            currentVoicing = rhVoicing;

            const arpNotes = Array.from(new Set([bassPitch, ...rhVoicing])).sort((a, b) => a - b);
            if (arpNotes.length === 0) arpNotes.push(chord.root + 60);

            // Apply riff motif repeatedly over the duration of the chord
            let currentBarStart = chord.startBeat;
            while (currentBarStart < chord.endBeat) {
                for (let i = 0; i < riffRhythm.length; i++) {
                    const r = riffRhythm[i];
                    const onset = currentBarStart + r.offset;
                    
                    if (onset >= chord.endBeat) break; // Don't overflow chord duration

                    const noteDuration = r.duration;
                    
                    // Map contour to current chord tones
                    let contourIndex = currentContour[i % currentContour.length] % arpNotes.length;
                    
                    if (isDescending) {
                        contourIndex = (arpNotes.length - 1) - (contourIndex % arpNotes.length);
                    }
                    
                    const pitch = arpNotes[Math.max(0, Math.min(arpNotes.length - 1, contourIndex))];

                    pianoRH.push({
                        pitch: pitch,
                        onset: onset,
                        duration: noteDuration,
                        velocity: vel * r.accent
                    });

                    // Strong beat reinforcement in LH
                    if (r.offset === 0 || r.offset === 2) {
                        pianoLH.push({
                            pitch: bassPitch,
                            onset: onset,
                            duration: 0.5,
                            velocity: vel * 0.8
                        });
                    }
                }
                currentBarStart += 4; // Advance to next bar
            }
        }
        
        return { pianoLH, pianoRH };
    }

    private static generateRiffRhythm(): { offset: number, duration: number, accent: number }[] {
        // Different common pop/electronic syncopated riff rhythms (1 bar = 4 beats)
        const patterns = [
            // Tresillo-like (3-3-2 in 8th notes): 0, 1.5, 3
            [
                { offset: 0, duration: 0.25, accent: 1.0 },
                { offset: 0.5, duration: 0.25, accent: 0.7 },
                { offset: 1.5, duration: 0.25, accent: 1.0 },
                { offset: 2.0, duration: 0.25, accent: 0.7 },
                { offset: 3.0, duration: 0.5, accent: 0.9 }
            ],
            // 4-on-the-floor syncopation
            [
                { offset: 0.5, duration: 0.25, accent: 0.8 },
                { offset: 1.5, duration: 0.25, accent: 1.0 },
                { offset: 2.5, duration: 0.25, accent: 0.9 },
                { offset: 3.5, duration: 0.25, accent: 0.8 }
            ],
            // Sparse stab
            [
                { offset: 0, duration: 0.5, accent: 1.0 },
                { offset: 2.5, duration: 0.5, accent: 0.9 }
            ]
        ];

        return patterns[Math.floor(PRNGManager.nextFloat(0, patterns.length))];
    }

    private static generateRiffContour(length: number): number[] {
        const contour: number[] = [];
        // Generate a random walk or specific shape for the motif
        let currentPos = PRNGManager.nextFloat(0, 1) > 0.5 ? 2 : 0;
        
        for (let i = 0; i < length; i++) {
            contour.push(currentPos);
            // Move up or down slightly
            const step = Math.floor(PRNGManager.nextFloat(0, 3)) - 1; // -1, 0, 1
            currentPos = Math.max(0, currentPos + step);
        }
        return contour;
    }
}

```

### File: `src/core/generation/engines/arrangement/plugins/ArrangementPlugin.ts`

```typescript
import { GeneratedChord, GrooveDNA, MusicContext, NoteData, SectionMetadata, InstrumentConfig } from '../../../types';

export interface ArrangementState {
    notes: NoteData[];
    chords: GeneratedChord[];
    sections: SectionMetadata[];
    context: MusicContext;
    grooveDNA: GrooveDNA;
    trackKeyOffset: number;
    instrumentCategory: 'melody' | 'pianoRH' | 'pianoLH' | 'pad' | 'bass' | 'drums';
}

export interface ArrangementPlugin {
    name: string;
    /**
     * Priority determines the order of execution. Lower numbers execute first.
     */
    priority: number;
    /**
     * Mutate the notes array in place based on context (e.g. adjust velocity, drop notes).
     * DO NOT generate absolute pitches from scratch here.
     */
    apply(state: ArrangementState): void;
}

```

### File: `src/core/generation/engines/arrangement/plugins/MelodyEvasionPlugin.ts`

```typescript
import { NoteData } from '../../../types';
import { ArrangementPlugin, ArrangementState } from './ArrangementPlugin';
import { PRNGManager } from '../../../../utils/PRNG';

/**
 * 旋律避让插件 (Melody Evasion Plugin)
 * 纯 Mutator 插件：不计算绝对音高，只通过 Core Engine 生成的音进行调整。
 * 当旋律密集时，自动弱化或删除伴奏轨道（尤其是右手）的冲突音符，为主旋律让出空间。
 */
export class MelodyEvasionPlugin implements ArrangementPlugin {
    name = 'MelodyEvasionPlugin';
    priority = 40; 

    apply(state: ArrangementState): void {
        const { notes, context, instrumentCategory } = state;
        
        // Only run for accompaniment
        if (instrumentCategory === 'melody' || instrumentCategory === 'drums' || instrumentCategory === 'bass') {
            return;
        }

        if (!context.melody || context.melody.length === 0) {
            return;
        }

        const srcMelody = context.melody.map(n => ({
            ...n,
            pitch: n.pitch + state.trackKeyOffset + 60
        }));

        const finalNotes: NoteData[] = [];

        notes.forEach(note => {
            const beatStart = Math.floor(note.onset);
            const melodyNotesInBeat = srcMelody.filter(m => m.onset >= beatStart && m.onset < beatStart + 1.0);
            
            const isDownbeat = (note.onset % 1) === 0;

            const overlappingMelody = srcMelody.find(m => 
                (note.onset >= m.onset - 0.15 && note.onset < m.onset + m.duration) ||
                (m.onset >= note.onset - 0.15 && m.onset < note.onset + note.duration)
            );

            let vel = note.velocity;
            let targetPitch = note.pitch; // Offset pitch if needed

            if (instrumentCategory === 'pianoLH') {
                if (melodyNotesInBeat.length > 2 && !isDownbeat && PRNGManager.nextFloat(0, 1) < 0.4) {
                    return; // Drop complex LH notes
                }
                
                if (overlappingMelody) {
                    vel *= 0.85; 
                } else if (melodyNotesInBeat.length === 0) {
                    vel *= 0.85; 
                }
            } else if (instrumentCategory === 'pianoRH' || instrumentCategory === 'pad') {
                if (melodyNotesInBeat.length >= 2) {
                    if ((note.onset % 1) !== 0 || note.duration < 1.0) {
                        vel *= 0.6; // Duck
                    }
                }

                if (!overlappingMelody) {
                    vel *= 0.85;
                } else {
                    if (Math.abs(targetPitch - overlappingMelody.pitch) < 3) {
                        targetPitch -= 12; // Shift octave down instead of recalculating absolute pitch
                        vel *= 0.7;
                    } else {
                        vel *= 0.8;
                    }
                }
            }
            
            finalNotes.push({ ...note, pitch: targetPitch, velocity: Math.min(1.0, vel) });
        });

        // Mutate array essentially by clearing and pushing
        notes.length = 0;
        notes.push(...finalNotes);
    }
}


```

### File: `src/core/generation/engines/arrangement/plugins/SynthBreathPlugin.ts`

```typescript
import { NoteData } from '../../../types';

export class SynthBreathPlugin {
    /**
     * Simulates "breath" (呼吸感) by shaping the velocities of the notes in an arc.
     * This mimics the way a synth pad or lead naturally swells in and out over time,
     * adding a human/dynamic feel to an otherwise static block of notes.
     */
    public static apply(notes: NoteData[], breathCycleBeats: number = 4.0): NoteData[] {
        if (!notes || notes.length === 0) return notes;
        
        const processed = [...notes];
        
        for (const note of processed) {
            // Calculate a slow sine wave LFO spanning `breathCycleBeats`
            // Modulate the volume to swell in and out
            // We use cosine so it peaks in the middle of the phrase/bar
            const phase = ((note.onset % breathCycleBeats) / breathCycleBeats) * Math.PI * 2;
            
            // LFO wave range from -1 to 1. 
            // We want it to subtract a bit at the ends and add a bit in the middle.
            const swellOffset = Math.sin(phase - Math.PI/2); 
            
            // Apply a subtle dynamic arc to the velocity
            const dynamicRange = 0.15; // 15% velocity variation
            note.velocity = Math.min(1.0, Math.max(0.1, note.velocity + (swellOffset * dynamicRange)));
        }
        
        return processed;
    }
}

```

### File: `src/core/generation/engines/arrangement/plugins/SynthLegatoPlugin.ts`

```typescript
import { NoteData } from '../../../types';

export class SynthLegatoPlugin {
    /**
     * Extends note durations slightly so they overlap with the next note.
     * This is a standard technique used in MIDI to trigger 'Legato' mode 
     * on synthesizers, creating a smooth connection rather than a staccato "segmented" feel.
     */
    public static apply(notes: NoteData[], overlapBeats: number = 0.15): NoteData[] {
        if (!notes || notes.length === 0) return notes;
        
        // Clone to avoid mutating original arrays deeply if they are shared
        const processed = [...notes].sort((a, b) => a.onset - b.onset);
        
        for (let i = 0; i < processed.length - 1; i++) {
            const current = processed[i];
            
            // Find the closest next note
            let nextNote = null;
            for (let j = i + 1; j < processed.length; j++) {
                if (processed[j].onset >= current.onset + 0.01) { // A true next onset
                    nextNote = processed[j];
                    break;
                }
            }
            
            if (nextNote) {
                const gap = nextNote.onset - (current.onset + current.duration);
                // If it's part of a phrase (gap is small), connect them
                if (gap >= -0.05 && gap <= 1.0) {
                    current.duration = (nextNote.onset - current.onset) + overlapBeats; 
                }
            }
        }
        
        return processed;
    }
}

```

### File: `src/core/generation/engines/composition/CompositionEngine.ts`

```typescript
import { PRNGManager } from '../../../utils/PRNG';
import { Tonality, MusicContext, GeneratedTrack, SectionMetadata, GeneratedChord, NoteData, SectionType, RoleType, BandMusician, VibeType } from '../../types';
import { HarmonyEngine } from '../harmony/HarmonyEngine';
import { GlobalVoicer } from '../harmony/GlobalVoicer';
import { MelodyEngine } from '../melody/MelodyEngine';
import { GrooveEngine } from '../groove/GrooveEngine';

import { DefaultHarmony, StyleRegistry } from '../../manifests/StyleRegistry';

const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export interface GenerationOptions {
    targetDurationSec?: number;
    style?: any;
    passingChordProb?: number;
    anticipationProb?: number;
    band?: import('../../types').BandMusician[]; // Pass down the band
    seed?: number; // Optional seed for deterministic generation
    vibe?: VibeType;
}

export class CompositionEngine {
    public static generateFullSong(options?: GenerationOptions): { track: GeneratedTrack; context: MusicContext } {
        // Use provided seed or generate a random one
        const seed = options?.seed !== undefined ? options.seed : ((Date.now() ^ Math.floor(Math.random() * 1000000)) >>> 0);
        PRNGManager.setSeed(seed);
        
        let bpm = PRNGManager.nextInt(90, 130);
        if (options?.vibe === VibeType.Chill) {
            bpm = PRNGManager.nextInt(70, 90);
        } else if (options?.vibe === VibeType.Energetic) {
            bpm = PRNGManager.nextInt(120, 160);
        }

        const tonalities = [Tonality.Major, Tonality.Minor];
        let tonality: Tonality = tonalities[PRNGManager.nextInt(0, 1)];
        let keyOffset = PRNGManager.nextInt(0, 11);
        let key = KEY_NAMES[keyOffset];

        // Generate sections based on target duration
        const targetDurationSec = options?.targetDurationSec || 150; // Let's default to 2.5 minutes for a complete song
        const targetBeats = (targetDurationSec * bpm) / 60;
        
        const sections: SectionMetadata[] = [];
        let currentBeat = 0;
        
        sections.push({ name: 'Intro', startBeat: currentBeat, endBeat: currentBeat + 16, energyLevel: 3, type: SectionType.Intro });
        currentBeat += 16;
        
        let verseCount = 1;
        let chorusCount = 1;
        
        while (currentBeat < targetBeats - 32) { // Reserve 32 for outro/last chorus
            const prevType = sections[sections.length - 1].type;
            
            if (chorusCount > 1 && verseCount > 2 && PRNGManager.nextFloat(0, 1) > 0.5 && prevType !== SectionType.Bridge) {
                sections.push({ name: 'Bridge', startBeat: currentBeat, endBeat: currentBeat + 16, energyLevel: 7, type: SectionType.Bridge });
                currentBeat += 16;
            } else if (prevType === SectionType.Chorus || prevType === SectionType.Intro || prevType === SectionType.Bridge) {
                // Verse
                sections.push({ name: `Verse ${verseCount}`, startBeat: currentBeat, endBeat: currentBeat + 16, energyLevel: 5, type: SectionType.Verse });
                currentBeat += 16;
                verseCount++;
            } else {
                // Chorus
                sections.push({ name: `Chorus ${chorusCount}`, startBeat: currentBeat, endBeat: currentBeat + 16, energyLevel: 8, type: SectionType.Chorus });
                currentBeat += 16;
                chorusCount++;
            }
        }
        
        // Final Chorus
        sections.push({ name: `Final Chorus`, startBeat: currentBeat, endBeat: currentBeat + 16, energyLevel: 9, type: SectionType.Chorus });
        currentBeat += 16;

        sections.push({ name: 'Outro', startBeat: currentBeat, endBeat: currentBeat + 16, energyLevel: 4, type: SectionType.Outro });
        currentBeat += 16;

        // Determine Global Style from Band
        let globalStyleId = 'Pop'; // Default
        if (options?.band) {
            const leadGroup = options.band.find(m => m.role === RoleType.MainInst || m.role === RoleType.Vocal);
            const accompGroup = options.band.find(m => m.role === RoleType.AccompInst);
            if (leadGroup) {
                globalStyleId = leadGroup.styleId;
            } else if (accompGroup) {
                globalStyleId = accompGroup.styleId;
            }
        }

        const registryStyle = (StyleRegistry as any)[globalStyleId];

        // Default 16-grid probabilities
        const defaultDrumProbabilities = [
            [1.0, 0.0, 0.8, 80, 110], // 1 (1.1)
            [0.1, 0.0, 0.5, 40, 60],  // 1 e
            [0.2, 0.0, 0.9, 50, 70],  // 1 &
            [0.0, 0.2, 0.5, 40, 60],  // 1 a
            
            [0.0, 1.0, 0.8, 90, 120], // 2 (1.2)
            [0.1, 0.0, 0.4, 40, 60],  // 2 e
            [0.4, 0.1, 0.9, 50, 70],  // 2 &
            [0.0, 0.1, 0.4, 40, 60],  // 2 a
            
            [0.8, 0.0, 0.8, 80, 100], // 3 (1.3)
            [0.1, 0.0, 0.5, 40, 60],  // 3 e
            [0.3, 0.0, 0.9, 50, 70],  // 3 &
            [0.2, 0.1, 0.5, 40, 60],  // 3 a
            
            [0.0, 1.0, 0.8, 90, 120], // 4 (1.4)
            [0.0, 0.1, 0.5, 40, 60],  // 4 e
            [0.2, 0.2, 0.9, 50, 70],  // 4 &
            [0.1, 0.3, 0.5, 40, 60],  // 4 a
        ];

        const defaultHarmony = DefaultHarmony;

        let style = registryStyle ? { ...registryStyle } : { drumProbabilities: defaultDrumProbabilities, harmony: defaultHarmony };
        if (options?.style) {
             style = { ...style, ...options.style };
        }
        if (!style.harmony) style.harmony = defaultHarmony;
        if (options?.passingChordProb !== undefined) style.passingChordProb = options.passingChordProb;
        if (options?.anticipationProb !== undefined) style.anticipationProb = options.anticipationProb;

        // 1 & 2. Groove Generation (Rhythm Skeleton)
        const totalBeats = currentBeat;
        const grooveResult = GrooveEngine.generateGroove(style, totalBeats, { 
            keyOffset, tonality, bpm, timeSignature: [4, 4], sections, band: options?.band, vibe: options?.vibe
        });

        // 3. Harmony Generation (Macro Blueprint)
        const basicChords: GeneratedChord[] = HarmonyEngine.generateHarmonyTimeline(sections, tonality, keyOffset, style);
        
        // 🚨 PASS 1: 提前生成基础的 HarmonicFrames，供旋律引擎读取 TargetPcs！
        const baseFrames = GlobalVoicer.createHarmonicFrames(basicChords, style.tensionLimits ?? 13, tonality, grooveResult.dna);

        const context: MusicContext = {
            keyOffset,
            tonality,
            bpm,
            timeSignature: [4, 4],
            sections,
            globalStyleId,
            style,
            band: options?.band,
            harmonicFrames: baseFrames, // 注入给 MelodyEngine
            seed,
            vibe: options?.vibe,
            grooveDNA: grooveResult.dna 
        };

        // 4. Melody Generation (此时旋律引擎终于能读到高级和弦音了！)
        const melody: NoteData[] = MelodyEngine.generateMelody(basicChords, context);

        // 5. Late Binding (PASS 2): 重新计算 Frames，让伴奏智能避让已经写好的主旋律
        const finalFrames = GlobalVoicer.createHarmonicFrames(basicChords, style.tensionLimits ?? 13, tonality, grooveResult.dna, melody);
        context.harmonicFrames = finalFrames;

        const track: GeneratedTrack = {
            chords: basicChords,
            harmonicFrames: finalFrames,
            melody,
            drums: grooveResult.drumTrack,
            grooveDNA: grooveResult.dna,
            bpm,
            key,
            keyOffset,
            tonality,
            timeSignature: [4, 4],
            sections,
            absoluteStartBeat: 0,
            hasIntro: true,
        };

        return { track, context };
    }
}

```

### File: `src/core/generation/engines/groove/GrooveEngine.ts`

```typescript
import { NoteData, StyleConfig, GrooveDNA, MusicContext, RoleType } from '../../types';
import { PRNGManager } from '../../../utils/PRNG';
import { GroovePlugin } from './plugins/GroovePlugin';
import { HumanizePlugin } from './plugins/HumanizePlugin';
import { DrumFillPlugin } from './plugins/DrumFillPlugin';

export class GrooveEngine {
    private static plugins: GroovePlugin[] = [
        new DrumFillPlugin(),
        new HumanizePlugin()
    ];

    public static registerPlugin(plugin: GroovePlugin) {
        this.plugins.push(plugin);
    }

    public static generateGroove(style: StyleConfig, totalBeats: number, context?: MusicContext): { drumTrack: NoteData[], dna: GrooveDNA } {
        let drumTrack: NoteData[] = [];
        const anchors: number[] = [0]; // baseline anchor
        
        let densityAccumulator = 0;
        let intensityAccumulator = 0;
        let hits = 0;

        const drumMusician = context?.band?.find(m => m.role === RoleType.Drums);
        const drumPersona = drumMusician?.persona;
        const dynMin = drumPersona ? drumPersona.dynamicRange[0] : 60;
        const dynMax = drumPersona ? drumPersona.dynamicRange[1] : 110;

        for (let beat = 0; beat < totalBeats - 0.001; beat += 0.25) {
            const grid = Math.round((beat % 4) / 0.25);
            if (grid >= 16) continue;

            let energy = 5;
            if (context?.sections) {
                for (const sec of context.sections) {
                    if (beat >= sec.startBeat - 0.001 && beat < sec.endBeat - 0.001) {
                        energy = sec.energyLevel;
                        break;
                    }
                }
            }

            // Base Brain: Unopinionated mathematical evaluation of the grid
            const probs = style.drumProbabilities ? style.drumProbabilities[grid] : null;
            if (!probs) continue;
            
            const [kickProbOrig, snareProbOrig, hihatProbOrig, minVelOrig, maxVelOrig] = probs;
            
            // Adjust probabilities based on energy (High energy = more likely to hit syncopations, Low = sparse)
            const energyFactor = energy / 10;
            const kickProb = (grid === 0 || grid === 8) ? kickProbOrig : kickProbOrig * energyFactor * 1.5;
            const snareProb = (grid === 4 || grid === 12) ? snareProbOrig : snareProbOrig * energyFactor * 1.5;
            
            // Hihat: At high energy, play all 8ths or 16ths. At low, just downbeats.
            const hihatProb = hihatProbOrig * (0.5 + energyFactor); 

            // map [60, 110] default to [dynMin, dynMax], then deeply scale based on section energy
            const mapVel = (v: number) => {
                const norm = Math.max(0, Math.min(1, Math.max(0, v - 60) / 50));
                let scaledVel = dynMin + norm * (dynMax - dynMin);
                // Expand dynamic range vastly based on energy
                const secFactor = (energy - 5) * 8; // e=5 -> no change. e=8 -> +24. e=3 -> -16
                return Math.max(20, Math.min(127, scaledVel + secFactor));
            };

            const minVel = mapVel(minVelOrig);
            const maxVel = mapVel(maxVelOrig);

            const rollKick = PRNGManager.nextFloat(0, 1);
            const rollSnare = PRNGManager.nextFloat(0, 1);
            const rollHihat = PRNGManager.nextFloat(0, 1);

            let hasStrongHit = false;

            if (rollKick < kickProb) {
                const vel = PRNGManager.nextFloat(minVel, maxVel);
                drumTrack.push({ pitch: 36, onset: beat, duration: 0.1, velocity: vel / 127 });
                if (vel >= 70) hasStrongHit = true;
                intensityAccumulator += vel;
                hits++;
            }

            if (rollSnare < snareProb) {
                const vel = PRNGManager.nextFloat(minVel, maxVel);
                drumTrack.push({ pitch: 38, onset: beat, duration: 0.1, velocity: vel / 127 });
                if (vel >= 70) hasStrongHit = true;
                intensityAccumulator += vel;
                hits++;
            }

            if (rollHihat < hihatProb) {
                const vel = PRNGManager.nextFloat(Math.max(20, minVel - 20), Math.max(30, maxVel - 20));
                drumTrack.push({ pitch: 42, onset: beat, duration: 0.1, velocity: vel / 127 });
            }

            if (hasStrongHit) {
                const mappedAnchor = beat % 4; // Map relative to a single bar
                if (!anchors.includes(mappedAnchor)) {
                    anchors.push(mappedAnchor);
                }
            }
        }

        // Apply Plugins
        for (const plugin of this.plugins) {
            drumTrack = plugin.process(drumTrack, style, totalBeats, context);
        }

        densityAccumulator = hits / (totalBeats * 4); // normalize
        
        anchors.sort((a, b) => a - b);
        
        // Guarantee at least 0 is an anchor
        if (anchors.length === 0 || anchors[0] !== 0) {
            if (!anchors.includes(0)) {
                anchors.unshift(0);
                anchors.sort((a, b) => a - b);
            }
        }

        const lhRoles = [0, 1, 2, 3]; // Anchor, Stride, Comp, Arp
        const rhRoles = [0, 1, 2, 3]; // Block, Arp, Linear, Sparse
        const contourTypes = [0, 1, 2, 3]; // Upward, Downward, Alternating, Random
        const pianoMotifDNA = {
            voicingPreference: PRNGManager.nextFloat(0, 1), // Continuous 0 to 1
            rhythmicAnchor: PRNGManager.nextFloat(0, 1), // 0 = fully on-beat, 1 = extremly syncopated
            contour: contourTypes[Math.floor(PRNGManager.nextFloat(0, 1) * contourTypes.length)],
            densityBaseline: PRNGManager.nextFloat(0.3, 0.8),
            lhRole: lhRoles[Math.floor(PRNGManager.nextFloat(0, 1) * lhRoles.length)],
            rhRole: rhRoles[Math.floor(PRNGManager.nextFloat(0, 1) * rhRoles.length)],
            interlock: PRNGManager.nextFloat(0, 1)
        };

        return {
            drumTrack,
            dna: {
                anchors,
                density: Math.min(1.0, densityAccumulator * 2),
                intensity: Math.min(1.0, intensityAccumulator / (hits * 127 || 1)),
                pianoMotifDNA
            }
        };
    }
}

```

### File: `src/core/generation/engines/groove/plugins/DrumFillPlugin.ts`

```typescript
import { NoteData, StyleConfig, MusicContext, RoleType } from '../../../types';
import { GroovePlugin } from './GroovePlugin';
import { PRNGManager } from '../../../../utils/PRNG';

export class DrumFillPlugin implements GroovePlugin {
    process(drumTrack: NoteData[], style: StyleConfig, totalBeats: number, context?: MusicContext): NoteData[] {
        const drumMusician = context?.band?.find(m => m.role === RoleType.Drums);
        // We use signatureLickProb to determine how often they fill
        const lickProb = drumMusician?.persona?.signatureLickProb || 0;
        
        if (lickProb <= 0) return drumTrack;

        let modifiedTrack = [...drumTrack];
        
        // Find possible fill endpoints (where the crash / downbeat usually hits)
        const phraseEnds: number[] = [];
        
        if (context?.sections && context.sections.length > 0) {
            for (const sec of context.sections) {
                const sectionLength = sec.endBeat - sec.startBeat;
                const phrases = Math.floor(sectionLength / 16);
                for (let i = 1; i <= phrases; i++) {
                    const phraseEnd = sec.startBeat + i * 16;
                    if (phraseEnd <= sec.endBeat && phraseEnd < totalBeats) {
                        phraseEnds.push(phraseEnd);
                    }
                }
                const secEndFill = sec.endBeat;
                if (!phraseEnds.includes(secEndFill) && secEndFill > 2 && secEndFill < totalBeats) {
                    phraseEnds.push(secEndFill); 
                }
            }
        } else {
            for (let b = 16; b <= totalBeats; b += 16) {
                if (b < totalBeats) {
                    phraseEnds.push(b);
                }
            }
        }

        const toms = [50, 48, 47, 45, 43, 41];
        const snare = 38;
        const kick = 36;
        const hihatOpen = 46;
        const crash = 49;

        for (const endPoint of phraseEnds) {
            // Fills should not be standard configuration. Only trigger occasionally.
            // Adjust lickProb downwards and ensure fills are rare unless it's the very end of a high energy section.
            const isSectionEnd = context?.sections?.some(sec => Math.abs(sec.endBeat - endPoint) < 0.1);
            let effectiveProb = lickProb * 0.4; // Drastically reduce baseline fill probability
            if (isSectionEnd) {
                 effectiveProb = lickProb * 0.8; // Still not guaranteed, keep it natural
            }
            
            // Check if we will play a fill here
            if (PRNGManager.nextFloat(0, 1) < effectiveProb) {
                
                // Determine fill length: 0.5 (two 16ths/one 8th), 1 beat, or 2 beats
                const fillLengthChoices = [0.5, 1, 1, 2];
                const fillLength = fillLengthChoices[PRNGManager.nextInt(0, fillLengthChoices.length - 1)];
                const startPoint = endPoint - fillLength;

                // Clear existing notes in the fill window
                modifiedTrack = modifiedTrack.filter(n => (n.onset < startPoint - 0.001 || n.onset >= endPoint - 0.001));

                // Decide fill style
                const fillStyles = ['snare_roll', 'tom_descent', 'syncopated_accents', 'linear_groove'];
                const styleType = fillStyles[PRNGManager.nextInt(0, fillStyles.length - 1)];

                const steps = fillLength * 4; // 16th note steps
                let vel = PRNGManager.nextFloat(60, 80);
                
                if (styleType === 'snare_roll') {
                    for (let step = 0; step < steps; step++) {
                        const beatOnset = startPoint + step * 0.25;
                        const isAccent = step % 4 === 0 || step === steps - 1;
                        vel += isAccent ? 15 : 2; // Crescendo
                        
                        modifiedTrack.push({
                            pitch: snare,
                            onset: beatOnset,
                            duration: 0.1,
                            velocity: (isAccent ? Math.min(100, vel + 15) : vel) / 127
                        });
                        if (isAccent) modifiedTrack.push({ pitch: kick, onset: beatOnset, duration: 0.1, velocity: Math.min(100, vel) / 127 });
                    }
                } else if (styleType === 'tom_descent') {
                    let currentTomIdx = PRNGManager.nextInt(0, 1);
                    for (let step = 0; step < steps; step++) {
                        const beatOnset = startPoint + step * 0.25;
                        // Play 8th notes and random 16ths
                        const is8th = step % 2 === 0;
                        if (is8th || PRNGManager.nextFloat(0, 1) > 0.4) {
                            modifiedTrack.push({
                                pitch: toms[currentTomIdx],
                                onset: beatOnset,
                                duration: 0.1,
                                velocity: (vel + 10) / 127
                            });
                        }
                        if (step % 2 === 1 && PRNGManager.nextFloat(0, 1) > 0.5) {
                            currentTomIdx = Math.min(toms.length - 1, currentTomIdx + 1);
                        }
                        if (step % 4 === 0) modifiedTrack.push({ pitch: kick, onset: beatOnset, duration: 0.1, velocity: 80 / 127 });
                        vel += 3;
                    }
                } else if (styleType === 'syncopated_accents') {
                    // Accent shifting (e.g., groups of 3)
                    for (let step = 0; step < steps; step++) {
                        const beatOnset = startPoint + step * 0.25;
                        if (step % 3 === 0) {
                            modifiedTrack.push({ pitch: snare, onset: beatOnset, duration: 0.15, velocity: 95 / 127 });
                            modifiedTrack.push({ pitch: kick, onset: beatOnset, duration: 0.15, velocity: 90 / 127 });
                        } else if (PRNGManager.nextFloat(0, 1) > 0.3) {
                            modifiedTrack.push({ pitch: snare, onset: beatOnset, duration: 0.1, velocity: 40 / 127 }); // Ghost notes
                        }
                    }
                } else if (styleType === 'linear_groove') {
                    // Kick, Hi-hat, Snare interactions
                    for (let step = 0; step < steps; step++) {
                        const beatOnset = startPoint + step * 0.25;
                        const r = PRNGManager.nextFloat(0, 1);
                        if (r < 0.33) {
                            modifiedTrack.push({ pitch: kick, onset: beatOnset, duration: 0.1, velocity: 90 / 127 });
                        } else if (r < 0.66) {
                            modifiedTrack.push({ pitch: snare, onset: beatOnset, duration: 0.1, velocity: (step % 4 === 0 ? 95 : 55) / 127 });
                        } else {
                            if (step === steps - 1) {
                                modifiedTrack.push({ pitch: hihatOpen, onset: beatOnset, duration: 0.1, velocity: 80 / 127 });
                            } else {
                                // closed hihat
                                modifiedTrack.push({ pitch: 42, onset: beatOnset, duration: 0.1, velocity: 70 / 127 });
                            }
                        }
                    }
                }

                // Crash on the resolution downbeat
                const crashOnset = endPoint;
                // Avoid duplicating kick/crash if already there (though filter above removed anything slightly before endPoint)
                // Filter out any existing notes exactly on the crash onset to avoid doubling
                modifiedTrack = modifiedTrack.filter(n => Math.abs(n.onset - crashOnset) > 0.001);
                
                modifiedTrack.push({ pitch: crash, onset: crashOnset, duration: 0.1, velocity: 100 / 127 });
                modifiedTrack.push({ pitch: kick, onset: crashOnset, duration: 0.1, velocity: 100 / 127 });
            }
        }

        modifiedTrack.sort((a, b) => a.onset - b.onset);
        return modifiedTrack;
    }
}

```

### File: `src/core/generation/engines/groove/plugins/GroovePlugin.ts`

```typescript
import { NoteData, StyleConfig, MusicContext } from '../../../types';

export interface GroovePlugin {
    process(drumTrack: NoteData[], style: StyleConfig, totalBeats: number, context?: MusicContext): NoteData[];
}

```

### File: `src/core/generation/engines/groove/plugins/HumanizePlugin.ts`

```typescript
import { NoteData, StyleConfig, MusicContext } from '../../../types';
import { GroovePlugin } from './GroovePlugin';
import { PRNGManager } from '../../../../utils/PRNG';

export class HumanizePlugin implements GroovePlugin {
    process(drumTrack: NoteData[], style: StyleConfig, totalBeats: number, context?: MusicContext): NoteData[] {
        return drumTrack.map(note => {
            // Slight timing variations
            const onsetDeviation = PRNGManager.nextFloat(-0.02, 0.02);
            // Slight velocity variations
            const velocityDeviation = PRNGManager.nextFloat(-0.05, 0.05);

            return {
                ...note,
                onset: Math.max(0, note.onset + onsetDeviation),
                velocity: Math.max(0.1, Math.min(1.0, note.velocity + velocityDeviation))
            };
        });
    }
}

```

### File: `src/core/generation/engines/harmony/GlobalVoicer.ts`

```typescript
import { GeneratedChord, GlobalHarmonicFrame, ToneAllocation, MusicalRole, ChordQuality, InstrumentConfig, Tonality } from '../../types';
import { PRNGManager } from '../../../utils/PRNG';
import { MusicTheory } from '../../theory/MusicTheory';
import { HarmonicSeries } from '../../theory/HarmonicSeries';

export class GlobalVoicer {
    /**
     * Builds a list of GlobalHarmonicFrames from raw GeneratedChords.
     * This determines EXACLY what pitches (essential and tensions) exist in the ether
     * for a given duration, and assigns ROLES to them (who is responsible for playing them).
     */
    public static createHarmonicFrames(chords: GeneratedChord[], styleTensionLimit: number = 13, tonality: Tonality, grooveDNA?: import('../../types').GrooveDNA, melody?: import('../../types').NoteData[]): GlobalHarmonicFrame[] {
        const frames: GlobalHarmonicFrame[] = [];

        // Determine effective tension limit based on groove
        let effectiveTensionLimit = styleTensionLimit;
        if (grooveDNA) {
            // High groove density -> reduce tensions to avoid mud. Low density -> allow more tensions.
            if (grooveDNA.density > 0.7) {
                effectiveTensionLimit = Math.min(effectiveTensionLimit, 9); // Cap at 9ths if very busy
            } else if (grooveDNA.density < 0.3) {
                effectiveTensionLimit = Math.max(effectiveTensionLimit, 13); // Push to 13ths if very sparse
            }
        }

        for (const chord of chords) {
            // 1. Identify Pitch Scale & Extracted Tensions based on chord quality
            const { essentials, availableTensions, scale } = this.analyzeChord(chord, effectiveTensionLimit, tonality);

            // Fetch melody notes that fall into this chord's window, focusing on long/strong notes
            const activeMelodyPcs = new Set<number>();
            let melodyHasHighTension = false;
            let melodyHitsAvoidNote = false;

            if (melody) {
                const chordMelody = melody.filter(m => m.onset >= chord.startBeat && m.onset < chord.endBeat);
                for (const m of chordMelody) {
                    const pc = ((m.pitch % 12) + 12) % 12;
                    // Only care about somewhat prominent notes (duration > 0.25 or on downbeat)
                    if (m.duration >= 0.5 || (m.onset % 1.0 === 0)) {
                        activeMelodyPcs.add(pc);
                        
                        // Check if 9, 11, 13
                        if (!essentials.includes(pc) && scale.includes(pc)) {
                            melodyHasHighTension = true;
                        }

                        // Sus Mutation check (e.g. 4th over a Major 3rd)
                        const thirdPc = essentials.length > 1 ? essentials[1] : -1;
                        if (thirdPc !== -1 && (pc - thirdPc + 12) % 12 === 1) { // generic b9 clash with the 3rd
                            melodyHitsAvoidNote = true;
                        }
                    }
                }
            }

            // 2. Distribute Roles
            const allocations: ToneAllocation[] = [];

            // A. Bass must play the Root (or bass override)
            const bassPitchClass = chord.bassOverride !== undefined ? chord.bassOverride : chord.root;
            allocations.push({
                pitchClass: bassPitchClass,
                role: MusicalRole.Bass,
                isEssential: true,
                isTension: false
            });

            // B. Accompaniment dynamically decides what to play (Late Binding & Adaptive Voicing)
            // Rules:
            // - If melody hits Avoid Note (b9 over 3rd), Accomp OMITS 3rd (Sus Mutation).
            // - If melody hits High Tension or 5th, Accomp OMITS 5th (Mud clearance).
            
            allocations.push({
                pitchClass: chord.root,
                role: MusicalRole.Accomp,
                isEssential: true,
                isTension: false
            });
            allocations.push({ pitchClass: chord.root, role: MusicalRole.Lead, isEssential: true, isTension: false });

            let omit3 = melodyHitsAvoidNote;
            let omit5 = melodyHasHighTension || (essentials.length > 2 && activeMelodyPcs.has(essentials[2]));

            const guideTones = essentials.filter(p => p !== chord.root);
            
            for (let i = 0; i < guideTones.length; i++) {
                const gt = guideTones[i];
                const isThird = i === 0;
                const isFifth = i === 1;

                if (isThird && omit3) continue; // Dynamic Sus Mutation!
                if (isFifth && omit5) continue; // Advanced Omit 5 logic!

                allocations.push({
                    pitchClass: gt,
                    role: MusicalRole.Accomp,
                    isEssential: true,
                    isTension: false
                });

                allocations.push({
                    pitchClass: gt,
                    role: MusicalRole.Lead,
                    isEssential: true,
                    isTension: false
                });
            }

            // C. Dynamic Tension Routing
            for (const tension of availableTensions) {
                // If melody already hits this tension, don't force accomp to also play it
                if (activeMelodyPcs.has(tension)) continue;

                const roll = PRNGManager.nextFloat(0, 1);
                if (roll < 0.4) {
                    allocations.push({ pitchClass: tension, role: MusicalRole.Lead, isEssential: false, isTension: true });
                } else if (roll < 0.8) {
                    allocations.push({ pitchClass: tension, role: MusicalRole.Accomp, isEssential: false, isTension: true });
                } else {
                    allocations.push({ pitchClass: tension, role: MusicalRole.Lead, isEssential: false, isTension: true });
                    allocations.push({ pitchClass: tension, role: MusicalRole.Accomp, isEssential: false, isTension: true });
                }
            }

            frames.push({
                startBeat: chord.startBeat,
                endBeat: chord.endBeat,
                chord: chord,
                toneAllocations: allocations,
                pitchScale: scale
            });
        }

        return frames;
    }

    private static analyzeChord(chord: GeneratedChord, tensionLimit: number, tonality: Tonality): { essentials: number[], availableTensions: number[], scale: number[] } {
        const root = chord.root;
        const q = chord.quality;
        
        let essentials: number[] = [];
        let tensions: number[] = [];
        let scaleDegrees: number[] = [0, 2, 4, 5, 7, 9, 11]; // Default major scale relative offsets

        // Use exact intervals from MusicTheory
        const intervals = MusicTheory.getChordTones(q);
        if (intervals && intervals.length > 0) {
            // Usually roots, 3rds, 5ths, 7ths are essential
            essentials = intervals.slice(0, Math.min(4, intervals.length)).map(i => (root + i) % 12);
            // Higher extensions are tensions
            if (intervals.length > 4) {
                tensions = intervals.slice(4).map(i => (root + i) % 12);
            }
        } else {
            // Fallback
             essentials.push(root, (root + 4) % 12, (root + 7) % 12);
        }

        const absoluteScale = MusicTheory.getLocalScalePitches(root, q, tonality);

        // Dynamically inject diatonic tensions up to the tensionLimit if not explicitly present
        // REMOVED: As per user request, we NO LONGER inject scale tensions into the explicit chord
        // availability matrix. We strictly only use what the HarmonyEngine decided the chord is.
        // If HarmonyEngine wants a 9th, it will output a Major9 chord.

        
        // Sort available tensions based on their resonance in the Natural Harmonic Series
        // This ensures that when distributing tensions, the most naturally resonant ones (like the 9th, #11)
        // are prioritized over extremely dissonant or "muddy" minor seconds.
        tensions.sort((a, b) => {
            const scoreA = HarmonicSeries.scorePitchClass(a, root, 1.0); // full color scale
            const scoreB = HarmonicSeries.scorePitchClass(b, root, 1.0);
            return scoreB - scoreA; // Descending order of resonance/desirability
        });

        return { essentials, availableTensions: tensions, scale: absoluteScale };
    }
}

```

### File: `src/core/generation/engines/harmony/HarmonyEngine.ts`

```typescript
import { GeneratedChord, SectionMetadata, Tonality, SectionType } from '../../types';
import { PRNGManager } from '../../../utils/PRNG';
import { MusicTheory } from '../../theory/MusicTheory';
import { HarmonyPlugin } from './plugins/HarmonyPlugin';
import { AnticipationPlugin } from './plugins/AnticipationPlugin';
import { PassingChordPlugin } from './plugins/PassingChordPlugin';
import { EnhancedColorPlugin } from './plugins/EnhancedColorPlugin';

export class HarmonyEngine {
    // 彻底解封系统对离调与色彩和弦的限制
    public static isOutOfKeyEnabled = true;

    private static plugins: HarmonyPlugin[] = [
        new AnticipationPlugin(),
        new PassingChordPlugin(),
        new EnhancedColorPlugin()
    ];

    public static registerPlugin(plugin: HarmonyPlugin) {
        this.plugins.push(plugin);
    }

    public static generateHarmonyTimeline(sections: SectionMetadata[], tonality: Tonality, keyOffset: number, style?: import('../../types').StyleConfig): GeneratedChord[] {
        let chords: GeneratedChord[] = [];
        const isMinor = tonality === Tonality.Minor;

        if (!style?.harmony) {
             throw new Error("StyleConfig must provide a harmony configuration.");
        }

        const progDict = isMinor ? style.harmony.minor : style.harmony.major;

        // --- Pass 1: Generate Base Chords Flatly ---
        for (let s = 0; s < sections.length; s++) {
            const sec = sections[s];
            let typeKey = sec.type ? sec.type.toString() : 'verse';
            
            // Fallback routing if the specific section type isn't defined in the style
            if (!progDict[typeKey]) {
                if (typeKey === 'preChorus' && progDict['verse']) typeKey = 'verse';
                else if (typeKey === 'outro' && progDict['chorus']) typeKey = 'chorus';
                else if (typeKey === 'bridge' && progDict['chorus']) typeKey = 'chorus';
                else typeKey = Object.keys(progDict)[0]; // Just grab the first available
            }

            const pool = progDict[typeKey];
            const progStr = pool[PRNGManager.nextInt(0, pool.length - 1)];
            
            let b = sec.startBeat;
            let progIdx = 0;
            let isFirstChord = true;

            while (b < sec.endBeat - 0.001) {
                let numeralOrig = progStr[progIdx % progStr.length];
                let numeral = numeralOrig;
                
                const parsed = MusicTheory.parseNumeral(numeral, tonality);
                
                let duration = 4;
                if (progStr.length >= 8) duration = 2; // Usually 2 chords per bar for longer progressions
                let endBeat = b + duration;

                if (endBeat > sec.endBeat) endBeat = sec.endBeat;

                chords.push({
                    numeral,
                    root: parsed.root,
                    quality: parsed.quality,
                    startBeat: b,
                    endBeat,
                    keyOffset,
                    bassOverride: parsed.bassOverride
                });
                
                b = endBeat;
                isFirstChord = false;
                progIdx++;
            }
        }

        // Apply Plugins
        for (const plugin of this.plugins) {
            chords = plugin.process(chords, {
                sections,
                tonality,
                keyOffset,
                style
            });
        }

        return chords;
    }
}

```

### File: `src/core/generation/engines/harmony/plugins/AnticipationPlugin.ts`

```typescript
import { GeneratedChord, SectionMetadata, Tonality, StyleConfig } from '../../../types';
import { HarmonyPlugin } from './HarmonyPlugin';
import { PRNGManager } from '../../../../utils/PRNG';

const ANTICIPATION_BEAT = 0.5;

export class AnticipationPlugin implements HarmonyPlugin {
    process(chords: GeneratedChord[], context: { sections: SectionMetadata[], tonality: Tonality, keyOffset: number, style?: StyleConfig }): GeneratedChord[] {
        const anticipationProb = context.style?.anticipationProb ?? 0.3;
        if (anticipationProb <= 0) return chords;

        const result: GeneratedChord[] = [];

        for (let i = 0; i < chords.length; i++) {
            const bc = chords[i];
            
            // Check if it's the start of a section
            const sec = context.sections.find(s => bc.startBeat >= s.startBeat && bc.startBeat < s.endBeat);
            const isSectionStart = sec && Math.abs(bc.startBeat - sec.startBeat) < 0.01;

            let startBeat = bc.startBeat;

            if (sec && sec.energyLevel >= 6 && !isSectionStart && i > 0 && PRNGManager.nextFloat(0, 1) < anticipationProb) {
                const candidateStart = bc.startBeat - ANTICIPATION_BEAT;
                if (result.length > 0 && candidateStart - result[result.length - 1].startBeat >= 0.5) {
                    result[result.length - 1].endBeat = candidateStart;
                    startBeat = candidateStart;
                }
            }

            result.push({
                ...bc,
                startBeat
            });
        }

        return result;
    }
}

```

### File: `src/core/generation/engines/harmony/plugins/EnhancedColorPlugin.ts`

```typescript
import { GeneratedChord, SectionMetadata, Tonality, StyleConfig } from '../../../types';
import { HarmonyPlugin } from './HarmonyPlugin';
import { PRNGManager } from '../../../../utils/PRNG';
import { MusicTheory, ChordQualityEnum } from '../../../theory/MusicTheory';
import { HarmonyEngine } from '../HarmonyEngine';

export class EnhancedColorPlugin implements HarmonyPlugin {
    process(chords: GeneratedChord[], context: { sections: SectionMetadata[], tonality: Tonality, keyOffset: number, style?: StyleConfig }): GeneratedChord[] {
        if (!HarmonyEngine.isOutOfKeyEnabled) return chords;

        const result: GeneratedChord[] = [];
        
        for (let i = 0; i < chords.length; i++) {
            let bc = chords[i];
            const nextBc = i + 1 < chords.length ? chords[i + 1] : null;

            // Target tension and temperature can be derived from section energy
            const currentEnergy = context.sections.find(s => bc.startBeat >= s.startBeat)?.energyLevel || 5;

            // 5% chance to algorithmically spice up a chord based on its function, toned down
            // Skip the very first chord (i === 0) to preserve stability at the start of the arrangement.
            if (i > 0 && PRNGManager.nextFloat(0, 1) < 0.05 && (bc.endBeat - bc.startBeat) >= 2) {
                bc = this.calculateColoredChord(bc, nextBc, context.keyOffset, currentEnergy);
            }

            result.push(bc);
        }
        return result;
    }

    private getNumeralString(rootDeg: number, quality: ChordQualityEnum, tonality: Tonality): string {
        const notesMajor = ["I", "bII", "II", "bIII", "III", "IV", "#IV", "V", "bVI", "VI", "bVII", "VII"];
        const notesMinor = ["i", "bii", "ii", "biii", "iii", "iv", "#iv", "v", "bvi", "vi", "bvii", "vii"];
        
        const isMinorQ = [ChordQualityEnum.Minor, ChordQualityEnum.Minor7, ChordQualityEnum.Minor9, ChordQualityEnum.Minor11, ChordQualityEnum.Minor6, ChordQualityEnum.HalfDiminished, ChordQualityEnum.Diminished, ChordQualityEnum.Diminished7].includes(quality);
        const base = isMinorQ ? notesMinor[rootDeg % 12] : notesMajor[rootDeg % 12];
        
        let suffix = "";
        switch (quality) {
            case ChordQualityEnum.Major: suffix = ""; break;
            case ChordQualityEnum.Minor: suffix = "m"; break;
            case ChordQualityEnum.Major7: suffix = "maj7"; break;
            case ChordQualityEnum.Minor7: suffix = "m7"; break;
            case ChordQualityEnum.Dominant7: suffix = "7"; break;
            case ChordQualityEnum.HalfDiminished: suffix = "m7b5"; break;
            case ChordQualityEnum.Diminished7: suffix = "dim7"; break;
            case ChordQualityEnum.Minor9: suffix = "m9"; break;
            case ChordQualityEnum.Major9: suffix = "maj9"; break;
            case ChordQualityEnum.Dominant9: suffix = "9"; break;
            case ChordQualityEnum.Dominant13: suffix = "13"; break;
            case ChordQualityEnum.Altered: suffix = "alt"; break;
            case ChordQualityEnum.Dominant7b9: suffix = "7b9"; break;
            case ChordQualityEnum.Dominant7Sharp9: suffix = "7#9"; break;
            case ChordQualityEnum.Major7Sharp11: suffix = "maj7#11"; break;
            case ChordQualityEnum.Minor11: suffix = "m11"; break;
            case ChordQualityEnum.Minor6: suffix = "m6"; break;
            default: suffix = ""; break;
        }

        if (isMinorQ && suffix.startsWith("m") && !suffix.startsWith("maj")) {
             suffix = suffix.substring(1);
        }

        return base + suffix;
    }

    private calculateColoredChord(bc: GeneratedChord, nextBc: GeneratedChord | null, keyOffset: number, energy: number): GeneratedChord {
        // Determine function of current chord relative to key
        const intervals = MusicTheory.getChordTones(bc.quality);
        const pitchClasses = intervals.map(inter => (bc.root + inter) % 12);
        
        const deg1 = keyOffset; // Tonic
        const deg3 = (keyOffset + 4) % 12; // M3
        const deg4 = (keyOffset + 5) % 12; // P4
        const deg6 = (keyOffset + 9) % 12; // M6
        const deg7 = (keyOffset + 11) % 12; // M7

        let isTonic = pitchClasses.includes(deg1) && pitchClasses.includes(deg3);
        let isSub = pitchClasses.includes(deg4) && pitchClasses.includes(deg6);
        let isDom = pitchClasses.includes(deg4) && pitchClasses.includes(deg7);

        // If it does not strictly fit D, S, or T, fall back to evaluating exactly the current function
        // Or if it's multiple, let's just use the root
        let rootDeg = (bc.root - keyOffset + 12) % 12;
        if (!isTonic && !isSub && !isDom) {
            if ([0, 4, 9].includes(rootDeg)) isTonic = true;
            else if ([2, 5].includes(rootDeg)) isSub = true;
            else if ([7, 11].includes(rootDeg)) isDom = true;
        }

        let bestChord = { ...bc };
        let bestScore = -Infinity;

        // Base tension on function to avoid wildly inappropriate dissonances on Tonic or Subdominant.
        let baseTension = (energy / 10) * 3.0;
        let targetTension = baseTension;
        if (isTonic) {
            targetTension += PRNGManager.nextFloat(0, 1.5);
        } else if (isSub) {
            targetTension += 1.5 + PRNGManager.nextFloat(0, 2);
        } else if (isDom) {
            targetTension += 4.0 + PRNGManager.nextFloat(0, 3);
        }
        
        // Temperature randomly swings from warm (major/dominant extensions) to cold (minor/altered)
        const targetTemp = PRNGManager.nextFloat(0, 1) > 0.5 ? 2.0 + PRNGManager.nextFloat(0, 3) : -2.0 - PRNGManager.nextFloat(0, 3);

        const qualitiesToSearch = [
            ChordQualityEnum.Major, ChordQualityEnum.Minor, ChordQualityEnum.Major7, ChordQualityEnum.Minor7,
            ChordQualityEnum.Dominant7, ChordQualityEnum.HalfDiminished, ChordQualityEnum.Diminished7,
            ChordQualityEnum.Minor9, ChordQualityEnum.Major9, ChordQualityEnum.Dominant9,
            ChordQualityEnum.Dominant13, ChordQualityEnum.Altered, ChordQualityEnum.Dominant7b9,
            ChordQualityEnum.Dominant7Sharp9, ChordQualityEnum.Major7Sharp11, ChordQualityEnum.Minor11,
            ChordQualityEnum.Minor6
        ];

        // Search space: Roots that share functional notes
        for (let r = 0; r < 12; r++) {
            for (const q of qualitiesToSearch) {
                const testIntervals = MusicTheory.getChordTones(q);
                const testPcs = testIntervals.map(inter => (r + inter) % 12);

                // Check functional integrity
                let validFunction = false;
                if (isTonic && (testPcs.includes(deg1) || testPcs.includes(deg3))) validFunction = true;
                if (isSub && testPcs.includes(deg4)) validFunction = true; // S just needs to contain the subdominant degree
                // Dom needs tritone or similar tension
                if (isDom && (testPcs.includes(deg4) && (testPcs.includes(deg7) || testPcs.includes((deg7 - 1 + 12) % 12)))) validFunction = true; 

                if (!validFunction) continue;

                // For dominant, tritone sub is valid if it resolves to target
                if (isDom && nextBc) {
                    const diffToNext = (r - nextBc.root + 12) % 12;
                    // Standard dominant is V -> I (diff 7)
                    // Tritone sub is bII -> I (diff 1)
                    if (diffToNext !== 7 && diffToNext !== 1) continue;
                }

                // Smooth voice leading: check common tones with original chord
                const commonTones = testPcs.filter(pc => pitchClasses.includes(pc)).length;
                if (commonTones < 1 && !isDom) continue; // Must share at least one note unless dominant

                const metrics = MusicTheory.calculateChordMetrics(testIntervals);
                
                // Score based on how close we hit tension and temperature, plus voice leading bonus
                const tensionDiff = Math.abs(metrics.tension - targetTension);
                const tempDiff = Math.abs(metrics.temperature - targetTemp);
                
                // Lower difference is better. Bonus for common tones.
                let score = - (tensionDiff * 1.5) - (tempDiff * 1.0) + (commonTones * 2.0);

                // Small bonus to avoid picking exactly the original chord
                if (r !== bc.root || q !== bc.quality) {
                    score += 1.0;
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestChord.root = r;
                    bestChord.quality = q;
                    const rootDegOffset = (r - keyOffset + 12) % 12;
                    bestChord.numeral = this.getNumeralString(rootDegOffset, q, Tonality.Major);
                }
            }
        }

        return bestChord;
    }
}

```

### File: `src/core/generation/engines/harmony/plugins/HarmonyPlugin.ts`

```typescript
import { GeneratedChord, SectionMetadata, Tonality, StyleConfig } from '../../../types';

export interface HarmonyPlugin {
    process(chords: GeneratedChord[], context: {
        sections: SectionMetadata[],
        tonality: Tonality,
        keyOffset: number,
        style?: StyleConfig
    }): GeneratedChord[];
}

```

### File: `src/core/generation/engines/harmony/plugins/PassingChordPlugin.ts`

```typescript
import { GeneratedChord, SectionMetadata, Tonality, StyleConfig } from '../../../types';
import { HarmonyPlugin } from './HarmonyPlugin';
import { PRNGManager } from '../../../../utils/PRNG';
import { MusicTheory, ChordQualityEnum } from '../../../theory/MusicTheory';
import { HarmonyEngine } from '../HarmonyEngine';

export class PassingChordPlugin implements HarmonyPlugin {
    process(chords: GeneratedChord[], context: { sections: SectionMetadata[], tonality: Tonality, keyOffset: number, style?: StyleConfig }): GeneratedChord[] {
        const passingProb = context.style?.passingChordProb ?? 0.2;
        if (passingProb <= 0) return chords;

        const result: GeneratedChord[] = [];
        const scalePcs = MusicTheory.getScalePitches(context.tonality);

        // Track how many times a progression might be repeating to only add passing chords on turnaround
        let loopCounter = 0;

        for (let i = 0; i < chords.length; i++) {
            const bc = chords[i];
            const nextBc = i + 1 < chords.length ? chords[i + 1] : null;

            const duration = bc.endBeat - bc.startBeat;
            
            // Only trigger if moving to a different chord and there's enough room
            if (nextBc && bc.root !== nextBc.root && duration >= 2) {
                
                // Usually 1 measure = 4 beats, 2 measures = 8 beats.
                // We want passing chords mostly on the 4th, 8th, 16th measure of a section.
                const isEndOf4BarPhrase = (bc.endBeat % 16 === 0);
                const isEndOf2BarPhrase = (bc.endBeat % 8 === 0) && !isEndOf4BarPhrase;
                
                // Base probability is extremely low to keep it special
                let prob = passingProb * 0.05;
                if (isEndOf4BarPhrase) prob = passingProb * 0.9;
                else if (isEndOf2BarPhrase) prob = passingProb * 0.4;

                if (PRNGManager.nextFloat(0, 1) < prob) {
                    // Decide passing chord duration:
                    // 1 beat, 2 beats, or a short syncopated "push" (0.5 beats before the next chord)
                    let passingDur = 1.0;
                    const durType = PRNGManager.nextFloat(0, 1);
                    if (duration >= 4 && durType > 0.8) {
                        passingDur = 2.0; // Half measure
                    } else if (durType < 0.3) {
                        passingDur = 0.5; // Short syncopated eighth-note pickup
                    }

                    const splitPoint = bc.endBeat - passingDur;

                    result.push({ 
                        ...bc,
                        endBeat: splitPoint
                    });
                    
                    // =========================================================
                    // 🌟 大师级进化：目标导向 (Target-Oriented) 的多维经过策略
                    // =========================================================
                    const allowChromatic = HarmonyEngine.isOutOfKeyEnabled && PRNGManager.nextFloat(0, 1) < (context.style?.chromaticPassingProb ?? 0);
                    
                    // ---------------------------------------------------------
                    // 技巧 1. 终极必杀技：微缩 ii-V 包络 (Micro ii-V Enclosure)
                    // 如果空隙长达 1 拍以上，且允许离调，有概率分裂成经典的爵士 ii-V-I 连击
                    // ---------------------------------------------------------
                    if (passingDur >= 1.0 && allowChromatic && PRNGManager.nextFloat(0, 1) < 0.25) {
                        const halfDur = passingDur / 2.0;
                        const isTargetMinor = nextBc.quality === ChordQualityEnum.Minor || nextBc.quality === ChordQualityEnum.Minor7 || nextBc.quality === ChordQualityEnum.Minor9 || nextBc.quality === ChordQualityEnum.HalfDiminished;
                        
                        // 裂变一：目标和弦的 ii 级
                        result.push({ 
                            numeral: isTargetMinor ? 'iiø/next' : 'ii7/next', 
                            root: (nextBc.root + 2) % 12, 
                            quality: isTargetMinor ? ChordQualityEnum.HalfDiminished : ChordQualityEnum.Minor7, 
                            startBeat: splitPoint, 
                            endBeat: splitPoint + halfDur, 
                            keyOffset: context.keyOffset 
                        });
                        
                        // 裂变二：目标和弦的 V7 (或 SubV7 三全音替代)
                        const useSubV = PRNGManager.nextFloat(0, 1) > 0.7;
                        result.push({ 
                            numeral: useSubV ? 'subV7/next' : 'V7/next', 
                            root: useSubV ? (nextBc.root + 1) % 12 : (nextBc.root + 7) % 12, 
                            quality: ChordQualityEnum.Dominant7, 
                            startBeat: splitPoint + halfDur, 
                            endBeat: bc.endBeat, 
                            keyOffset: context.keyOffset 
                        });
                        continue; // 裂变成功，直接跳过后续单和弦逻辑
                    }

                    // =========================================================
                    // 🌟 常规单体经过和弦路由 (5大门派)
                    // =========================================================
                    let pType = PRNGManager.nextFloat(0, 1);
                    if (!allowChromatic) pType = PRNGManager.nextFloat(0, 0.39); // 禁离调时，强制走顺阶或斜杠低音

                    let passingRoot = bc.root;
                    let passingQuality = bc.quality;
                    let numeral = 'pass';
                    let bassOverride: number | undefined = undefined;

                    if (pType < 0.2) {
                        // ---------------------------------------------------------
                        // 技巧 A: Pop Bass Walkdown (斜杠低音游走) 🌟
                        // ---------------------------------------------------------
                        // 保持当前和弦不变，只平滑移动贝斯去衔接目标。例如 C -> C/E -> F
                        passingRoot = bc.root; 
                        passingQuality = bc.quality;
                        
                        let diff = nextBc.root - bc.root;
                        if (diff < -6) diff += 12;
                        if (diff > 6) diff -= 12;
                        
                        // 如果是四度上行强进行 (C -> F)，完美契合第一转位 (C/E)
                        if (diff === 5 || diff === -7) {
                            bassOverride = (bc.root + 4) % 12; 
                        } else {
                            // 否则顺阶走一步
                            let stepDir = Math.sign(diff);
                            bassOverride = (bc.root + stepDir * 2 + 12) % 12;
                            bassOverride = MusicTheory.snapToPool(bassOverride, scalePcs);
                        }
                        numeral = 'slash/walk';

                    } else if (pType < 0.4) {
                        // ---------------------------------------------------------
                        // 技巧 B: 目标导向的顺阶七和弦 (Diatonic Approach) 修复版 🌟
                        // ---------------------------------------------------------
                        let approachDir = PRNGManager.nextFloat(0, 1) > 0.5 ? 1 : -1;
                        // 🚨 修复：从【目标和弦 nextBc】找台阶，而不是当前和弦！
                        let targetScaleIdx = scalePcs.indexOf(nextBc.root % 12);
                        
                        if (targetScaleIdx !== -1) {
                            let passIdx = (targetScaleIdx + approachDir + scalePcs.length) % scalePcs.length;
                            passingRoot = scalePcs[passIdx];
                            
                            // 🌟 升级：拒绝干瘪三和弦，赋予七和弦现代色彩
                            if (context.tonality === Tonality.Major) {
                                if ([0, 3].includes(passIdx)) passingQuality = ChordQualityEnum.Major7;
                                else if (passIdx === 4) passingQuality = ChordQualityEnum.Dominant7;
                                else if (passIdx === 6) passingQuality = ChordQualityEnum.HalfDiminished;
                                else passingQuality = ChordQualityEnum.Minor7;
                            } else {
                                if ([2, 5].includes(passIdx)) passingQuality = ChordQualityEnum.Major7;
                                else if (passIdx === 4) passingQuality = ChordQualityEnum.Minor7;
                                else if (passIdx === 1) passingQuality = ChordQualityEnum.HalfDiminished;
                                else passingQuality = ChordQualityEnum.Minor7;
                            }
                        } else {
                            passingRoot = (nextBc.root + approachDir * 2 + 12) % 12;
                            passingQuality = ChordQualityEnum.Minor7;
                        }
                        numeral = 'pass(diat7)';

                    } else if (pType < 0.65) {
                        // ---------------------------------------------------------
                        // 技巧 C: 副属和弦 (Secondary Dominant V7/next) 流行之王 🔥
                        // ---------------------------------------------------------
                        passingRoot = (nextBc.root + 7) % 12; // 目标上方纯五度
                        passingQuality = PRNGManager.nextFloat(0,1) > 0.5 ? ChordQualityEnum.Dominant9 : ChordQualityEnum.Dominant7;
                        numeral = 'V7/next';
                        
                        // 🌟 大师细节：40% 概率做第一转位（Bass半音上行极具张力）
                        if (PRNGManager.nextFloat(0, 1) > 0.6) bassOverride = (passingRoot + 4) % 12;

                    } else if (pType < 0.85) {
                        // ---------------------------------------------------------
                        // 技巧 D: 平行滑移 (Parallel Planing) 与三全音替代 🌌
                        // ---------------------------------------------------------
                        const isParallel = PRNGManager.nextFloat(0, 1) > 0.5;
                        if (isParallel) {
                            // Neo-Soul 绝技：无视调性，完全复制目标的高级色彩，从半音滑入
                            passingRoot = (nextBc.root + (PRNGManager.nextFloat(0,1) > 0.5 ? 1 : -1) + 12) % 12;
                            passingQuality = nextBc.quality; 
                            numeral = 'planing';
                        } else {
                            // SubV7: 目标上方小二度的属七
                            passingRoot = (nextBc.root + 1) % 12;
                            passingQuality = ChordQualityEnum.Dominant7; 
                            numeral = 'subV7/next';
                        }
                    } else {
                        // ---------------------------------------------------------
                        // 技巧 E: 减七度导音逼近 (Diminished 7th Approach) 🎹
                        // ---------------------------------------------------------
                        passingRoot = (nextBc.root - 1 + 12) % 12;
                        passingQuality = ChordQualityEnum.Diminished7;
                        numeral = 'viio7/next';
                        // 贝斯平滑处理
                        bassOverride = PRNGManager.nextFloat(0, 1) > 0.5 ? passingRoot : undefined;
                    }

                    result.push({ 
                        numeral, 
                        root: passingRoot, 
                        quality: passingQuality, 
                        startBeat: splitPoint, 
                        endBeat: bc.endBeat, 
                        keyOffset: context.keyOffset,
                        ...(bassOverride !== undefined ? { bassOverride } : {})
                    });
                    
                    continue; // 成功注入经过和弦，跳过原和弦推进
                }
            }
            
            result.push(bc);
        }

        return result;
    }
}

```

### File: `src/core/generation/engines/melody/GrooveEngine.ts`

```typescript
import { PRNGManager } from '../../../utils/PRNG';
import { BASIC_RHYTHM_CELLS } from './RhythmCells';

export class GrooveEngine {
    /**
     * Generates a rhythmic motif based on the energy level.
     * @param beatsToFill Total beats to fill (e.g. 16 for a 4-bar phrase)
     * @param energy The energy level affecting note density
     */
    public static generateMotif(beatsToFill: number, energy: number): number[] {
        const motif: number[] = [];
        let remaining = beatsToFill;
        
        while (remaining > 0) {
            const flowingCells = BASIC_RHYTHM_CELLS.filter(c => !c.some(d => d < 0));
            const restCells = BASIC_RHYTHM_CELLS.filter(c => c.some(d => d < 0));
            
            let cell: number[];
            
            // Higher energy = more flowing cells, fewer rests
            const flowProb = Math.min(0.95, 0.4 + (energy / 10) * 0.5); 
            
            if (PRNGManager.nextFloat(0, 1) < flowProb) {
                cell = flowingCells[PRNGManager.nextInt(0, flowingCells.length - 1)];
            } else {
                cell = restCells[PRNGManager.nextInt(0, restCells.length - 1)];
            }

            const cellLen = cell.reduce((sum, d) => sum + Math.abs(d), 0);
            
            if (cellLen <= remaining) {
                motif.push(...cell);
                remaining -= cellLen;
            } else {
                // If it doesn't fit, pad with whatever is remaining
                motif.push(remaining > 0 ? remaining : 1.0);
                remaining = 0;
            }
        }

        return motif;
    }
}

```

### File: `src/core/generation/engines/melody/MelodicContourEngine.ts`

```typescript
import { PRNGManager } from '../../../utils/PRNG';

export class MelodicContourEngine {
    public static selectBestPitch(
        possiblePitches: number[],
        lastPitch: number,
        lastMotion: number,
        idealPitch: number,
        requiresResolution: boolean = false, // 🌟 新增：追踪上一个音是否需要解决
        vocalCenter: number = 0              // 🌟 新增：音区舒适重力中心
    ): { bestPitch: number, score: number } {
        if (possiblePitches.length === 0) return { bestPitch: idealPitch, score: 0 };
        if (possiblePitches.length === 1) return { bestPitch: possiblePitches[0], score: 0 };

        let bestPitch = possiblePitches[0];
        let bestScore = Infinity;
        
        for (const p of possiblePitches) {
            let score = 0;
            const dist = Math.abs(p - lastPitch);
            const motion = p - lastPitch;

            // 1. 声部连接法则 (加重大跳惩罚)
            if (dist === 0) score += 2.0; 
            else if (dist <= 2) score += 0.0; // 级进最优，极度舒适
            else if (dist <= 4) score += 1.0; 
            else if (dist <= 7) score += 5.0; 
            else if (dist === 12) score += 8.0; 
            else score += 50.0; // 严禁超越八度乱跳
            
            // 🌟 2. 【引力与解决 (Tension & Resolution)】
            if (requiresResolution && dist > 2) {
                // 如果上个音是弦外音，当前音【必须】就近滑落或攀升，严禁大跳抛弃张力！
                score += 30.0; 
            }

            // 3. 大跳之后反向恢复
            if (Math.abs(lastMotion) > 4) {
                if (Math.sign(motion) === Math.sign(lastMotion) && dist > 0) {
                    score += 15.0; // 连续往同方向大跳，极其难听
                } else if (dist <= 2) {
                    score -= 5.0; // 大跳后反向级进回落，奖励！
                }
            }

            // 4. 动机重力场 (调低靶心绑架，防止被带偏)
            score += Math.abs(p - idealPitch) * 0.8; 

            // 🌟 5. 音区重力场 (Tessitura Gravity) - 彻底终结乱飙高音！
            const distFromCenter = Math.abs(p - vocalCenter);
            if (distFromCenter > 7) { 
                // 偏离舒适区超过纯五度，施加二次方拉扯力，硬拽回来！
                score += Math.pow((distFromCenter - 7) * 0.5, 2) * 2.0; 
            }

            score += PRNGManager.nextFloat(0, 0.5); // 微小随机打破平局

            if (score < bestScore) {
                bestScore = score;
                bestPitch = p;
            }
        }
        return { bestPitch, score: bestScore };
    }
}

```

### File: `src/core/generation/engines/melody/MelodyEngine.ts`

```typescript
import { NoteData, GeneratedChord, Tonality, GlobalHarmonicFrame, MusicalRole, SectionMetadata, MusicContext, RoleType, InstrumentConfig, MusicianPersona } from '../../types';
import { PRNGManager } from '../../../utils/PRNG';
import { MusicTheory, ChordQualityEnum } from '../../theory/MusicTheory';
import { HarmonicSeries } from '../../theory/HarmonicSeries';
import { getInstrumentConfig } from '../../manifests/InstrumentRegistry';
import { MelodicContourEngine } from './MelodicContourEngine';
import { ToplinePluginManager } from './plugins/ToplinePluginManager';
import { MotifManager, MotifNote } from './MotifManager';

export class MelodyEngine {
    private static pluginManager = new ToplinePluginManager();

    public static registerPlugin(plugin: any) {
        this.pluginManager.register(plugin);
    }

    public static generateMelody(chords: GeneratedChord[], context: MusicContext): NoteData[] {
        return []; // 🚀 Temporarily disabled by user request to focus on Harmony and Comping
        let melody: NoteData[] = [];
        let currentBeat = 0;
        
        const { tonality, harmonicFrames, sections, band } = context;
        
        // Find lead instrument capabilities if any
        let leadInstrument: InstrumentConfig | undefined;
        let leadPersona: MusicianPersona | undefined;
        if (band) {
            const leadMusician = band.find(m => m.role === RoleType.MainInst || m.role === RoleType.Vocal);
            if (leadMusician) {
                leadInstrument = getInstrumentConfig(leadMusician.instrumentId);
                leadPersona = leadMusician.persona;
            }
        }
        
        const colorBias = leadPersona ? leadPersona.colorBias : 0.0;
        
        // General bounding (relative to Key Root, so 0 is the Tonic)
        const minPitch = -14; 
        const maxPitch = 14;
        let lastPitch = 0; 
        let lastMotion = 0; 
        let lastNoteWasTension = false; // 🌟 新增：追踪上一个音是否为弦外音
        
        let currentMotif: MotifNote[] = [];
        let motifBeatCursor = 0;
        let currentSectionEnergy = 5;
        
        let phraseGapStart = -1;
        let phraseGapEnd = -1;
        
        const motifManager = new MotifManager();
        let currentSectionType = 'Default';

        for (let i = 0; i < chords.length; i++) {
            const chord = chords[i];
            const frame = harmonicFrames?.find(f => Math.abs(f.startBeat - chord.startBeat) < 0.01);
            
            // Move currentBeat up to chord start if we fell behind somehow
            if (currentBeat < chord.startBeat) {
                currentBeat = chord.startBeat;
            }

            // Target octave center to control emotional arc across sections
            let octaveCenter = 0;
            
            // Determine section energy for motivic development
            if (sections) {
                const sec = sections.find(s => currentBeat >= s.startBeat && currentBeat < s.endBeat);
                if (sec) {
                    currentSectionType = sec.type.toString() || sec.name;
                    
                    // Push Chorus and Bridge higher in register for emotional lift
                    if (currentSectionType.toLowerCase().includes('chorus') || currentSectionType.toLowerCase().includes('bridge')) {
                        octaveCenter = 1; // Play an octave higher
                    } else if (currentSectionType.toLowerCase().includes('verse')) {
                        octaveCenter = 0;
                    } else if (currentSectionType.toLowerCase().includes('prechorus')) {
                        // Slowly climb or sit in between
                        octaveCenter = PRNGManager.nextFloat(0, 1) > 0.5 ? 1 : 0;
                    }

                    // Start of a new 4-bar phrase regenerates/fetches the motif
                    if (currentMotif.length === 0 || currentBeat % 16 === 0) {
                        currentMotif = motifManager.getMotif(sec.name, currentSectionType, sec.energyLevel, 16);
                        motifBeatCursor = 0;
                        currentSectionEnergy = sec.energyLevel;
                        
                        // Phrase gap logic: yield to accompaniment at the END of the phrase
                        if (currentBeat > 0 && PRNGManager.nextFloat(0, 1) < 0.8) { // 80% chance to leave space at the end for resting
                            const restDuration = PRNGManager.nextInt(2, 6);
                            phraseGapStart = currentBeat + 16 - restDuration; 
                            phraseGapEnd = currentBeat + 16;
                        } else {
                            phraseGapStart = -1;
                            phraseGapEnd = -1;
                        }
                    }
                }
            } else if (currentMotif.length === 0 || currentBeat % 16 === 0) {
                currentMotif = motifManager.getMotif('Default', 'Default', 5, 16); 
                motifBeatCursor = 0;
                if (currentBeat > 0 && PRNGManager.nextFloat(0, 1) < 0.8) {
                    const restDuration = PRNGManager.nextInt(2, 6);
                    phraseGapStart = currentBeat + 16 - restDuration; 
                    phraseGapEnd = currentBeat + 16;
                } else {
                    phraseGapStart = -1;
                    phraseGapEnd = -1;
                }
            }

            // Figure out available target pitches for the melody over this chord
            const targetPcs: number[] = [];
            let scalePcs: number[] = [];

            if (frame) {
                const leadAllocations = frame.toneAllocations.filter(t => t.role === MusicalRole.Lead);
                for (const al of leadAllocations) {
                    targetPcs.push(al.pitchClass);
                }
                scalePcs = frame.pitchScale;
            }

            // Fallback if no specific target PCs
            if (targetPcs.length === 0) {
                const intervals = MusicTheory.getChordTones(chord.quality);
                if (intervals && intervals.length >= 3) {
                    targetPcs.push((chord.root + intervals[0]) % 12);
                    targetPcs.push((chord.root + intervals[1]) % 12);
                    targetPcs.push((chord.root + intervals[2]) % 12);
                } else {
                    targetPcs.push(chord.root);
                    targetPcs.push((chord.root + 7) % 12);
                    targetPcs.push((chord.root + 4) % 12);
                }
            }
            if (scalePcs.length === 0) {
                scalePcs = MusicTheory.getLocalScalePitches(chord.root, chord.quality, tonality);
            }

            // Generate rhythm for the duration of this chord
            const chordDuration = chord.endBeat - chord.startBeat;
            let beatsFilled = 0;

                while (beatsFilled < chordDuration) {
                    let motifNote = currentMotif[motifBeatCursor];
                    
                    if (!motifNote) {
                        motifBeatCursor = 0;
                        motifNote = currentMotif[motifBeatCursor] || { duration: 1.0, degreeOffset: 0, isTarget: false };
                    }
                
                motifBeatCursor = (motifBeatCursor + 1) % currentMotif.length;
                
                if (beatsFilled >= chordDuration) break;
                
                const actualDur = Math.abs(motifNote.duration);
                // Structural motif rest OR phrase gap
                const isRest = motifNote.duration < 0 || (currentBeat >= phraseGapStart && currentBeat < phraseGapEnd);

                // 🌟 遇到休止符/换气，紧张感清零
                if (isRest) lastNoteWasTension = false;

                let noteDur = actualDur;
                if (beatsFilled + noteDur > chordDuration) {
                    noteDur = chordDuration - beatsFilled;
                }

                if (!isRest && noteDur > 0) {
                        // Determine Melodic role based on Groove Structure
                        const isOnBeat = (currentBeat % 1.0) === 0;
                        const isStrongBeat = (currentBeat % 2.0) === 0; 
                        const isLongNote = noteDur >= 1.0; 
                        // Target note means it MUST be a chord tone
                        const isStructuralNote = isOnBeat || isStrongBeat || isLongNote || motifNote.isTarget;

                        // 🌟 1. 修复白开水 Bug：提取【局部和弦音阶 LocalScale】作为靶心！
                        const localScaleForTarget = scalePcs.length > 0 ? scalePcs : MusicTheory.getScalePitches(tonality);
                        const numScaleNotes = localScaleForTarget.length;
                        
                        let offset = motifNote.degreeOffset;
                        if (isStructuralNote && colorBias > 0.3 && PRNGManager.nextFloat(0, 1) < colorBias) {
                            offset += PRNGManager.nextFloat(0, 1) > 0.5 ? 1 : -1; // 修复单向叠加飙升
                        }

                        let targetIdx = offset; 
                        let octaves = Math.floor(targetIdx / numScaleNotes);
                        let remIdx = ((targetIdx % numScaleNotes) + numScaleNotes) % numScaleNotes;
                        
                        let idealPc = localScaleForTarget[remIdx]; // 靶心完美贴合高级和声色彩
                        let idealPitch = (octaveCenter * 12) + idealPc + (octaves * 12);
                        
                        // 2. 构建合法候选音池
                        let poolPcs = isStructuralNote && targetPcs.length > 0 ? targetPcs : scalePcs;
                        
                        // 🌟 3. 规避音过滤 (Avoid Notes) 完美级修复
                        if (isStructuralNote || noteDur >= 1.0) {
                            const basicTones = MusicTheory.getChordTones(chord.quality).map(i => (chord.root + i) % 12);
                            const isMajorType = chord.quality === ChordQualityEnum.Major || chord.quality === ChordQualityEnum.Major7 || chord.quality === ChordQualityEnum.Dominant7;

                            poolPcs = poolPcs.filter(pc => {
                                // 🌟 绝对保护：和弦根音和五音永远免死！(防止 Cmaj7 误杀 C)
                                if (pc === chord.root || pc === (chord.root + 7) % 12) return true;
                                
                                for(const tone of basicTones) {
                                    // 🌟 强拍绝对严禁出现小九度碰撞，移除随机放行漏洞！
                                    if (pc !== tone && (pc - tone + 12) % 12 === 1) return false;
                                }
                                // 🌟 过滤大和弦上的纯四度 (例如 Cmaj 上强拍唱 F)
                                if (isMajorType) {
                                    const perfect4th = (chord.root + 5) % 12;
                                    if (pc === perfect4th) return false;
                                }
                                return true;
                            });
                            if (poolPcs.length === 0) poolPcs = [chord.root];
                        }

                        // 🌟 4. 解决机制注入：如果处于紧张状态，必须在安全池中解决
                        let requiresResolution = false;
                        if (lastNoteWasTension) {
                            requiresResolution = true;
                            if (!isStructuralNote) poolPcs = scalePcs; 
                        }

                        // 将 PC 映射为物理音高（收拢八度范围防溢出）
                        const candidates: number[] = [];
                        for (let oct = -1; oct <= 1; oct++) { 
                            for (const pc of poolPcs) {
                                const absPitch = pc + (oct * 12) + (octaveCenter * 12);
                                if (absPitch >= minPitch && absPitch <= maxPitch) {
                                    candidates.push(absPitch);
                                }
                            }
                        }
                        if (candidates.length === 0) candidates.push(idealPitch);

                        // 🌟 5. 调用进化后的 A* 寻路大脑
                        const vocalCenter = (octaveCenter * 12); // 当前乐段的重力舒适中心
                        if (melody.length === 0) lastPitch = vocalCenter;

                        let chosenPitch = 0;
                        const { bestPitch } = MelodicContourEngine.selectBestPitch(
                            candidates,
                            lastPitch,
                            lastMotion,
                            idealPitch,
                            requiresResolution, // 告诉引擎必须解决！
                            vocalCenter         // 告诉引擎重力在哪
                        );
                        
                        chosenPitch = bestPitch;

                        // 🌟 核心状态机更新：判断刚刚唱出的音是不是弦外音（非 1、3、5 音）
                        const basicTonesForTensionCheck = MusicTheory.getChordTones(chord.quality).map(i => (chord.root + i) % 12);
                        lastNoteWasTension = !basicTonesForTensionCheck.includes(((chosenPitch % 12) + 12) % 12);

                        // 4. 强制歌曲结尾解决到安全音
                        const isLastNoteOfSong = i === chords.length - 1 && (beatsFilled + noteDur >= chordDuration);
                        if (isLastNoteOfSong) {
                            const tonicPc = 0; 
                            const minor3rdPc = 3;
                            const major3rdPc = 4;
                            const fifthPc = 7;
                            const validEndings = [tonicPc, fifthPc, tonality === Tonality.Major ? major3rdPc : minor3rdPc];
                            
                            let notePc = ((chosenPitch % 12) + 12) % 12;
                            if (!validEndings.includes(notePc)) {
                                let bestEnd = chosenPitch;
                                let minDiff = Infinity;
                                for (let oct = -1; oct <= 1; oct++) {
                                    for (let endPc of validEndings) {
                                        let cand = endPc + oct * 12;
                                        if (Math.abs(cand - chosenPitch) < minDiff) {
                                            minDiff = Math.abs(cand - chosenPitch);
                                            bestEnd = cand;
                                        }
                                    }
                                }
                                chosenPitch = bestEnd;
                            }
                        }

                        // 5. 触键动态写入
                        let actualOnset = currentBeat;
                        let actualDur = noteDur * 0.95; 
                        if (noteDur <= 0.5 && PRNGManager.nextFloat(0, 1) > 0.7) actualDur = noteDur * 0.7;

                        const baseVel = 30 + (currentSectionEnergy * 8); 
                        let vel = PRNGManager.nextInt(baseVel, baseVel + 20);
                        if (isOnBeat) vel += 15; 
                        if (actualDur >= 1.0) vel += 10;
                        if (octaveCenter > 0) vel += 8; 
                        
                        if (chosenPitch > 12) vel -= (chosenPitch - 12) * 1.5; // 高频柔化防刺耳

                        const selectedPcToScore = ((chosenPitch % 12) + 12) % 12;
                        const rawHarmonicWeight = HarmonicSeries.scorePitchClass(selectedPcToScore, chord.root, 0.0);
                        if (rawHarmonicWeight < 0.3) vel += 12 * colorBias;
                        else vel -= 5 * (1.0 - colorBias);

                        melody.push({
                            pitch: chosenPitch,
                            onset: actualOnset,
                            duration: actualDur,
                            velocity: Math.min(127, Math.max(1, vel)) / 127.0
                        });

                        lastMotion = chosenPitch - lastPitch;
                        lastPitch = chosenPitch;

                    }

                    currentBeat += noteDur;
                    beatsFilled += noteDur;
            }
        }

        // Apply Plugins
        melody = this.pluginManager.processAll(melody, { 
            tonality, 
            frames: harmonicFrames, 
            sections, 
            energyLevel: currentSectionEnergy,
            leadInstrument
        });

        return melody;
    }
}

```

### File: `src/core/generation/engines/melody/MotifManager.ts`

```typescript
import { PRNGManager } from '../../../utils/PRNG';
import { GrooveEngine } from './GrooveEngine';

export interface MotifNote {
    duration: number; // positive = note, negative = rest
    degreeOffset: number; // Scale degree offset relative to the motif's starting anchor
    isTarget: boolean; // True if this note should snap tightly to a chord tone
}

export class MotifManager {
    private motifs: Map<string, MotifNote[]> = new Map();

    public getMotif(sectionName: string, sectionType: string, energy: number, beatsToFill: number = 16): MotifNote[] {
        // Find or create the base thematic motif for this TYPE of section
        if (!this.motifs.has(sectionType)) {
            this.motifs.set(sectionType, this.generateThematicMotif(beatsToFill, energy, sectionType));
        }
        
        const baseMotif = this.motifs.get(sectionType)!;
        
        // Cache the specific variation for this EXACT section name (e.g., "Verse 2")
        // This ensures the motif is consistent within the 16 bars of "Verse 2", but "Verse 2" 
        // will feel musically related to but distinct from "Verse 1".
        if (!this.motifs.has(sectionName)) {
            // First time this base motif is used (e.g., Verse 1), keep it mostly the same, maybe 10% chance of small variation
            const isFirstOccurrence = sectionName === `Verse 1` || sectionName === `Chorus 1`; 
            const variationProb = isFirstOccurrence ? 0.1 : 0.85; // High chance of variation for subsequent versions
            
            if (PRNGManager.nextFloat(0, 1) < variationProb) {
                this.motifs.set(sectionName, this.createVariation(baseMotif));
            } else {
                this.motifs.set(sectionName, baseMotif);
            }
        }
        
        return this.motifs.get(sectionName)!;
    }

    private generateThematicMotif(beatsToFill: number, energy: number, sectionType: string): MotifNote[] {
        const motif: MotifNote[] = [];
        // We divide the phrase into an Antecedent (Question) and Consequent (Answer)
        const halfBeats = Math.floor(beatsToFill / 2); // usually 8 beats
        
        let currentDegree = 0;
        
        // Chorus specific logic: start higher, different rhythm traits
        const isChorus = sectionType.toLowerCase().includes('chorus');
        
        // 1. Generate Antecedent (Question)
        const rhythmA = GrooveEngine.generateMotif(halfBeats, energy);
        
        // For chorus, we want to start on a higher degree (e.g. 5th or Octave)
        if (isChorus) {
            currentDegree = PRNGManager.nextFloat(0, 1) > 0.5 ? 4 : 7; // 5th or Octave above
        }

        for (let i = 0; i < rhythmA.length; i++) {
            const dur = rhythmA[i];
            if (dur < 0) {
                motif.push({ duration: dur, degreeOffset: 0, isTarget: false });
            } else {
                const stepOptions = [-2, -1, -1, 0, 0, 1, 1, 2]; // Bias towards step-wise or repetitive
                const step = stepOptions[PRNGManager.nextInt(0, stepOptions.length - 1)];
                currentDegree += step;
                
                // Keep degree within reasonable vocal bounds
                if (currentDegree > 10) currentDegree = 10;
                if (currentDegree < -5) currentDegree = -5;

                const isTarget = Math.abs(dur) >= 1.0 || PRNGManager.nextFloat(0, 1) < 0.6;
                motif.push({ duration: dur, degreeOffset: currentDegree, isTarget: isTarget });
            }
        }
        
        // Question often ends on an unresolved note (e.g., 2nd or 7th)
        if (motif.length > 0) {
            motif[motif.length - 1].degreeOffset += 1;
        }

        // 2. Generate Consequent (Answer)
        // Chorus usually repeats rhythms exactly, Verse might vary
        const repeatThreshold = isChorus ? 0.8 : 0.5;
        const rhythmB = (PRNGManager.nextFloat(0, 1) < repeatThreshold) 
            ? rhythmA.slice() 
            : GrooveEngine.generateMotif(beatsToFill - halfBeats, energy);
            
        // Reset contour to match A
        currentDegree = motif[0]?.degreeOffset ?? 0;

        for (let i = 0; i < rhythmB.length; i++) {
            const dur = rhythmB[i];
            if (dur < 0) {
                motif.push({ duration: dur, degreeOffset: 0, isTarget: false });
            } else {
                const stepOptions = [-2, -1, 0, 1, 2];
                const step = stepOptions[PRNGManager.nextInt(0, stepOptions.length - 1)];
                currentDegree += step;
                
                if (currentDegree > 10) currentDegree = 10;
                if (currentDegree < -5) currentDegree = -5;

                const isTarget = Math.abs(dur) >= 1.0 || PRNGManager.nextFloat(0, 1) < 0.7;
                motif.push({ duration: dur, degreeOffset: currentDegree, isTarget: isTarget });
            }
        }
        
        // Answer ends on a strong resolution (tonic or 3rd)
        if (motif.length > 0) {
            // Find the last actual note and snap it to 0 (root) or 2 (third)
            for (let i = motif.length - 1; i >= 0; i--) {
                if (motif[i].duration > 0) {
                    motif[i].degreeOffset = isChorus ? 0 : (PRNGManager.nextFloat(0, 1) > 0.5 ? 0 : 2); 
                    motif[i].isTarget = true;
                    break;
                }
            }
        }

        return motif;
    }

    private createVariation(original: MotifNote[]): MotifNote[] {
        const diff = PRNGManager.nextFloat(0, 1);
        
        let newMotif = [...original];

        if (diff < 0.20) {
            // Sequence UP (Transposition)
            newMotif = newMotif.map(note => note.duration < 0 ? note : { ...note, degreeOffset: note.degreeOffset + 1 });
        } else if (diff < 0.40) {
            // Sequence DOWN (Transposition)
            newMotif = newMotif.map(note => note.duration < 0 ? note : { ...note, degreeOffset: note.degreeOffset - 1 });
        } else if (diff < 0.60) {
            // INVERSION: Invert melodic contour around the first note
            if (newMotif.length > 0) {
                const firstNote = newMotif.find(n => n.duration > 0);
                if (firstNote) {
                    const axis = firstNote.degreeOffset;
                    newMotif = newMotif.map(note => {
                        if (note.duration < 0) return note;
                        const distance = note.degreeOffset - axis;
                        return { ...note, degreeOffset: axis - distance };
                    });
                }
            }
        } else if (diff < 0.75) {
            // INTERVAL EXPANSION: Multiply the intervals from the start to make it more dramatic
            if (newMotif.length > 0) {
                 const firstNote = newMotif.find(n => n.duration > 0);
                 if (firstNote) {
                     const axis = firstNote.degreeOffset;
                     newMotif = newMotif.map(note => {
                         if (note.duration < 0) return note;
                         const distance = note.degreeOffset - axis;
                         return { ...note, degreeOffset: axis + (distance * 2) }; // Expand
                     });
                 }
            }
        } else if (diff < 0.85) {
             // RETROGRADE (Rhythmic and Melodic)
             const tempMotif = newMotif.filter(n => n.duration > 0); // Reverse just the notes, keep rests in place if possible?
             // Actually, a simple array reverse is true retrograde
             newMotif = newMotif.slice().reverse();
        } else {
             // RHYTHMIC DIMINUTION / SYNCOPATION
             newMotif = newMotif.map(note => {
                 if (note.duration === 0.5) return { ...note, duration: 0.25 };
                 if (note.duration === 1.0) return { ...note, duration: 0.5 };
                 return note;
             });
        }

        // Safety clamp degrees
        return newMotif.map(note => {
            if (note.duration < 0) return note;
            let d = note.degreeOffset;
            if (d < -7) d = -7;
            if (d > 12) d = 12;
            return { ...note, degreeOffset: Math.round(d) };
        });
    }
}

```

### File: `src/core/generation/engines/melody/RhythmCells.ts`

```typescript
export const BASIC_RHYTHM_CELLS = [
    [1.0],
    [0.5, 0.5],
    [0.25, 0.25, 0.5],
    [0.5, 0.25, 0.25],
    [0.25, 0.25, 0.25, 0.25],
    [1.5, 0.5],
    [0.5, 1.5],
    [0.75, 0.25],
    [0.25, 0.75],
    [-0.5, 0.5],
    [0.5, -0.5],
    [-1.0],
    [2.0],
    [0.5, 1.0, 0.5],
    [-0.5, 1.0, -0.5]
];

```

### File: `src/core/generation/engines/melody/plugins/ApproachNotePlugin.ts`

```typescript
import { NoteData, Tonality, GlobalHarmonicFrame, SectionMetadata } from '../../../types';
import { ToplinePlugin, ToplinePluginContext } from './ToplinePlugin';
import { PRNGManager } from '../../../../utils/PRNG';
import { MusicTheory } from '../../../theory/MusicTheory';

export class ApproachNotePlugin implements ToplinePlugin {
    process(melodyTrack: NoteData[], context: ToplinePluginContext): NoteData[] {
        const enhancedMelody: NoteData[] = [];
        const scalePcs = MusicTheory.getScalePitches(context.tonality);

        for (let i = 0; i < melodyTrack.length; i++) {
            const currentNote = melodyTrack[i];
            const previousNote = i > 0 ? melodyTrack[i - 1] : null;

            // Chromatic approach usually happens leading into a strong note (like the root of the chord)
            // It replaces the space right before the target
            if (previousNote && currentNote.duration >= 0.5) {
                const gap = currentNote.onset - (previousNote.onset + previousNote.duration);
                const approachProb = 0.2 + (context.energyLevel / 10) * 0.2;

                if (gap >= 0.25 && PRNGManager.nextFloat(0, 1) < approachProb) {
                    const approachType = PRNGManager.nextInt(0, 1); // 0: chromatic below, 1: diatonic above
                    
                    if (approachType === 0) {
                        // Chromatic from below
                        enhancedMelody.push({
                            pitch: currentNote.pitch - 1,
                            onset: currentNote.onset - 0.25,
                            duration: 0.25 * 0.9,
                            velocity: currentNote.velocity * 0.8
                        });
                    } else if (approachType === 1) {
                        // Diatonic from above
                        let abovePitch = currentNote.pitch + 2;
                        abovePitch = MusicTheory.snapToPool(abovePitch, scalePcs);
                        enhancedMelody.push({
                            pitch: abovePitch,
                            onset: currentNote.onset - 0.25,
                            duration: 0.25 * 0.9,
                            velocity: currentNote.velocity * 0.8
                        });
                    }
                }
            }
            
            enhancedMelody.push({ ...currentNote });
        }

        enhancedMelody.sort((a, b) => a.onset - b.onset);
        return enhancedMelody;
    }
}

```

### File: `src/core/generation/engines/melody/plugins/DelayedNotePlugin.ts`

```typescript
import { NoteData, Tonality, GlobalHarmonicFrame, SectionMetadata } from '../../../types';
import { ToplinePlugin, ToplinePluginContext } from './ToplinePlugin';
import { PRNGManager } from '../../../../utils/PRNG';

export class DelayedNotePlugin implements ToplinePlugin {
    name = 'DelayedNote';
    process(melodyTrack: NoteData[], context: ToplinePluginContext): NoteData[] {
        const enhancedMelody: NoteData[] = [];
        
        let i = 0;
        while (i < melodyTrack.length) {
            const currentNote = melodyTrack[i];
            
            const isStrongBeat = currentNote.onset % 1.0 === 0;

            // Give it a small chance to be delayed
            const delayProb = 0.05 + (context.energyLevel / 10) * 0.1; 

            if (isStrongBeat && currentNote.duration >= 0.5 && PRNGManager.nextFloat(0, 1) < delayProb) {
                // Decide amount of delay: an 8th note (0.5) or a 16th note (0.25)
                const shiftAmount = PRNGManager.nextFloat(0, 1) > 0.5 ? 0.5 : 0.25;
                const newOnset = currentNote.onset + shiftAmount;
                const newDuration = currentNote.duration - shiftAmount; 

                if (newDuration > 0.125) {
                    enhancedMelody.push({
                        pitch: currentNote.pitch,
                        onset: newOnset,
                        duration: newDuration,
                        velocity: currentNote.velocity
                    });
                } else {
                    enhancedMelody.push({ ...currentNote });
                }
            } else {
                enhancedMelody.push({ ...currentNote });
            }
            i++;
        }

        return enhancedMelody;
    }
}

```

### File: `src/core/generation/engines/melody/plugins/EnclosurePlugin.ts`

```typescript
import { NoteData, Tonality, GlobalHarmonicFrame, SectionMetadata } from '../../../types';
import { ToplinePlugin, ToplinePluginContext } from './ToplinePlugin';
import { PRNGManager } from '../../../../utils/PRNG';
import { MusicTheory } from '../../../theory/MusicTheory';

export class EnclosurePlugin implements ToplinePlugin {
    name = 'Enclosure';
    
    process(melodyTrack: NoteData[], context: ToplinePluginContext): NoteData[] {
        const enhancedMelody: NoteData[] = [];
        const scalePcs = MusicTheory.getScalePitches(context.tonality);

        for (let i = 0; i < melodyTrack.length; i++) {
            const currentNote = melodyTrack[i];
            const previousNote = i > 0 ? melodyTrack[i - 1] : null;

            if (previousNote && currentNote.duration >= 0.5) {
                const gap = currentNote.onset - (previousNote.onset + previousNote.duration);
                const approachProb = 0.15 + (context.energyLevel / 10) * 0.2;

                if (gap >= 0.5 && PRNGManager.nextFloat(0, 1) < approachProb) {
                    // Enclosure (Above, then Below)
                    let abovePitch = currentNote.pitch + 2;
                    abovePitch = MusicTheory.snapToPool(abovePitch, scalePcs);
                    const belowPitch = currentNote.pitch - 1; // often chromatic below

                    enhancedMelody.push({
                        pitch: abovePitch,
                        onset: currentNote.onset - 0.5,
                        duration: 0.25 * 0.9,
                        velocity: currentNote.velocity * 0.8
                    });
                    enhancedMelody.push({
                        pitch: belowPitch,
                        onset: currentNote.onset - 0.25,
                        duration: 0.25 * 0.9,
                        velocity: currentNote.velocity * 0.85
                    });
                }
            }
            
            enhancedMelody.push({ ...currentNote });
        }

        enhancedMelody.sort((a, b) => a.onset - b.onset);
        return enhancedMelody;
    }
}

```

### File: `src/core/generation/engines/melody/plugins/GraceNotePlugin.ts`

```typescript
import { NoteData } from '../../../types';
import { ToplinePlugin, ToplinePluginContext } from './ToplinePlugin';
import { PRNGManager } from '../../../../utils/PRNG';
import { MusicTheory } from '../../../theory/MusicTheory';

export class GraceNotePlugin implements ToplinePlugin {
    name = 'GraceNote';
    
    process(melodyTrack: NoteData[], context: ToplinePluginContext): NoteData[] {
        const enhancedMelody: NoteData[] = [];
        const scalePcs = MusicTheory.getScalePitches(context.tonality);

        for (let i = 0; i < melodyTrack.length; i++) {
            let note = { ...melodyTrack[i] };
            
            // Appoggiatura / Grace Note (Acciaccatura)
            // Chance to add a very quick grace note right before a strong beat / long note
            if (note.duration >= 0.5 && PRNGManager.nextFloat(0, 1) < 0.15) {
                const graceDur = 0.05; // very short
                const graceOnset = note.onset - graceDur;
                
                // Usually an upper or lower neighbor (diatonic)
                const isUpper = PRNGManager.nextFloat(0, 1) > 0.5;
                let gracePitch = note.pitch + (isUpper ? 2 : -2); 
                gracePitch = MusicTheory.snapToPool(gracePitch, scalePcs);
                
                // Prevent overlapping with VERY close previous notes
                const prev = enhancedMelody.length > 0 ? enhancedMelody[enhancedMelody.length - 1] : null;
                if (!prev || (prev.onset + prev.duration <= graceOnset)) {
                    enhancedMelody.push({
                        pitch: gracePitch,
                        onset: Math.max(0, graceOnset), // Don't go before 0
                        duration: graceDur * 0.8,
                        velocity: note.velocity * 0.6 // grace notes are softer
                    });
                }
            }

            enhancedMelody.push(note);
        }
        
        enhancedMelody.sort((a, b) => a.onset - b.onset);
        return enhancedMelody;
    }
}

```

### File: `src/core/generation/engines/melody/plugins/HarmonizationPlugin.ts`

```typescript
import { NoteData, GlobalHarmonicFrame } from '../../../types';
import { PRNGManager } from '../../../../utils/PRNG';
import { ToplinePlugin, ToplinePluginContext } from './ToplinePlugin';

export class HarmonizationPlugin implements ToplinePlugin {
    name = 'Harmonization';
    process(melodyTrack: NoteData[], context: ToplinePluginContext): NoteData[] {
        // Only harmonize if the instrument explicitly supports polyphony (e.g. Piano, Guitar)
        if (context.leadInstrument && context.leadInstrument.isMonophonic) {
            return melodyTrack; // Saxophone, Flute, Singer, etc. -> no added harmonies!
        }
        
        // Wait until medium/high energy
        if (context.energyLevel < 6) {
            return melodyTrack;
        }

        const harmonizedTrack: NoteData[] = [];
        const frames = context.frames || [];

        for (let i = 0; i < melodyTrack.length; i++) {
            const note = melodyTrack[i];
            harmonizedTrack.push(note); // Always keep the main melody note
            
            // Only harmonize primary notes (not extreme grace notes or passing notes unless they are long enough)
            if (note.duration < 0.25 || note.isGraceNote) {
                continue;
            }

            // Only harmonize at a certain probability based on energy
            // Energy 6: ~20%, Energy 9: ~80%
            const harmonizeProb = (context.energyLevel - 5) * 0.2;
            
            if (PRNGManager.nextFloat(0, 1) < harmonizeProb) {
                // Determine harmony interval. Mostly 3rds and 6ths below the melody.
                const frame = frames.find(f => note.onset >= f.startBeat && note.onset < f.endBeat);
                if (frame) {
                    const localScale = frame.pitchScale;
                    // Find the melody note index in the local scale
                    // Note: melody pitch might be multiple octaves up, so we need to map correctly.
                    const pc = ((note.pitch % 12) + 12) % 12;
                    let scaleIdx = localScale.indexOf(pc);
                    
                    if (scaleIdx !== -1) {
                        // Diatonic target interval (e.g. -2 for a 3rd down, -5 for a 6th down)
                        const isSixth = PRNGManager.nextFloat(0, 1) > 0.6;
                        const intervalSteps = isSixth ? 5 : 2; 

                        let targetIdx = scaleIdx - intervalSteps;
                        const numScaleNotes = localScale.length;
                        
                        let octavesDown = Math.floor(targetIdx / numScaleNotes);
                        if (targetIdx < 0) {
                            octavesDown = Math.floor(targetIdx / numScaleNotes);
                        }
                        
                        let remIdx = ((targetIdx % numScaleNotes) + numScaleNotes) % numScaleNotes;
                        
                        let harmonyPc = localScale[remIdx];
                        
                        // We want the harmony note to be exactly below the melody note
                        let exactPitchDown = note.pitch;
                        while (((exactPitchDown % 12) + 12) % 12 !== harmonyPc) {
                            exactPitchDown--;
                            // safety escape
                            if (note.pitch - exactPitchDown > 18) {
                                break;
                            }
                        }
                        
                        if (note.pitch - exactPitchDown <= 12) {
                            harmonizedTrack.push({
                                pitch: exactPitchDown,
                                onset: note.onset,
                                duration: note.duration, // exactly match the main note duration
                                velocity: note.velocity * 0.85 // softly harmonize
                            });
                        }
                    }
                }
            }
        }

        return harmonizedTrack;
    }
}

```

### File: `src/core/generation/engines/melody/plugins/MelodyHumanizePlugin.ts`

```typescript
import { NoteData } from '../../../types';
import { ToplinePlugin, ToplinePluginContext } from './ToplinePlugin';
import { PRNGManager } from '../../../../utils/PRNG';

export class MelodyHumanizePlugin implements ToplinePlugin {
    name = 'MelodyHumanize';
    
    process(melodyTrack: NoteData[], context: ToplinePluginContext): NoteData[] {
        const enhancedMelody: NoteData[] = [];

        for (let i = 0; i < melodyTrack.length; i++) {
            let note = { ...melodyTrack[i] };
            
            // Micro-timing shifts (Humanization)
            // Very subtly shift the onset ahead or behind the beat by a tiny fraction
            const humanizeAmt = 0.02; // max shift 
            const shift = PRNGManager.nextFloat(-humanizeAmt, humanizeAmt);
            // Dont push into negatives
            if (note.onset + shift > 0) {
                note.onset += shift;
            }

            enhancedMelody.push(note);
        }
        
        enhancedMelody.sort((a, b) => a.onset - b.onset);
        return enhancedMelody;
    }
}

```

### File: `src/core/generation/engines/melody/plugins/PassingNotePlugin.ts`

```typescript
import { NoteData, Tonality, GlobalHarmonicFrame, SectionMetadata } from '../../../types';
import { ToplinePlugin, ToplinePluginContext } from './ToplinePlugin';
import { PRNGManager } from '../../../../utils/PRNG';
import { MusicTheory } from '../../../theory/MusicTheory';

export class PassingNotePlugin implements ToplinePlugin {
    name = 'PassingNote';
    process(melodyTrack: NoteData[], context: ToplinePluginContext): NoteData[] {
        const enhancedMelody: NoteData[] = [];
        const scalePcs = MusicTheory.getScalePitches(context.tonality);
        
        for (let i = 0; i < melodyTrack.length; i++) {
            const currentNote = melodyTrack[i];
            const previousNote = i > 0 ? melodyTrack[i - 1] : null;

            if (previousNote && currentNote.duration >= 0.5 && PRNGManager.nextFloat(0, 1) > 0.4) { // make it slightly more eager
                const dist = Math.abs(currentNote.pitch - previousNote.pitch);
                
                // Gap is large enough to warrant passing notes/scale runs
                if (dist >= 3 && dist <= 12) {
                    const gapDuration = currentNote.onset - (previousNote.onset + previousNote.duration);
                    
                    // Snap to local scale if available
                    let localScalePcs = scalePcs;
                    if (context.frames) {
                        const frame = context.frames.find(f => currentNote.onset >= f.startBeat && currentNote.onset < f.endBeat);
                        if (frame) {
                            localScalePcs = frame.pitchScale;
                        }
                    }

                    if (dist >= 5 && gapDuration >= 0.5 && PRNGManager.nextFloat(0, 1) > 0.5) {
                        // Wide gap: generate a fast scale run (e.g. 2 or 3 16th notes)
                        const runSteps = gapDuration >= 0.75 ? 3 : 2;
                        const runNoteDur = 0.25;
                        const direction = currentNote.pitch > previousNote.pitch ? 1 : -1;
                        
                        let currentPitch = previousNote.pitch;
                        for (let r = 0; r < runSteps; r++) {
                            // Step towards target
                            currentPitch += direction * PRNGManager.nextInt(1, 3);
                            currentPitch = MusicTheory.snapToPool(currentPitch, localScalePcs);
                            
                            const runOnset = previousNote.onset + previousNote.duration + (r * runNoteDur);
                            
                            // Prevent bleeding into current target note
                            if (runOnset + runNoteDur <= currentNote.onset) {
                                enhancedMelody.push({
                                    pitch: currentPitch,
                                    onset: runOnset,
                                    duration: runNoteDur * 0.9,
                                    velocity: PRNGManager.nextInt(40, 60) / 127.0
                                });
                            }
                        }
                    } else if (dist <= 7) {
                        // Simple single passing approach
                        let approachPitch = currentNote.pitch > previousNote.pitch ? currentNote.pitch - PRNGManager.nextInt(1, 2) : currentNote.pitch + PRNGManager.nextInt(1, 2);
                        approachPitch = MusicTheory.snapToPool(approachPitch, localScalePcs);
                        
                        const passingDur = 0.25; 
                        const baseVelPassing = 40 + (context.energyLevel * 5); 
                        
                        const passingOnset = currentNote.onset - passingDur;
                        
                        // If gap is too small, cut previous note
                        if (previousNote.onset + previousNote.duration > passingOnset) {
                            // Cut previous note length
                            previousNote.duration = Math.max(0.125, passingOnset - previousNote.onset);
                        }

                        // Just double check we don't overlap completely backwards 
                        if (passingOnset >= previousNote.onset + previousNote.duration) {
                            enhancedMelody.push({
                                pitch: approachPitch,
                                onset: passingOnset,
                                duration: passingDur * 0.9,
                                velocity: PRNGManager.nextInt(baseVelPassing, baseVelPassing + 15) / 127.0
                            });
                        }
                    }
                }
            }
            enhancedMelody.push({ ...currentNote });
        }

        enhancedMelody.sort((a, b) => a.onset - b.onset);
        return enhancedMelody;
    }
}

```

### File: `src/core/generation/engines/melody/plugins/PickupNotePlugin.ts`

```typescript
import { NoteData, Tonality, GlobalHarmonicFrame, SectionMetadata } from '../../../types';
import { ToplinePlugin, ToplinePluginContext } from './ToplinePlugin';
import { PRNGManager } from '../../../../utils/PRNG';
import { MusicTheory } from '../../../theory/MusicTheory';

export class PickupNotePlugin implements ToplinePlugin {
    name = 'PickupNote';
    process(melodyTrack: NoteData[], context: ToplinePluginContext): NoteData[] {
        const enhancedMelody: NoteData[] = [];
        const scalePcs = MusicTheory.getScalePitches(context.tonality);

        for (let i = 0; i < melodyTrack.length; i++) {
            const currentNote = melodyTrack[i];
            const previousNote = i > 0 ? melodyTrack[i - 1] : null;

            // Check if there is a big gap before this note, suggesting a new phrase
            const gap = previousNote ? currentNote.onset - (previousNote.onset + previousNote.duration) : currentNote.onset;

            // If gap is at least 1 beat, and it's on a strong beat or specifically requested by energy
            const pickupProb = 0.3 + (context.energyLevel / 10) * 0.4;
            
            if (gap >= 1.0 && PRNGManager.nextFloat(0, 1) < pickupProb) {
                // Decide 1 or 2 pickup notes
                const numPickups = PRNGManager.nextFloat(0, 1) > 0.5 ? 2 : 1;
                const pickupDur = 0.25; // 16th note pickups typical for pop

                // Are we approaching from below or above?
                const approachDir = PRNGManager.nextFloat(0, 1) > 0.5 ? -1 : 1;
                
                // Get local scale
                let localScale = scalePcs;
                if (context.frames) {
                    const frame = context.frames.find(f => currentNote.onset >= f.startBeat && currentNote.onset < f.endBeat);
                    if (frame) {
                        localScale = frame.pitchScale;
                    }
                }

                // Inject pickups
                for (let p = 0; p < numPickups; p++) {
                    // Notes logically walk towards the target pitch
                    const stepsAway = numPickups - p;
                    let pPitch = currentNote.pitch + (stepsAway * approachDir * PRNGManager.nextInt(1, 2));
                    pPitch = MusicTheory.snapToPool(pPitch, localScale);

                    const pOnset = currentNote.onset - (stepsAway * pickupDur);
                    
                    // Safety check against previous note
                    if (!previousNote || pOnset >= previousNote.onset + previousNote.duration) {
                        enhancedMelody.push({
                            pitch: pPitch,
                            onset: pOnset,
                            duration: pickupDur * 0.9,
                            velocity: currentNote.velocity * 0.8 // slightly softer than target
                        });
                    }
                }
            }

            enhancedMelody.push({ ...currentNote });
        }

        // Sort by onset just in case
        enhancedMelody.sort((a, b) => a.onset - b.onset);
        return enhancedMelody;
    }
}

```

### File: `src/core/generation/engines/melody/plugins/SyncopationPlugin.ts`

```typescript
import { NoteData, Tonality, GlobalHarmonicFrame, SectionMetadata } from '../../../types';
import { ToplinePlugin, ToplinePluginContext } from './ToplinePlugin';
import { PRNGManager } from '../../../../utils/PRNG';

export class SyncopationPlugin implements ToplinePlugin {
    name = 'Syncopation';
    process(melodyTrack: NoteData[], context: ToplinePluginContext): NoteData[] {
        const enhancedMelody: NoteData[] = [];
        
        let i = 0;
        while (i < melodyTrack.length) {
            const currentNote = melodyTrack[i];
            
            // Check if note is on a strong beat (e.g., quarter note downbeats: 0, 1, 2, 3)
            const isStrongBeat = currentNote.onset % 1.0 === 0;

            // Give it a chance to be syncopated (anticipated)
            // Higher energy = more syncopation, up to 40% chance
            const syncProb = 0.15 + (context.energyLevel / 10) * 0.25; 

            if (isStrongBeat && currentNote.duration >= 0.5 && PRNGManager.nextFloat(0, 1) < syncProb) {
                // Decide amount of anticipation: an 8th note (0.5) or a 16th note (0.25)
                const shiftAmount = PRNGManager.nextFloat(0, 1) > 0.5 ? 0.5 : 0.25;
                const newOnset = currentNote.onset - shiftAmount;
                const newDuration = currentNote.duration + shiftAmount; // extend to cover the space

                // Ensure it doesn't overlap completely with previous note
                const previousNote = enhancedMelody.length > 0 ? enhancedMelody[enhancedMelody.length - 1] : null;
                let canShift = true;

                if (previousNote) {
                    if (previousNote.onset >= newOnset) {
                        // Previous note starts after or exactly at the new onset, can't shift
                        canShift = false;
                    } else if (previousNote.onset + previousNote.duration > newOnset) {
                        // Trim previous note
                        previousNote.duration = newOnset - previousNote.onset;
                        // Avoid tiny left-over durations like 1/32th
                        if (previousNote.duration < 0.125) {
                            canShift = false;
                        }
                    }
                } else if (newOnset < 0) {
                    canShift = false; // Cannot shift before start of song
                }

                if (canShift) {
                    // Accent the anticipated note slightly
                    const newVelocity = Math.min(1.0, currentNote.velocity * 1.1);
                    enhancedMelody.push({
                        pitch: currentNote.pitch,
                        onset: newOnset,
                        duration: newDuration,
                        velocity: newVelocity
                    });
                } else {
                    enhancedMelody.push({ ...currentNote });
                }
            } else {
                enhancedMelody.push({ ...currentNote });
            }
            i++;
        }

        return enhancedMelody;
    }
}

```

### File: `src/core/generation/engines/melody/plugins/ToplinePlugin.ts`

```typescript
import { NoteData, Tonality, GlobalHarmonicFrame, SectionMetadata, InstrumentConfig } from '../../../types';

export interface ToplinePluginContext {
    tonality: Tonality;
    frames?: GlobalHarmonicFrame[];
    sections?: SectionMetadata[];
    energyLevel: number;
    leadInstrument?: InstrumentConfig;
}

export interface ToplinePlugin {
    name?: string;
    process(melodyTrack: NoteData[], context: ToplinePluginContext): NoteData[];
}

```

### File: `src/core/generation/engines/melody/plugins/ToplinePluginManager.ts`

```typescript
import { ToplinePlugin, ToplinePluginContext } from './ToplinePlugin';
import { PickupNotePlugin } from './PickupNotePlugin';
import { SyncopationPlugin } from './SyncopationPlugin';
import { DelayedNotePlugin } from './DelayedNotePlugin';
import { PassingNotePlugin } from './PassingNotePlugin';
import { ApproachNotePlugin } from './ApproachNotePlugin';
import { EnclosurePlugin } from './EnclosurePlugin';
import { GraceNotePlugin } from './GraceNotePlugin';
import { TrillPlugin } from './TrillPlugin';
import { MelodyHumanizePlugin } from './MelodyHumanizePlugin';
import { HarmonizationPlugin } from './HarmonizationPlugin';
import { NoteData } from '../../../types';

export class ToplinePluginManager {
    private plugins: ToplinePlugin[] = [];

    constructor() {
        // Register default plugins in specific order of processing
        this.register(new PickupNotePlugin());
        this.register(new SyncopationPlugin());
        this.register(new DelayedNotePlugin());
        this.register(new PassingNotePlugin());
        this.register(new ApproachNotePlugin());
        this.register(new EnclosurePlugin());
        this.register(new GraceNotePlugin());
        this.register(new TrillPlugin());
        this.register(new MelodyHumanizePlugin());
        this.register(new HarmonizationPlugin());
    }

    public register(plugin: ToplinePlugin) {
        if (!plugin.name) {
            plugin.name = plugin.constructor.name;
        }
        this.plugins.push(plugin);
    }

    public remove(pluginName: string) {
        this.plugins = this.plugins.filter(p => p.name !== pluginName);
    }

    public getPlugins(): ToplinePlugin[] {
        return this.plugins;
    }

    public processAll(melodyTrack: NoteData[], context: ToplinePluginContext): NoteData[] {
        let currentMelody = [...melodyTrack];
        
        for (const plugin of this.plugins) {
            // Can add logic here to skip plugins based on persona or context later.
            currentMelody = plugin.process(currentMelody, context);
        }

        return currentMelody;
    }
}

```

### File: `src/core/generation/engines/melody/plugins/TrillPlugin.ts`

```typescript
import { NoteData } from '../../../types';
import { ToplinePlugin, ToplinePluginContext } from './ToplinePlugin';
import { PRNGManager } from '../../../../utils/PRNG';
import { MusicTheory } from '../../../theory/MusicTheory';

export class TrillPlugin implements ToplinePlugin {
    name = 'Trill';
    
    process(melodyTrack: NoteData[], context: ToplinePluginContext): NoteData[] {
        const enhancedMelody: NoteData[] = [];
        const scalePcs = MusicTheory.getScalePitches(context.tonality);

        for (let i = 0; i < melodyTrack.length; i++) {
            let note = { ...melodyTrack[i] };
            
            // Mordent / Quick Trill
            // Chance to split a long note into a quick ornament
            if (note.duration >= 1.0 && PRNGManager.nextFloat(0, 1) < 0.1) {
                const trillDur = 0.125;
                const trillPitch = MusicTheory.snapToPool(note.pitch + 2, scalePcs);
                
                // Main note starts, quickly goes to trill, then back
                enhancedMelody.push({
                    pitch: note.pitch,
                    onset: note.onset,
                    duration: trillDur,
                    velocity: note.velocity
                });
                
                enhancedMelody.push({
                    pitch: trillPitch,
                    onset: note.onset + trillDur,
                    duration: trillDur,
                    velocity: note.velocity * 0.8
                });
                
                // Adjust original note
                note.onset += (trillDur * 2);
                note.duration -= (trillDur * 2);
            }

            enhancedMelody.push(note);
        }
        
        enhancedMelody.sort((a, b) => a.onset - b.onset);
        return enhancedMelody;
    }
}

```

### File: `src/core/generation/instruments/ElectricBass.ts`

```typescript
import { InstrumentConfig, MusicalRole } from '../types';

export const ElectricBass: InstrumentConfig = {
    id: 2,
    name: 'Electric Bass',
    minPitch: 28, // E1
    maxPitch: 67, // G4
    maxPolyphony: 4, 
    antiMudThreshold: 0, // N/A
    supportsPitchBend: true,
    supportsSlide: true,
    isMonophonic: true,
    capabilities: [MusicalRole.Bass, MusicalRole.Lead] // Can play bass lines, and technically melodies
};

```

### File: `src/core/generation/instruments/ElectricPiano.ts`

```typescript
import { InstrumentConfig, MusicalRole } from '../types';

export const ElectricPiano: InstrumentConfig = {
    id: 1,
    name: 'Electric Piano',
    minPitch: 21,
    maxPitch: 108,
    maxPolyphony: 10,
    antiMudThreshold: 45, // A2 (rhodes can go lower before muddiness sometimes)
    supportsPitchBend: false,
    supportsSlide: false,
    isMonophonic: false,
    supportsSustainPedal: true,
    isElectronic: false,
    capabilities: [MusicalRole.Lead, MusicalRole.Accomp, MusicalRole.Bass]
};

```

### File: `src/core/generation/instruments/GrandPiano.ts`

```typescript
import { InstrumentConfig, MusicalRole } from '../types';

export const GrandPiano: InstrumentConfig = {
    id: 0,
    name: 'Grand Piano',
    minPitch: 21, // A0
    maxPitch: 108, // C8
    maxPolyphony: 10, // Ten fingers
    antiMudThreshold: 48, // C3
    supportsPitchBend: false,
    supportsSlide: false,
    isMonophonic: false,
    supportsSustainPedal: true,
    isElectronic: false,
    capabilities: [MusicalRole.Lead, MusicalRole.Accomp, MusicalRole.Bass]
};

```

### File: `src/core/generation/instruments/StandardDrumKit.ts`

```typescript
import { InstrumentConfig, MusicalRole } from '../types';

export const StandardDrumKit: InstrumentConfig = {
    id: 3,
    name: 'Standard Drum Kit',
    minPitch: 35, // Acoustic Bass Drum
    maxPitch: 81, // Open Triangle
    maxPolyphony: 4, // 4 limbs
    antiMudThreshold: 0,
    supportsPitchBend: false,
    supportsSlide: false,
    isMonophonic: false,
    capabilities: [MusicalRole.Percussion]
};

```

### File: `src/core/generation/instruments/SynthLead.ts`

```typescript
import { InstrumentConfig, MusicalRole } from '../types';

export const SynthLead: InstrumentConfig = {
    id: 81, // General MIDI Lead 2 (sawtooth)
    name: 'Synth Lead (Sawtooth)',
    minPitch: 36, // C2
    maxPitch: 96, // C7
    maxPolyphony: 8,
    antiMudThreshold: 48, // C3
    supportsPitchBend: true,
    supportsSlide: true,
    isMonophonic: false, // Set to false to allow chords/arpeggios for accomp
    supportsSustainPedal: false,
    isElectronic: true,
    capabilities: [MusicalRole.Lead, MusicalRole.Accomp, MusicalRole.CounterMelody]
};

```

### File: `src/core/generation/instruments/SynthPad.ts`

```typescript
import { InstrumentConfig, MusicalRole } from '../types';

export const SynthPad: InstrumentConfig = {
    id: 89, // Warm Pad (General MIDI)
    name: "Pop Pad",
    minPitch: 36, // C2
    maxPitch: 84, // C6
    maxPolyphony: 8,
    antiMudThreshold: 55, // G3
    supportsPitchBend: true,
    supportsSlide: false,
    isMonophonic: false,
    supportsSustainPedal: false,
    isElectronic: true,
    capabilities: [MusicalRole.Accomp, MusicalRole.CounterMelody]
};

```

### File: `src/core/generation/manifests/InstrumentRegistry.ts`

```typescript
import { InstrumentConfig } from '../types';
import { GrandPiano } from '../instruments/GrandPiano';
import { ElectricPiano } from '../instruments/ElectricPiano';
import { ElectricBass } from '../instruments/ElectricBass';
import { StandardDrumKit } from '../instruments/StandardDrumKit';
import { SynthPad } from '../instruments/SynthPad';
import { SynthLead } from '../instruments/SynthLead';

export const INSTRUMENT_REGISTRY: Record<number, InstrumentConfig> = {
    0: GrandPiano,
    1: ElectricPiano,
    2: ElectricBass,
    3: StandardDrumKit,
    81: SynthLead,
    89: SynthPad
};

export function getInstrumentConfig(id: number): InstrumentConfig {
    return INSTRUMENT_REGISTRY[id] || INSTRUMENT_REGISTRY[0];
}

```

### File: `src/core/generation/manifests/MusicianRegistry.ts`

```typescript
import { RoleType, MusicianProfile, IdiomType, ContourType } from '../types';
import { AlexPopPiano } from '../personas/AlexPopPiano';
import { DaveSteadyPopDrums } from '../personas/DavePopDrums';
import { PennyPopPad } from '../personas/PennyPopPad';
import { LeoSynthLead } from '../personas/LeoSynthLead';
import { BillyBouncePiano } from '../personas/BillyBouncePiano';

export const MUSICIAN_REGISTRY: MusicianProfile[] = [
    AlexPopPiano,
    DaveSteadyPopDrums,
    PennyPopPad,
    LeoSynthLead,
    BillyBouncePiano
];

export function getMusiciansByRole(role: RoleType): MusicianProfile[] {
    return MUSICIAN_REGISTRY.filter(m => m.allowedRoles ? m.allowedRoles.includes(role) : m.role === role);
}

export function getMusicianById(id: string): MusicianProfile | undefined {
    return MUSICIAN_REGISTRY.find(m => m.id === id);
}

```

### File: `src/core/generation/manifests/StyleRegistry.ts`

```typescript
import { StyleConfig } from "../types";
import { PopStyle } from "../styles/PopStyle";
export { DefaultHarmony } from "../styles/Shared";

export const StyleRegistry: Record<string, StyleConfig> = {
    'Pop': PopStyle
};


```

### File: `src/core/generation/personas/AlexPopPiano.ts`

```typescript
import { RoleType, MusicianProfile, ContourType } from '../types';

export const AlexPopPiano: MusicianProfile = {
    id: 'accomp_alex_pop',
    name: 'Alex (Pop Piano)',
    role: RoleType.AccompInst,
    allowedRoles: [RoleType.AccompInst, RoleType.MainInst],
    styleId: 'Pop',
    instrumentId: 0,
    persona: { 
        colorBias: 0.4, 
        sparsityTendency: 0.5, 
        contourPreference: ContourType.Alternating,
        syncopationAssault: 0.3, 
        dynamicRange: [35, 100], 
        signatureLickProb: 0.15 
    },
    description: 'Solid pop piano accompaniment with moderate extensions.'
};

```

### File: `src/core/generation/personas/BillyBouncePiano.ts`

```typescript
import { MusicianProfile, RoleType, ContourType, IdiomType } from '../types';

export const BillyBouncePiano: MusicianProfile = {
    id: 'billy_bounce',
    name: 'Billy (Bounce Piano)',
    role: RoleType.AccompInst,
    styleId: 'pop_standard',
    instrumentId: 0, // Acoustic Grand Piano
    description: 'Specializes in rhythmic, bouncing "oom-pah" piano accompaniment, similar to Lemon Tree.',
    persona: {
        colorBias: 0.2, // Tends to use basic triads/7ths for stronger rhythmic feel
        sparsityTendency: 0.1, // Keeps the bounce going
        contourPreference: ContourType.Alternating,
        syncopationAssault: 0.1, // Mostly on grid for the bounce, some syncopation allowed
        dynamicRange: [60, 100],
        idiomPreference: IdiomType.BouncePiano // Explicitly route to BouncePianoIdiom
    }
};

```

### File: `src/core/generation/personas/DavePopDrums.ts`

```typescript
import { RoleType, MusicianProfile, ContourType } from '../types';

export const DaveSteadyPopDrums: MusicianProfile = {
    id: 'drums_dave_pop',
    name: 'Dave (Pop + Fills)',
    role: RoleType.Drums,
    styleId: 'Pop',
    instrumentId: 3,
    persona: { 
        colorBias: 0.1, 
        sparsityTendency: 0.5, 
        contourPreference: ContourType.Random,
        syncopationAssault: 0.25, 
        dynamicRange: [45, 105], 
        signatureLickProb: 0.15 // Moderate probability for fills
    },
    description: 'Straightforward 4/4 pop beats, with contextual fills that respect the groove. Uses snare rolls, accent shifts, and sparse toms.'
};

```

### File: `src/core/generation/personas/LeoSynthLead.ts`

```typescript
import { RoleType, MusicianProfile, ContourType } from '../types';

export const LeoSynthLead: MusicianProfile = {
    id: 'lead_leo_synth',
    name: 'Leo (Synth Lead)',
    role: RoleType.MainInst, 
    allowedRoles: [RoleType.MainInst, RoleType.AccompInst],
    styleId: 'Pop',
    instrumentId: 81, // Synth Lead (Sawtooth)
    persona: { 
        colorBias: 0.6, // Loves modern extensions
        sparsityTendency: 0.4, // Sometimes leaves space
        contourPreference: ContourType.Alternating,
        syncopationAssault: 0.7, // Rhythmic and punchy
        dynamicRange: [60, 110], // Expressive and upfront
        signatureLickProb: 0.1 
    },
    description: 'A punchy, energetic synth lead capable of soaring melodies and driving, arpeggiated accompaniment.'
};

```

### File: `src/core/generation/personas/PennyPopPad.ts`

```typescript
import { RoleType, MusicianProfile, ContourType } from '../types';

export const PennyPopPad: MusicianProfile = {
    id: 'pad_penny_pop',
    name: 'Penny (Pop Pad)',
    role: RoleType.Pad,
    styleId: 'Pop',
    instrumentId: 89, // SynthPad
    persona: { 
        colorBias: 0.8, // Loves slightly extended harmony to fill the spectrum
        sparsityTendency: 0.1, // Almost always playing
        contourPreference: ContourType.Alternating,
        syncopationAssault: 0.0, // Pads usually hold chords on the downbeat, no syncopation
        dynamicRange: [40, 80], // Even dynamics
        signatureLickProb: 0.0 
    },
    description: 'Smooth, sustained synth pads that glue the harmony together.'
};

```

### File: `src/core/generation/styles/PopStyle.ts`

```typescript
import { StyleConfig, SectionType } from '../types';
import { defaultDrumProbabilities, DefaultHarmony } from './Shared';

// A much richer set of dedicated Pop progresssions to reflect modern Pop structures, including melancholic, upbeat, and ballad colors.
export const PopHarmony = {
    major: {
        [SectionType.Intro]:   [
            ['I', 'IVmaj7', 'I', 'IVmaj7'],
            ['vi', 'IV', 'I', 'V'],
            ['I', 'V', 'vi', 'IV'], // The classic Pop Intro
            ['IVmaj7', 'III7', 'vi', 'I7'] // Slightly more colorful
        ],
        [SectionType.Verse]:   [
            ['I', 'vi', 'IV', 'V'],
            ['I', 'V', 'vi', 'IV'],
            ['I', 'IV', 'ii', 'V'],
            ['vi', 'IV', 'I', 'V'], // Gloomy/melancholic pop verse
            ['I', 'V/VII', 'vi', 'V', 'IV', 'I/III', 'ii', 'V'], // Descending bass pop ballad
            ['IVmaj7', 'I', 'IVmaj7', 'I'] // Float-y modern pop
        ],
        [SectionType.PreChorus]: [
            ['ii', 'V', 'I', 'vi'],
            ['IV', 'V', 'iii', 'vi'], // "Royal Road" setup
            ['ii', 'IV', 'vi', 'V'],  // Building tension
            ['IV', 'IV', 'V', 'V'],    // Classic build-up
            ['IVmaj7', 'V7', 'iii7', 'vi7', 'ii7', 'V7sus4', 'V7', 'V7'] // Extended build
        ],
        [SectionType.Chorus]:  [
            ['I', 'V', 'vi', 'IV'], // Universal Pop Chorus
            ['IVmaj7', 'V', 'iii', 'vi'], // Emotional / J-Pop / "Royal Road"
            ['vi', 'IV', 'I', 'V'], // Edgy/Modern pop chorus
            ['I', 'V/VII', 'vi', 'I/V', 'IV', 'I/III', 'ii', 'V'], // Anthem chorus
            ['I', 'IV', 'vi', 'V'],
            ['I', 'III7', 'vi', 'IV'] // Pop with a secondary dominant punch
        ],
        [SectionType.Outro]:   [
            ['IV', 'iv', 'I', 'I'], // Beatles-esque pop outro (borrowed minor iv)
            ['vi', 'V', 'IV', 'I'],
            ['I', 'V', 'vi', 'IV', 'I', 'I', 'I', 'I']
        ]
    },
    minor: {
        [SectionType.Intro]:   [
            ['i', 'VI', 'i', 'VI'], 
            ['i', 'v', 'VI', 'VII'],
            ['VI', 'VII', 'i', 'v']
        ],
        [SectionType.Verse]:   [
            ['i', 'VI', 'III', 'VII'], // Modern minor pop
            ['i', 'iv', 'v', 'i'],
            ['i', 'VII', 'VI', 'v'],
            ['VI', 'iv', 'i', 'v'],
            ['i', 'v', 'VI', 'III', 'iv', 'i', 'VII', 'VII'] // Storytelling minor
        ],
        [SectionType.PreChorus]: [
            ['iv', 'v', 'i', 'i'],
            ['VI', 'VII', 'i', 'i'],
            ['iv', 'VI', 'VII', 'VII'], // Rising tension
            ['VImaj7', 'VII', 'v7', 'i']
        ],
        [SectionType.Chorus]:  [
            ['VI', 'VII', 'i', 'v'],
            ['i', 'VI', 'III', 'VII'], // Huge minor chorus
            ['VI', 'VII', 'III', 'VI', 'iiø', 'V7', 'i', 'i'], // Melodramatic
            ['VI', 'iv', 'i', 'VII'],
            ['VImaj7', 'VII', 'i', 'i'] // Simple but effective modern pop
        ],
        [SectionType.Outro]:   [
            ['VI', 'iv', 'i', 'i'],
            ['i', 'v', 'i', 'i'],
            ['VI', 'VII', 'i', 'i', 'i', 'i']
        ]
    }
};

export const PopStyle: StyleConfig = {
    id: 'Pop',
    name: 'Standard Pop',
    tensionLimits: 9, // Pop usually goes up to 7ths and 9ths, rarely 11 or 13
    densityBaseline: 0.6,
    drumProbabilities: defaultDrumProbabilities,
    harmony: PopHarmony,
    passingChordProb: 0.3, // Slightly higher for more movement
    chromaticPassingProb: 0.5, // The style desires chromatic passing chords
    anticipationProb: 0.4  // Pop thrives on syncopated chord changes
};

```

### File: `src/core/generation/styles/Shared.ts`

```typescript
import { StyleConfig, SectionType } from "../types";

export const DefaultHarmony = {
    major: {
        [SectionType.Intro]:   [['I', 'IVmaj7', 'I', 'IVmaj7'], ['vi', 'IV', 'I', 'V']],
        [SectionType.Verse]:   [['I', 'vi', 'IV', 'V'], ['I', 'V', 'vi', 'IV'], ['I', 'IV', 'ii', 'V']],
        [SectionType.PreChorus]: [['ii', 'V', 'I', 'vi'], ['IV', 'V', 'iii', 'vi']],
        [SectionType.Chorus]:  [['I', 'V', 'vi', 'IV'], ['IVmaj7', 'V', 'iii', 'vi'], ['I', 'V/VII', 'vi', 'I/V', 'IV', 'I/III', 'ii', 'V']],
        [SectionType.Outro]:   [['IV', 'iv', 'I', 'I'], ['vi', 'V', 'IV', 'I']]
    },
    minor: {
        [SectionType.Intro]:   [['i', 'VI', 'i', 'VI'], ['i', 'v', 'VI', 'VII']],
        [SectionType.Verse]:   [['i', 'VI', 'III', 'VII'], ['i', 'iv', 'v', 'i'], ['i', 'VII', 'VI', 'v']],
        [SectionType.PreChorus]: [['iv', 'v', 'i', 'i'], ['VI', 'VII', 'i', 'i']],
        [SectionType.Chorus]:  [['VI', 'VII', 'i', 'v'], ['i', 'VI', 'III', 'VII'], ['VI', 'VII', 'III', 'VI', 'iiø', 'V7', 'i', 'i']],
        [SectionType.Outro]:   [['VI', 'iv', 'i', 'i'], ['i', 'v', 'i', 'i']]
    }
};

export const defaultDrumProbabilities = [
    [1.0, 0.0, 0.4, 60, 80], [0.0, 0.0, 0.3, 30, 50], [0.1, 0.0, 0.6, 40, 60], [0.0, 0.0, 0.2, 30, 50],
    [0.0, 1.0, 0.5, 70, 90], [0.0, 0.0, 0.2, 30, 50], [0.2, 0.0, 0.5, 40, 60], [0.0, 0.0, 0.3, 30, 50],
    [0.6, 0.0, 0.4, 60, 80], [0.0, 0.0, 0.3, 30, 50], [0.1, 0.0, 0.5, 40, 60], [0.0, 0.0, 0.2, 30, 50],
    [0.0, 1.0, 0.5, 70, 90], [0.0, 0.0, 0.2, 30, 50], [0.1, 0.3, 0.5, 40, 60], [0.1, 0.0, 0.3, 30, 50],
];

```

### File: `src/core/generation/theory/HarmonicSeries.ts`

```typescript
export class HarmonicSeries {
    // 0-indexed intervals from root in semitones corresponding to partials 1 through 16
    private static readonly PARTIALS_PITCH_CLASS_MAPPING = [
        0,  // 1f: Root
        0,  // 2f: Octave
        7,  // 3f: Perfect 5th
        0,  // 4f: Octave
        4,  // 5f: Major 3rd
        7,  // 6f: Perfect 5th
        10, // 7f: Harmonic 7th (approx. Minor 7th)
        0,  // 8f: Octave
        2,  // 9f: Major 2nd (9th)
        4,  // 10f: Major 3rd
        6,  // 11f: Augmented 4th (#11)
        7,  // 12f: Perfect 5th
        9,  // 13f: Major 6th (13th)
        10, // 14f: Minor 7th
        11, // 15f: Major 7th
        0   // 16f: Octave
    ];

    /**
     * Get a weight (probability / structural congruence) for each pitch class (0-11)
     * relative to a fundamental root, based on the natural harmonic series.
     * 
     * @param root The root pitch class (0-11)
     * @param colorBias 0.0 means strict adherence to lower partials (stable, skeletal). 
     *                  1.0 means boosting upper partials (jazzy, tension, complex color).
     * @returns An array of length 12 where index is pitch class and value is weight (0 to 1).
     */
    public static getPitchClassWeights(root: number, colorBias: number = 0.0): number[] {
        const weights = new Array(12).fill(0);
        
        for (let i = 0; i < this.PARTIALS_PITCH_CLASS_MAPPING.length; i++) {
            const pc = (root + this.PARTIALS_PITCH_CLASS_MAPPING[i]) % 12;
            const partialNumber = i + 1;
            
            // Base contribution decays logarithmically as the partial series goes higher
            let contribution = 1.0 / partialNumber;
            
            if (colorBias > 0) {
                if (partialNumber >= 7) {
                    // Amplify higher partials based on colorBias
                    // e.g., generating more tension and modern "haze"
                    contribution *= (1.0 + (colorBias * partialNumber * 0.8)); 
                } else {
                    // Slightly suppress the stability of lower partials to reduce "vanilla" sound
                    contribution *= Math.max(0.2, 1.0 - (colorBias * 0.6));
                }
            }

            // Accumulate weights (as multiple partials can map to the same pitch class, e.g., root, 5th)
            weights[pc] += contribution;
        }

        // Normalize weights to 0.0 - 1.0 range
        const maxW = Math.max(...weights);
        if (maxW > 0) {
            for (let i = 0; i < 12; i++) {
                weights[i] /= maxW;
            }
        }
        
        return weights;
    }
    
    /**
     * Evaluates a pitch class against a chord's root using Harmonic Series weights.
     * High values mean it's structurally consonant (or perfectly matches the desired color tension).
     */
    public static scorePitchClass(pc: number, root: number, colorBias: number = 0.0): number {
        const weights = this.getPitchClassWeights(root, colorBias);
        return weights[pc];
    }
}

```

### File: `src/core/generation/theory/MusicTheory.ts`

```typescript
export enum Tonality {
    Major = 0, Minor = 1, Major_Pentatonic = 2, Minor_Pentatonic = 3,
    Blues = 4, Dorian = 5, Mixolydian = 6, Melodic_Minor = 7, Lydian = 8,
    Harmonic_Minor = 9, Phrygian = 10
}

export const TonalityName: string[] = [];
TonalityName[Tonality.Major] = 'Major';
TonalityName[Tonality.Minor] = 'Minor';
TonalityName[Tonality.Major_Pentatonic] = 'Major_Pentatonic';
TonalityName[Tonality.Minor_Pentatonic] = 'Minor_Pentatonic';
TonalityName[Tonality.Blues] = 'Blues';
TonalityName[Tonality.Dorian] = 'Dorian';
TonalityName[Tonality.Mixolydian] = 'Mixolydian';
TonalityName[Tonality.Melodic_Minor] = 'Melodic_Minor';
TonalityName[Tonality.Lydian] = 'Lydian';
TonalityName[Tonality.Harmonic_Minor] = 'Harmonic_Minor';
TonalityName[Tonality.Phrygian] = 'Phrygian';

export const SCALE_INTERVALS: number[][] = [];
SCALE_INTERVALS[Tonality.Major]            = [0, 2, 4, 5, 7, 9, 11];
SCALE_INTERVALS[Tonality.Minor]            = [0, 2, 3, 5, 7, 8, 10];
SCALE_INTERVALS[Tonality.Major_Pentatonic] = [0, 2, 4, 7, 9];
SCALE_INTERVALS[Tonality.Minor_Pentatonic] = [0, 3, 5, 7, 10];
SCALE_INTERVALS[Tonality.Blues]            = [0, 3, 5, 6, 7, 10];
SCALE_INTERVALS[Tonality.Dorian]           = [0, 2, 3, 5, 7, 9, 10];
SCALE_INTERVALS[Tonality.Mixolydian]       = [0, 2, 4, 5, 7, 9, 10];
SCALE_INTERVALS[Tonality.Melodic_Minor]    = [0, 2, 3, 5, 7, 9, 11];
SCALE_INTERVALS[Tonality.Lydian]           = [0, 2, 4, 6, 7, 9, 11];
SCALE_INTERVALS[Tonality.Harmonic_Minor]   = [0, 2, 3, 5, 7, 8, 11];
SCALE_INTERVALS[Tonality.Phrygian]         = [0, 1, 3, 5, 7, 8, 10];

export enum ChordQualityEnum {
    Major = 0, Minor = 1, Diminished = 2, Diminished7 = 3, Augmented = 4,
    Dominant7 = 5, Minor7 = 6, Major7 = 7, HalfDiminished = 8,
    Sus4 = 9, Dominant7Sus4 = 10, Add9 = 11, Minor9 = 12, Major9 = 13,
    Dominant9 = 14, Minor11 = 15, Dominant13 = 16, Sus2 = 17,
    Dominant7b9 = 18, 
    Dominant7Sharp9 = 19, 
    Major7Sharp11 = 20, 
    Dominant7b13 = 21, 
    Altered = 22,
    Minor6 = 23
}

export const CHORD_INTERVALS: number[][] = [];
CHORD_INTERVALS[ChordQualityEnum.Major]          = [0, 4, 7];
CHORD_INTERVALS[ChordQualityEnum.Minor]          = [0, 3, 7];
CHORD_INTERVALS[ChordQualityEnum.Diminished]     = [0, 3, 6];
CHORD_INTERVALS[ChordQualityEnum.Diminished7]    = [0, 3, 6, 9];
CHORD_INTERVALS[ChordQualityEnum.Augmented]      = [0, 4, 8];
CHORD_INTERVALS[ChordQualityEnum.Dominant7]      = [0, 4, 7, 10];
CHORD_INTERVALS[ChordQualityEnum.Minor7]         = [0, 3, 7, 10];
CHORD_INTERVALS[ChordQualityEnum.Major7]         = [0, 4, 7, 11];
CHORD_INTERVALS[ChordQualityEnum.HalfDiminished] = [0, 3, 6, 10];
CHORD_INTERVALS[ChordQualityEnum.Sus4]           = [0, 5, 7];
CHORD_INTERVALS[ChordQualityEnum.Dominant7Sus4]  = [0, 5, 7, 10];
CHORD_INTERVALS[ChordQualityEnum.Add9]           = [0, 4, 7, 14];
CHORD_INTERVALS[ChordQualityEnum.Minor9]         = [0, 3, 7, 10, 14];
CHORD_INTERVALS[ChordQualityEnum.Major9]         = [0, 4, 7, 11, 14];
CHORD_INTERVALS[ChordQualityEnum.Dominant9]      = [0, 4, 7, 10, 14];
CHORD_INTERVALS[ChordQualityEnum.Minor11]        = [0, 3, 7, 10, 14, 17];
CHORD_INTERVALS[ChordQualityEnum.Dominant13]     = [0, 4, 7, 10, 14, 21];
CHORD_INTERVALS[ChordQualityEnum.Sus2]           = [0, 2, 7];
CHORD_INTERVALS[ChordQualityEnum.Dominant7b9]     = [0, 4, 7, 10, 13];
CHORD_INTERVALS[ChordQualityEnum.Dominant7Sharp9] = [0, 4, 7, 10, 15];
CHORD_INTERVALS[ChordQualityEnum.Major7Sharp11]   = [0, 4, 7, 11, 18];
CHORD_INTERVALS[ChordQualityEnum.Dominant7b13]    = [0, 4, 7, 10, 20];
CHORD_INTERVALS[ChordQualityEnum.Altered]         = [0, 4, 10, 13, 15, 20];
CHORD_INTERVALS[ChordQualityEnum.Minor6]          = [0, 3, 7, 9];

const NUMERAL_REGEX = /^([b#]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(maj7#11|maj9|maj7|m7b5|m11|m9|m7|m6|dim7|dim|aug|add9|7sus4|sus4|13|11|7b9|7#9|7b13|alt|9|7|ø|\+|m)?(?:\/([b#]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i))?$/;

export class MusicTheory {
    public static calculateChordMetrics(intervals: number[]): { tension: number, temperature: number } {
        let tension = 0;
        let temperature = 0;
        
        // Temperature weights based on interval relative to root (0)
        // Adjust these to match the video's feeling of "warm" (bright) vs "cold" (dark)
        const tempMap: Record<number, number> = {
            0: 0,
            1: -5, // b9 (very cold)
            2: 2,  // 9 (warm)
            3: -4, // m3 (cold)
            4: 4,  // M3 (warm)
            5: -1, // 11 (slightly cold)
            6: -2, // #11 (dark/tense)
            7: 1,  // P5 (neutral warm)
            8: -3, // b13 (cold)
            9: 3,  // 13 / M6 (warm)
            10: -2,// m7 (cool)
            11: 5  // M7 (very warm)
        };

        const uniqueIntervals = Array.from(new Set(intervals.map(i => i % 12)));

        uniqueIntervals.forEach(interval => {
            temperature += tempMap[interval] || 0;
        });

        // Tension is based on pairwise dissonances
        for (let i = 0; i < uniqueIntervals.length; i++) {
            for (let j = i + 1; j < uniqueIntervals.length; j++) {
                const diff = Math.abs(uniqueIntervals[i] - uniqueIntervals[j]);
                const intervalClass = Math.min(diff, 12 - diff);
                
                if (intervalClass === 6) tension += 3.0; // Tritone
                else if (intervalClass === 1) tension += 2.0; // Minor second / Major seventh
                else if (intervalClass === 2) tension += 0.5; // Major second / Minor seventh
            }
        }

        return { tension, temperature };
    }

    public static getScalePitches(tonality: Tonality): number[] {
        return SCALE_INTERVALS[tonality];
    }

    public static getLocalScalePitches(chordRoot: number, quality: ChordQualityEnum, globalTonality?: Tonality): number[] {
        let globalScale = [0, 2, 4, 5, 7, 9, 11]; // default major
        if (globalTonality !== undefined) {
             globalScale = MusicTheory.getScalePitches(globalTonality);
        }

        const chordTones = MusicTheory.getChordTones(quality).map(i => (chordRoot + i) % 12);
        let localScale = [...globalScale];

        for (const ct of chordTones) {
            if (localScale.includes(ct)) continue;

            const intervalFromRoot = (ct - chordRoot + 12) % 12;

            // Find all notes in global scale that are 1 semitone away from our chord tone
            const neighbors = localScale.filter(g => {
                const diff = Math.abs(g - ct);
                const d = Math.min(diff, 12 - diff);
                return d === 1;
            });

            for (const n of neighbors) {
                const neighborInterval = (n - chordRoot + 12) % 12;
                
                let shouldReplace = false;
                // If it's a 3rd conflict (minor vs major 3rd)
                if ((intervalFromRoot === 3 || intervalFromRoot === 4) && (neighborInterval === 3 || neighborInterval === 4)) {
                    shouldReplace = true;
                }
                // If it's a 7th conflict (minor vs major 7th)
                else if ((intervalFromRoot === 10 || intervalFromRoot === 11) && (neighborInterval === 10 || neighborInterval === 11)) {
                    shouldReplace = true;
                }
                // If it's a 5th conflict (perfect vs diminished/augmented)
                else if ((intervalFromRoot === 6 || intervalFromRoot === 7 || intervalFromRoot === 8) && (neighborInterval === 6 || neighborInterval === 7 || neighborInterval === 8)) {
                    // Be careful not to replace the 4th (5) or 6th (9) unless they are strictly functioning as an altered 5th.
                    // But 6 and 8 are explicitly augmented 4th / minor 6th in isolation. 
                    // Let's just say if the neighbor is exactly 7 (perfect fifth) we replace it, or if interval is 7 and neighbor is 6/8 we replace it.
                    if (intervalFromRoot === 7 || neighborInterval === 7) {
                        shouldReplace = true;
                    }
                }
                // Check flat 9 vs natural 9
                else if ((intervalFromRoot === 1 || intervalFromRoot === 2) && (neighborInterval === 1 || neighborInterval === 2)) {
                    shouldReplace = true;
                }

                if (shouldReplace) {
                    localScale = localScale.filter(x => x !== n);
                }
            }
        }

        const finalSet = new Set([...localScale, ...chordTones]);
        return Array.from(finalSet).sort((a, b) => a - b);
    }

    public static getChordTones(quality: ChordQualityEnum): number[] {
        return CHORD_INTERVALS[quality];
    }

    public static snapToScale(pitch: number, tonality: Tonality): number {
        const scale = SCALE_INTERVALS[tonality];
        if (!scale || scale.length === 0) return pitch;
        
        return this.snapToPool(pitch, scale);
    }

    public static snapToPool(pitch: number, poolPcs: number[]): number {
        if (poolPcs.length === 0) return pitch;

        // Ensure pool contains only normalized pitch classes 0-11 
        const normalizedPool = Array.from(new Set(poolPcs.map(p => ((p % 12) + 12) % 12)));

        const pc = ((pitch % 12) + 12) % 12;
        const octave = Math.floor(pitch / 12); // Works with positive/negative

        let bestPc = normalizedPool[0];
        let firstDiff = Math.abs(pc - normalizedPool[0]);
        let bestDist = Math.min(firstDiff, 12 - firstDiff);
        
        for (let i = 1; i < normalizedPool.length; i++) {
            const diff = Math.abs(pc - normalizedPool[i]);
            const d = Math.min(diff, 12 - diff);
            if (d < bestDist) {
                bestDist = d;
                bestPc = normalizedPool[i];
            }
        }

        const cand0 = bestPc + (octave - 1) * 12;
        const cand1 = bestPc + octave * 12;
        const cand2 = bestPc + (octave + 1) * 12;

        let best = cand0;
        let bestAbs = Math.abs(pitch - cand0);

        const d1 = Math.abs(pitch - cand1);
        if (d1 < bestAbs) { bestAbs = d1; best = cand1; }

        const d2 = Math.abs(pitch - cand2);
        if (d2 < bestAbs) { bestAbs = d2; best = cand2; }

        return best;
    }

    public static getSmoothVoicing(
        chordPcs: number[],
        prevVoicing: number[],
        targetCenter: number
    ): number[] {
        const result: number[] = [];
        let center = targetCenter;

        if (prevVoicing && prevVoicing.length > 0) {
            let sum = 0;
            for (let i = 0; i < prevVoicing.length; i++) sum += prevVoicing[i];
            center = sum / prevVoicing.length;
        }

        for (let i = 0; i < chordPcs.length; i++) {
            result.push(this.snapToPool(center, [chordPcs[i]]));
        }
        result.sort((a, b) => a - b);

        if (result.length >= 4) {
            let hasCluster = true;
            let iterations = 0;
            while (hasCluster && iterations < 5) {
                hasCluster = false;
                for (let i = 1; i < result.length; i++) {
                    if (result[i] - result[i - 1] <= 2) {
                        result[i] += 12;
                        hasCluster = true;
                        break;
                    }
                }
                if (hasCluster) result.sort((a, b) => a - b);
                iterations++;
            }
        }

        return result;
    }

    public static getDrop2Voicing(voicing: number[]): number[] {
        if (voicing.length < 4) return voicing;
        const result = [...voicing];
        result.sort((a, b) => a - b);
        const dropIdx = result.length - 2;
        result[dropIdx] -= 12;
        result.sort((a, b) => a - b);
        return result;
    }

    public static parseNumeral(numeral: string, tonality?: Tonality): { root: number; quality: ChordQualityEnum; bassOverride?: number } {
        const m = numeral.match(NUMERAL_REGEX);
        if (!m) return { root: 0, quality: ChordQualityEnum.Major };

        const accidental = m[1] ?? '';
        const roman = m[2];
        const suffix = (m[3] ?? '').toLowerCase();
        const upperRoman = roman.toUpperCase();
        const isMinorStr = roman === roman.toLowerCase();

        let root = 0;
        if (upperRoman === 'I')        root = 0;
        else if (upperRoman === 'II')  root = 2;
        else if (upperRoman === 'III') root = 4;
        else if (upperRoman === 'IV')  root = 5;
        else if (upperRoman === 'V')   root = 7;
        else if (upperRoman === 'VI')  root = 9;
        else if (upperRoman === 'VII') root = 11;

        let offset = 0;
        if (accidental === 'b') offset = -1;
        else if (accidental === '#') offset = 1;
        let targetRoot = (root + offset + 12) % 12;

        let quality = isMinorStr ? ChordQualityEnum.Minor : ChordQualityEnum.Major;

        const isMinorTonality =
            tonality !== undefined &&
            (tonality === Tonality.Minor ||
                tonality === Tonality.Minor_Pentatonic ||
                tonality === Tonality.Melodic_Minor ||
                tonality === Tonality.Harmonic_Minor ||
                tonality === Tonality.Phrygian ||
                tonality === Tonality.Dorian ||
                tonality === Tonality.Blues);
                
        if (isMinorTonality && accidental === '') {
            if (upperRoman === 'I')        { quality = ChordQualityEnum.Minor; }
            else if (upperRoman === 'II')  { quality = ChordQualityEnum.Diminished; }
            else if (upperRoman === 'III') { targetRoot = 3; quality = ChordQualityEnum.Major; }
            else if (upperRoman === 'IV')  { quality = ChordQualityEnum.Minor; }
            else if (upperRoman === 'V')   { quality = ChordQualityEnum.Minor; }
            else if (upperRoman === 'VI')  { targetRoot = 8; quality = ChordQualityEnum.Major; }
            else if (upperRoman === 'VII') { targetRoot = 10; quality = ChordQualityEnum.Major; }
        }

        if (suffix.length > 0) {
            if (suffix === 'ø' || suffix === 'm7b5') quality = ChordQualityEnum.HalfDiminished;
            else if (suffix === 'dim7') quality = ChordQualityEnum.Diminished7;
            else if (suffix === 'dim')  quality = ChordQualityEnum.Diminished;
            else if (suffix === 'aug' || suffix === '+') quality = ChordQualityEnum.Augmented;
            else if (suffix === 'maj9') quality = ChordQualityEnum.Major9;
            else if (suffix === 'maj7') quality = ChordQualityEnum.Major7;
            else if (suffix === 'm11')  quality = ChordQualityEnum.Minor11;
            else if (suffix === 'm9')   quality = ChordQualityEnum.Minor9;
            else if (suffix === 'm7')   quality = ChordQualityEnum.Minor7;
            else if (suffix === 'm')    quality = ChordQualityEnum.Minor;
            else if (suffix === 'm6') quality = ChordQualityEnum.Minor6;
            else if (suffix === 'maj7#11') quality = ChordQualityEnum.Major7Sharp11;
            else if (suffix === '7b9') quality = ChordQualityEnum.Dominant7b9;
            else if (suffix === '7#9') quality = ChordQualityEnum.Dominant7Sharp9;
            else if (suffix === '7b13') quality = ChordQualityEnum.Dominant7b13;
            else if (suffix === 'alt') quality = ChordQualityEnum.Altered;
            else if (suffix === 'add9') quality = ChordQualityEnum.Add9;
            else if (suffix === '7sus4') quality = ChordQualityEnum.Dominant7Sus4;
            else if (suffix === 'sus4') quality = ChordQualityEnum.Sus4;
            else if (suffix === '13')   quality = ChordQualityEnum.Dominant13;
            else if (suffix === '11')   quality = ChordQualityEnum.Minor11;
            else if (suffix === '9') {
                quality = isMinorStr ? ChordQualityEnum.Minor9 : ChordQualityEnum.Dominant9;
            }
            else if (suffix === '7') {
                if (quality === ChordQualityEnum.Major) quality = ChordQualityEnum.Dominant7;
                else if (quality === ChordQualityEnum.Minor) quality = ChordQualityEnum.Minor7;
                else if (quality === ChordQualityEnum.Diminished) quality = ChordQualityEnum.Diminished7;
            }
        }

        let bassOverride: number | undefined = undefined;
        if (m[5]) {
            const bassAcc = m[4] ?? '';
            const bassRoman = m[5].toUpperCase();
            let bRoot = 0;
            if (bassRoman === 'I')        bRoot = 0;
            else if (bassRoman === 'II')  bRoot = 2;
            else if (bassRoman === 'III') bRoot = 4;
            else if (bassRoman === 'IV')  bRoot = 5;
            else if (bassRoman === 'V')   bRoot = 7;
            else if (bassRoman === 'VI')  bRoot = 9;
            else if (bassRoman === 'VII') bRoot = 11;

            let bOffset = 0;
            if (bassAcc === 'b') bOffset = -1;
            else if (bassAcc === '#') bOffset = 1;

            if (isMinorTonality && bassAcc === '') {
                if (bassRoman === 'III') bRoot = 3;
                else if (bassRoman === 'VI') bRoot = 8;
                else if (bassRoman === 'VII') bRoot = 10;
            }
            bassOverride = (bRoot + bOffset + 12) % 12;
        }

        return { root: targetRoot, quality, ...(bassOverride !== undefined ? { bassOverride } : {}) };
    }
}

```

### File: `src/core/generation/types.ts`

```typescript
export interface NoteData { pitch: number; onset: number; duration: number; velocity: number; isGraceNote?: boolean; isUserMotif?: boolean; }
export interface GeneratedChord { numeral: string; root: number; quality: any; startBeat: number; endBeat: number; keyOffset?: number; bassOverride?: number; }
export enum SectionType { Intro = 'intro', Verse = 'verse', PreChorus = 'preChorus', Chorus = 'chorus', Bridge = 'bridge', Outro = 'outro' }
export interface SectionMetadata { name: string; startBeat: number; endBeat: number; energyLevel: number; type?: SectionType; numBars?: any; }

export enum MusicalRole {
    Lead = 'lead',
    Accomp = 'accomp',
    Bass = 'bass',
    Percussion = 'percussion',
    CounterMelody = 'counterMelody'
}

export interface ToneAllocation {
    pitchClass: number; // 0-11
    role: MusicalRole;
    isEssential: boolean; // e.g., root, 3rd, 7th
    isTension: boolean; // e.g., 9, 11, 13
}

export interface GlobalHarmonicFrame {
    startBeat: number;
    endBeat: number;
    chord: GeneratedChord;
    toneAllocations: ToneAllocation[]; // How the chord tones are distributed among roles
    pitchScale: number[]; // The available scale degrees over this chord (0-11)
}

export interface InstrumentConfig {
    id: number;
    name: string;
    minPitch: number;
    maxPitch: number;
    maxPolyphony: number;
    antiMudThreshold: number; // Pitch threshold below which intervals > minor 3rd are needed
    supportsPitchBend: boolean;
    supportsSlide: boolean;
    isMonophonic: boolean;
    supportsSustainPedal?: boolean;
    isElectronic?: boolean;
    capabilities: MusicalRole[];
}

export enum Tonality { Major = 0, Minor = 1 }
export const TonalityName: string[] = ['Major', 'Minor'];
export const SCALE_INTERVALS: number[][] = [];
SCALE_INTERVALS[Tonality.Major] = [0, 2, 4, 5, 7, 9, 11];
SCALE_INTERVALS[Tonality.Minor] = [0, 2, 3, 5, 7, 8, 10];

export enum ChordQuality { Major = 0, Minor = 1, Diminished = 2, Diminished7 = 3, Augmented = 4, Dominant7 = 5, Minor7 = 6, Major7 = 7, HalfDiminished = 8, Sus4 = 9, Dominant7Sus4 = 10, Add9 = 11, Minor9 = 12, Major9 = 13, Dominant9 = 14, Minor11 = 15, Dominant13 = 16 }

// Bitmask enum to replace string parsing for high-performance C++ portability and T-S-D Grammar routing
export enum HarmonicFunction {
    None = 0,
    Tonic = 1 << 0,             // T (Stable)
    Subdominant = 1 << 1,       // S (Wandering/Departure)
    Dominant = 1 << 2,          // D (Tension/Leading)
    SecondaryDominant = 1 << 3, // DD (Out-of-key tension)
    TonicMinor = 1 << 4,        // t 
    SubdominantMinor = 1 << 5,  // s (Modal Interchange flavor)
    DominantMinor = 1 << 6      // d
}

// Flat structure guaranteeing C++ compatibility for the static dictionary
export interface ChordData {
    root: number;        // PitchClass 0-11
    quality: ChordQuality;
    inversion: number;
    functions: number;   // Bitmask of HarmonicFunction
    tension: number;     // Mathematical tension 0-10
    temperature: number; // Emotional color (-10 dark to +10 bright)
    pitches: number[];   // Relative physical semi-tones offset
}


export enum ContourType { Upward = 0, Downward = 1, Alternating = 2, Random = 3 }
export enum LHRole { Anchor = 0, Stride = 1, Comp = 2, Arp = 3, Walking = 4 }
export enum RHRole { Block = 0, Arp = 1, Linear = 2, Sparse = 3, Comp = 4 }

export interface PianoMotifDNA {
    voicingPreference: number; // 0 = close, 1 = wide
    rhythmicAnchor: number; // 0 = on-beat, 1 = syncopated
    contour: ContourType;
    densityBaseline: number; // 0.0 to 1.0, where 0 is sparse, 1 is busy
    lhRole: LHRole;
    rhRole: RHRole;
    interlock: number; // 0 = hands together, 1 = independent/hocket
}

export interface GrooveDNA { anchors: number[]; density: number; intensity: number; pianoMotifDNA?: PianoMotifDNA; }

export type HarmonyProgressionPool = Record<string, string[][]>;
export interface StyleHarmonyConfig { major: HarmonyProgressionPool; minor: HarmonyProgressionPool; }

export interface StyleConfig { 
    id?: string;
    name?: string;
    tensionLimits?: number; // Maximum chord extension allowed (e.g. 7 for pop, 13 for jazz)
    drumProbabilities: number[][]; 
    passingChordProb?: number; 
    chromaticPassingProb?: number; 
    anticipationProb?: number; 
    densityBaseline?: number; // overall crowdedness
    harmony: StyleHarmonyConfig;
    swingRatio?: number;
}
export enum RoleType {
    Vocal = 'vocal',
    MainInst = 'mainInst',
    AccompInst = 'accompInst',
    Pad = 'pad',
    Bass = 'bass',
    Drums = 'drums'
}

export enum IdiomType {
    PopPiano = 0,
    GenericPiano = 4,
    PopPad = 5,
    BouncePiano = 6
}

export interface MusicianPersona {
    colorBias: number;      // 0.0 (Triad) to 1.0 (High extensions) - intercepts tension
    sparsityTendency: number; // 0.0 (busy/always play) to 1.0 (sparse/lots of rests)
    contourPreference: ContourType;
    syncopationAssault: number; // 0.0 to 1.0 (On-beat to Syncopated)
    dynamicRange: [number, number]; // e.g. [40, 110]
    signatureLickProb?: number; // Probability of overriding the base idiom (e.g. 0.2 for 20%)
    lickPool?: any[];       // Placeholder for actual specialized motifs
    idiomPreference?: IdiomType; // Dynamically switch to a specific generation idiom
}

export interface MusicianProfile {
    id: string;
    name: string;
    role: RoleType; // primary role
    allowedRoles?: RoleType[]; // explicit list of roles this musician can play
    styleId: string; // The musician's native style (used for persona signature licks)
    instrumentId: number;
    persona: MusicianPersona;
    description: string;
}

export interface BandMusician {
    id: string; // Add id to refer back
    role: RoleType;
    styleId: string;
    instrumentId: number;
    persona: MusicianPersona;
}

export enum VibeType {
    Standard = 'standard',
    Chill = 'chill',
    Energetic = 'energetic'
}

export interface MusicContext {
    keyOffset: number; tonality: Tonality; bpm: number; timeSignature: [number, number];
    sections: SectionMetadata[];
    vibe?: VibeType;
    globalStyleId?: string; // Add global style reference
    style?: StyleConfig;
    band?: BandMusician[];
    swingRatio?: number;
    melody?: NoteData[];
    harmonicFrames?: GlobalHarmonicFrame[];
    seed?: number;
    grooveDNA?: GrooveDNA;
}
export interface GeneratedTrack {
    chords: GeneratedChord[]; harmonicFrames: GlobalHarmonicFrame[]; melody: NoteData[];
    bpm: number; key: string; keyOffset: number; tonality: Tonality; timeSignature: [number, number]; sections: SectionMetadata[];
    absoluteStartBeat: number; hasIntro: boolean;
    grooveDNA?: GrooveDNA;
    drums?: NoteData[];
}
export interface ArrangedTrack {
    bpm: number; key: string; absoluteStartBeat: number; timeSignature?: [number, number];
    melody: NoteData[]; pianoLH: NoteData[]; pianoRH: NoteData[]; pad?: NoteData[];
    chords?: GeneratedChord[]; sections?: SectionMetadata[]; palette?: any;
    drums?: NoteData[]; counterMelody?: NoteData[]; secondaryMelody?: NoteData[]; vocal?: NoteData[]; userMotif?: NoteData[]; tempoCurves?: any[];
}
export enum InstrumentType { PIANO_1 = 0, PIANO_2 = 1, BASS = 2, DRUMS = 3 }

```

### File: `src/core/utils/PRNG.ts`

```typescript
export type PRNGSnapshotKey = 'A' | 'B' | 'C' | 'D';
export class PRNG {
    private state: number;
    private lastSeed: number = 0;
    private snapshots: any = {};
    constructor(seed: number) { this.state = seed; this.lastSeed = seed >>> 0; }
    public next(): number {
        this.state = (this.state * 1664525 + 1013904223) % 4294967296;
        return this.state / 4294967296;
    }
    public nextInt(min: number, max: number): number { return Math.floor(this.next() * (max - min + 1)) + min; }
    public nextFloat(min: number, max: number): number { return this.next() * (max - min) + min; }
    public setSeed(seed: number): void { this.state = seed; this.lastSeed = seed >>> 0; this.snapshots = {}; }
    public getInitialSeed(): number { return this.lastSeed; }
    public getState(): number { return this.state; }
    public setState(state: number): void { this.state = state; }
    public recordSnapshot(key: PRNGSnapshotKey): void { this.snapshots[key] = this.state; }
}
export const PRNGManager = new PRNG(0);

```

### File: `src/main.tsx`

```typescript
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

```

### File: `src/utils/GMInstruments.ts`

```typescript
export const GMInstruments = [
    { id: 0, name: 'Acoustic Grand Piano', category: 'Piano' },
    { id: 1, name: 'Bright Acoustic Piano', category: 'Piano' },
    { id: 2, name: 'Electric Grand Piano', category: 'Piano' },
    { id: 3, name: 'Honky-tonk Piano', category: 'Piano' },
    { id: 4, name: 'Electric Piano 1', category: 'Piano' },
    { id: 5, name: 'Electric Piano 2', category: 'Piano' },
    { id: 6, name: 'Harpsichord', category: 'Piano' },
    { id: 7, name: 'Clavi', category: 'Piano' },
    
    { id: 8, name: 'Celesta', category: 'Chromatic Percussion' },
    { id: 9, name: 'Glockenspiel', category: 'Chromatic Percussion' },
    { id: 10, name: 'Music Box', category: 'Chromatic Percussion' },
    { id: 11, name: 'Vibraphone', category: 'Chromatic Percussion' },
    { id: 12, name: 'Marimba', category: 'Chromatic Percussion' },
    { id: 13, name: 'Xylophone', category: 'Chromatic Percussion' },
    { id: 14, name: 'Tubular Bells', category: 'Chromatic Percussion' },
    { id: 15, name: 'Dulcimer', category: 'Chromatic Percussion' },
    
    { id: 16, name: 'Drawbar Organ', category: 'Organ' },
    { id: 17, name: 'Percussive Organ', category: 'Organ' },
    { id: 18, name: 'Rock Organ', category: 'Organ' },
    { id: 19, name: 'Church Organ', category: 'Organ' },
    { id: 20, name: 'Reed Organ', category: 'Organ' },
    { id: 21, name: 'Accordion', category: 'Organ' },
    { id: 22, name: 'Harmonica', category: 'Organ' },
    { id: 23, name: 'Tango Accordion', category: 'Organ' },
    
    { id: 24, name: 'Acoustic Guitar (nylon)', category: 'Guitar' },
    { id: 25, name: 'Acoustic Guitar (steel)', category: 'Guitar' },
    { id: 26, name: 'Electric Guitar (jazz)', category: 'Guitar' },
    { id: 27, name: 'Electric Guitar (clean)', category: 'Guitar' },
    { id: 28, name: 'Electric Guitar (muted)', category: 'Guitar' },
    { id: 29, name: 'Overdriven Guitar', category: 'Guitar' },
    { id: 30, name: 'Distortion Guitar', category: 'Guitar' },
    { id: 31, name: 'Guitar harmonics', category: 'Guitar' },
    
    { id: 32, name: 'Acoustic Bass', category: 'Bass' },
    { id: 33, name: 'Electric Bass (finger)', category: 'Bass' },
    { id: 34, name: 'Electric Bass (pick)', category: 'Bass' },
    { id: 35, name: 'Fretless Bass', category: 'Bass' },
    { id: 36, name: 'Slap Bass 1', category: 'Bass' },
    { id: 37, name: 'Slap Bass 2', category: 'Bass' },
    { id: 38, name: 'Synth Bass 1', category: 'Bass' },
    { id: 39, name: 'Synth Bass 2', category: 'Bass' },
    
    { id: 40, name: 'Violin', category: 'Strings' },
    { id: 41, name: 'Viola', category: 'Strings' },
    { id: 42, name: 'Cello', category: 'Strings' },
    { id: 43, name: 'Contrabass', category: 'Strings' },
    { id: 44, name: 'Tremolo Strings', category: 'Strings' },
    { id: 45, name: 'Pizzicato Strings', category: 'Strings' },
    { id: 46, name: 'Orchestral Harp', category: 'Strings' },
    { id: 47, name: 'Timpani', category: 'Strings' },
    
    { id: 48, name: 'String Ensemble 1', category: 'Ensemble' },
    { id: 49, name: 'String Ensemble 2', category: 'Ensemble' },
    { id: 50, name: 'SynthStrings 1', category: 'Ensemble' },
    { id: 51, name: 'SynthStrings 2', category: 'Ensemble' },
    { id: 52, name: 'Choir Aahs', category: 'Ensemble' },
    { id: 53, name: 'Voice Oohs', category: 'Ensemble' },
    { id: 54, name: 'Synth Voice', category: 'Ensemble' },
    { id: 55, name: 'Orchestral Hit', category: 'Ensemble' },
    
    { id: 56, name: 'Trumpet', category: 'Brass' },
    { id: 57, name: 'Trombone', category: 'Brass' },
    { id: 58, name: 'Tuba', category: 'Brass' },
    { id: 59, name: 'Muted Trumpet', category: 'Brass' },
    { id: 60, name: 'French Horn', category: 'Brass' },
    { id: 61, name: 'Brass Section', category: 'Brass' },
    { id: 62, name: 'SynthBrass 1', category: 'Brass' },
    { id: 63, name: 'SynthBrass 2', category: 'Brass' },
    
    { id: 64, name: 'Soprano Sax', category: 'Reed' },
    { id: 65, name: 'Alto Sax', category: 'Reed' },
    { id: 66, name: 'Tenor Sax', category: 'Reed' },
    { id: 67, name: 'Baritone Sax', category: 'Reed' },
    { id: 68, name: 'Oboe', category: 'Reed' },
    { id: 69, name: 'English Horn', category: 'Reed' },
    { id: 70, name: 'Bassoon', category: 'Reed' },
    { id: 71, name: 'Clarinet', category: 'Reed' },
    
    { id: 72, name: 'Piccolo', category: 'Pipe' },
    { id: 73, name: 'Flute', category: 'Pipe' },
    { id: 74, name: 'Recorder', category: 'Pipe' },
    { id: 75, name: 'Pan Flute', category: 'Pipe' },
    { id: 76, name: 'Blown Bottle', category: 'Pipe' },
    { id: 77, name: 'Shakuhachi', category: 'Pipe' },
    { id: 78, name: 'Whistle', category: 'Pipe' },
    { id: 79, name: 'Ocarina', category: 'Pipe' },
    
    { id: 80, name: 'Lead 1 (square)', category: 'Synth Lead' },
    { id: 81, name: 'Lead 2 (sawtooth)', category: 'Synth Lead' },
    { id: 82, name: 'Lead 3 (calliope)', category: 'Synth Lead' },
    { id: 83, name: 'Lead 4 (chiff)', category: 'Synth Lead' },
    { id: 84, name: 'Lead 5 (charang)', category: 'Synth Lead' },
    { id: 85, name: 'Lead 6 (voice)', category: 'Synth Lead' },
    { id: 86, name: 'Lead 7 (fifths)', category: 'Synth Lead' },
    { id: 87, name: 'Lead 8 (bass + lead)', category: 'Synth Lead' },
    
    { id: 88, name: 'Pad 1 (new age)', category: 'Synth Pad' },
    { id: 89, name: 'Pad 2 (warm)', category: 'Synth Pad' },
    { id: 90, name: 'Pad 3 (polysynth)', category: 'Synth Pad' },
    { id: 91, name: 'Pad 4 (choir)', category: 'Synth Pad' },
    { id: 92, name: 'Pad 5 (bowed)', category: 'Synth Pad' },
    { id: 93, name: 'Pad 6 (metallic)', category: 'Synth Pad' },
    { id: 94, name: 'Pad 7 (halo)', category: 'Synth Pad' },
    { id: 95, name: 'Pad 8 (sweep)', category: 'Synth Pad' },
    
    { id: 96, name: 'FX 1 (rain)', category: 'Synth Effects' },
    { id: 97, name: 'FX 2 (soundtrack)', category: 'Synth Effects' },
    { id: 98, name: 'FX 3 (crystal)', category: 'Synth Effects' },
    { id: 99, name: 'FX 4 (atmosphere)', category: 'Synth Effects' },
    { id: 100, name: 'FX 5 (brightness)', category: 'Synth Effects' },
    { id: 101, name: 'FX 6 (goblins)', category: 'Synth Effects' },
    { id: 102, name: 'FX 7 (echoes)', category: 'Synth Effects' },
    { id: 103, name: 'FX 8 (sci-fi)', category: 'Synth Effects' },
    
    { id: 104, name: 'Sitar', category: 'Ethnic' },
    { id: 105, name: 'Banjo', category: 'Ethnic' },
    { id: 106, name: 'Shamisen', category: 'Ethnic' },
    { id: 107, name: 'Koto', category: 'Ethnic' },
    { id: 108, name: 'Kalimba', category: 'Ethnic' },
    { id: 109, name: 'Bag pipe', category: 'Ethnic' },
    { id: 110, name: 'Fiddle', category: 'Ethnic' },
    { id: 111, name: 'Shanai', category: 'Ethnic' },
    
    { id: 112, name: 'Tinkle Bell', category: 'Percussion' },
    { id: 113, name: 'Agogo', category: 'Percussion' },
    { id: 114, name: 'Steel Drums', category: 'Percussion' },
    { id: 115, name: 'Woodblock', category: 'Percussion' },
    { id: 116, name: 'Taiko Drum', category: 'Percussion' },
    { id: 117, name: 'Melodic Tom', category: 'Percussion' },
    { id: 118, name: 'Synth Drum', category: 'Percussion' },
    { id: 119, name: 'Reverse Cymbal', category: 'Percussion' },
    
    { id: 120, name: 'Guitar Fret Noise', category: 'Sound Effects' },
    { id: 121, name: 'Breath Noise', category: 'Sound Effects' },
    { id: 122, name: 'Seashore', category: 'Sound Effects' },
    { id: 123, name: 'Bird Tweet', category: 'Sound Effects' },
    { id: 124, name: 'Telephone Ring', category: 'Sound Effects' },
    { id: 125, name: 'Helicopter', category: 'Sound Effects' },
    { id: 126, name: 'Applause', category: 'Sound Effects' },
    { id: 127, name: 'Gunshot', category: 'Sound Effects' }
];

export const GM_CATEGORIES = Array.from(new Set(GMInstruments.map(inst => inst.category)));

```

### File: `src/vite-env.d.ts`

```typescript
/// <reference types="vite/client" />

declare module '*?url' {
  const src: string
  export default src
}

```

### File: `src/index.css`

```css
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;1,500&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
@import "tailwindcss";

@theme {
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-serif: "Cormorant Garamond", ui-serif, Georgia, serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
}

.acg-gradient { 
  background: linear-gradient(135deg, #FFEFD5 0%, #E6EAD3 100%); 
}

.glass { 
  background: rgba(255, 255, 255, 0.4); 
  backdrop-filter: blur(8px); 
  border: 1px solid rgba(255, 255, 255, 0.6); 
}

```
