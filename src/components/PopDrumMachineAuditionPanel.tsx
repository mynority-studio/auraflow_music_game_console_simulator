import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Drum, Play, Square, X } from 'lucide-react';
import { AudioEngine, startAudioContext } from '../core/audio/AudioEngine';
import { DRUM, drumPerformanceVariants, type DrumHit } from '../core/generation/newEngine/knowledge/grooves';
import { dream5504VoiceName } from '../core/sound/GMBK5X128Voices';
import { useDevPanelChannel } from './devPanels';

type PopDrumAuditionItem = {
  id: string;
  name: string;
  contract: string;
  consumedIn: string;
  bpm: number;
  accent: string;
};

export const POP_DRUM_MACHINE_AUDITION_ITEMS: readonly PopDrumAuditionItem[] = [
  {
    id: 'citypop-syncopated-boogie',
    name: 'CityPop 切分 Boogie',
    contract: 'pop_citypop_boogie',
    consumedIn: 'verse / story / loop',
    bpm: 114,
    accent: '16帽 · 铃鼓 · 切分底鼓 · clap叠层',
  },
  {
    id: 'citypop-disco-boogie',
    name: 'CityPop Disco Boogie',
    contract: 'pop_citypop_boogie',
    consumedIn: 'hook / build',
    bpm: 116,
    accent: '四拍底鼓 · open hat · 拍手叠军鼓',
  },
  {
    id: 'jpop-driving-8ths',
    name: 'JPOP Driving 8ths',
    contract: 'pop_jpop_push_8ths',
    consumedIn: 'active POP',
    bpm: 120,
    accent: '16帽推进 · 开镲 lift · JPOP 推进',
  },
  {
    id: 'pop-backbeat',
    name: 'POP Radio Backbeat',
    contract: 'pop_radio_straight',
    consumedIn: 'radio straight',
    bpm: 112,
    accent: '现代 POP 后拍 · 16帽 · open hat',
  },
  {
    id: 'ballad-halftime',
    name: 'POP Ballad Half-time',
    contract: 'pop_ballad_halftime',
    consumedIn: 'calm / sparse',
    bpm: 86,
    accent: '半拍 · 轻帽 · 留白',
  },
];

const DRUM_CHANNEL = 9;
const NOTE_OFF_CC = 123;
const ALL_SOUND_OFF_CC = 120;
const DEFAULT_VARIANT = 0;
const POP_AUDITION_DRUM_PROGRAM = 8;

export const POP_DRUM_MACHINE_AUDITION_KIT = {
  program: POP_AUDITION_DRUM_PROGRAM,
  name: dream5504VoiceName(undefined, POP_AUDITION_DRUM_PROGRAM, 'drum') ?? `Dream5504 Drum PC${POP_AUDITION_DRUM_PROGRAM}`,
} as const;

function clampVel(vel: number): number {
  return Math.max(1, Math.min(127, Math.round(vel)));
}

function variantsFor(item: PopDrumAuditionItem): DrumHit[][] {
  return drumPerformanceVariants({ patternFamily: item.id });
}

function selectPopAuditionDrumKit(): void {
  AudioEngine.programChange(DRUM_CHANNEL, POP_DRUM_MACHINE_AUDITION_KIT.program);
}

export const PopDrumMachineAuditionPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [variantByFamily, setVariantByFamily] = useState<Record<string, number>>({});
  const timersRef = useRef<number[]>([]);
  const heldKeys = useRef<Set<string>>(new Set());

  useDevPanelChannel('drumAudition', open, setOpen);

  const itemVariants = useMemo(() => {
    return Object.fromEntries(POP_DRUM_MACHINE_AUDITION_ITEMS.map((item) => [item.id, variantsFor(item)])) as Record<string, DrumHit[][]>;
  }, []);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }, []);

  const schedule = useCallback((fn: () => void, delayMs: number) => {
    timersRef.current.push(window.setTimeout(fn, delayMs));
  }, []);

  const stopAudition = useCallback(() => {
    clearTimers();
    AudioEngine.controllerChange(DRUM_CHANNEL, NOTE_OFF_CC, 0);
    AudioEngine.controllerChange(DRUM_CHANNEL, ALL_SOUND_OFF_CC, 0);
    setPlaying(null);
  }, [clearTimers]);

  useEffect(() => () => stopAudition(), [stopAudition]);

  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      heldKeys.current.add(key);
      if (!open && heldKeys.current.has('q') && heldKeys.current.has('d') && !isTyping()) {
        e.preventDefault();
        setOpen(true);
      } else if (open && key === 'escape') {
        setOpen(false);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => heldKeys.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [open]);

  const playPattern = useCallback(async (item: PopDrumAuditionItem) => {
    stopAudition();
    setPlaying(item.id);
    await startAudioContext();
    AudioEngine.stop();
    selectPopAuditionDrumKit();
    AudioEngine.controllerChange(DRUM_CHANNEL, NOTE_OFF_CC, 0);
    AudioEngine.controllerChange(DRUM_CHANNEL, 7, item.id === 'ballad-halftime' ? 92 : 104);
    AudioEngine.controllerChange(DRUM_CHANNEL, 10, 64);
    AudioEngine.controllerChange(DRUM_CHANNEL, 11, 127);
    AudioEngine.controllerChange(DRUM_CHANNEL, 91, item.id.includes('citypop') ? 10 : 4);
    AudioEngine.controllerChange(DRUM_CHANNEL, 93, 0);

    const variants = itemVariants[item.id] ?? [];
    const variantIndex = variantByFamily[item.id] ?? DEFAULT_VARIANT;
    const pattern = variants[variantIndex] ?? variants[0] ?? [];
    const beatMs = 60000 / item.bpm;
    const bars = item.id === 'ballad-halftime' ? 3 : 2;
    for (let bar = 0; bar < bars; bar++) {
      for (const hit of pattern) {
        const at = Math.max(0, Math.round(((bar * 4) + hit.beat) * beatMs));
        schedule(() => {
          AudioEngine.playNote(DRUM_CHANNEL, hit.drum, clampVel(hit.vel), hit.drum === DRUM.OHAT || hit.drum === DRUM.CRASH ? 180 : 86);
          AudioEngine.emitVisualEvent({ type: 'drums', midiNote: hit.drum, velocity: clampVel(hit.vel), source: 'gameplay' });
        }, at);
      }
    }
    schedule(() => setPlaying(null), Math.round((bars * 4 + 0.5) * beatMs));
  }, [itemVariants, schedule, stopAudition, variantByFamily]);

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed right-3 bottom-3 z-[70] w-[520px] max-w-[calc(100vw-1.5rem)] max-h-[76vh] overflow-auto rounded-2xl border border-orange-500/30
                 bg-zinc-950/95 text-zinc-200 shadow-[0_8px_40px_rgba(0,0,0,0.72)] backdrop-blur-md"
      style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
    >
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <Drum size={15} className="text-orange-300" />
        <span className="text-[12px] font-semibold tracking-wide text-orange-200">POP 鼓机打法</span>
        <span className="rounded bg-orange-500/10 px-1.5 py-0.5 text-[10px] text-orange-200">Q+D</span>
        <span className="text-[10px] text-zinc-500">{POP_DRUM_MACHINE_AUDITION_KIT.name} · {POP_DRUM_MACHINE_AUDITION_ITEMS.length} families</span>
        <button type="button" onClick={stopAudition} title="停止试听" className="ml-auto text-zinc-500 hover:text-zinc-200">
          <Square size={14} />
        </button>
        <button type="button" onClick={() => setOpen(false)} title="关闭" className="text-zinc-500 hover:text-zinc-200">
          <X size={15} />
        </button>
      </div>

      <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_72px_92px] gap-2 border-b border-zinc-900 px-3 py-2 text-[10px] uppercase tracking-widest text-zinc-500">
        <span>Pattern</span>
        <span>Contract</span>
        <span>BPM</span>
        <span>Audition</span>
      </div>

      <div className="space-y-1.5 p-3">
        {POP_DRUM_MACHINE_AUDITION_ITEMS.map((item) => {
          const variants = itemVariants[item.id] ?? [];
          const variant = variantByFamily[item.id] ?? DEFAULT_VARIANT;
          const isPlaying = playing === item.id;
          return (
            <div key={item.id} className={`rounded-xl border px-3 py-2 transition-colors ${isPlaying ? 'border-orange-400/50 bg-orange-500/10' : 'border-zinc-900 bg-zinc-900/55'}`}>
              <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_72px_92px] items-start gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-semibold text-zinc-100">{item.name}</div>
                  <div className="mt-0.5 truncate text-[10px] text-zinc-500">{item.id}</div>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[11px] text-zinc-300">{item.contract}</div>
                  <div className="mt-0.5 truncate text-[10px] text-zinc-500">{item.consumedIn}</div>
                </div>
                <div className="text-[12px] text-zinc-300">{item.bpm}</div>
                <button
                  type="button"
                  onClick={() => playPattern(item)}
                  title={`试听 ${item.name}`}
                  className={`inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1 text-[12px] text-white transition-colors
                    ${isPlaying ? 'bg-rose-600 hover:bg-rose-500' : 'bg-orange-600/85 hover:bg-orange-500'}`}
                >
                  {isPlaying ? <Square size={12} /> : <Play size={12} />}
                  {isPlaying ? 'Stop' : 'Play'}
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{item.accent}</span>
                {variants.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setVariantByFamily((prev) => ({ ...prev, [item.id]: idx }))}
                    className={`rounded border px-1.5 py-0.5 text-[10px] transition-colors
                      ${variant === idx ? 'border-orange-400/50 bg-orange-500/15 text-orange-200' : 'border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-zinc-200'}`}
                  >
                    v{idx + 1}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
};
