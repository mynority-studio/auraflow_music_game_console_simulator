import React from 'react';
import { Play, Square } from 'lucide-react';
import type { MusicalIR } from '../core/generation/newEngine/ir/MusicalIR';
import { ROLE_COLOR, type PianoRoll } from '../core/generation/newEngine/sandbox/pianoRoll';
import { dream5504VoiceName, type GM128Role } from '../core/sound/GMBK5X128Voices';
import {
  availableCurrentSongVoices,
  type CurrentSongVoiceSelection,
} from '../core/generation/musicGeneration/currentSongVoiceOverride';
import type { QnRole } from '../core/generation/musicGeneration/types';
import type { TakeoverLeadVoiceSelection } from '../core/generation/leadTakeoverSandbox/takeoverVoiceSelection';

export interface QnMonitorTrack {
  role: QnRole;
  count: number;
  instrument: string;
  program: number;
  bank?: number;
  switchTo?: string;
}

export interface QnMonitorReadout {
  status: string;
  attempts: number;
  bpm: number;
  bars: number;
  tracks: QnMonitorTrack[];
}

const STATUS_COLOR: Record<string, string> = {
  pass: 'text-emerald-300',
  ok: 'text-emerald-300',
  warning: 'text-amber-300',
  failed: 'text-rose-300',
};

const trackInstrumentName = (role: string, program: number | undefined, bank?: number): string =>
  dream5504VoiceName(bank, program, role as GM128Role) ?? (program !== undefined ? `Dream5504 PC${program}` : '未指定音色');

const PLAYING_MECHANISM_LABEL: Record<string, string> = {
  keybed: '弹奏（键盘）', 'bellows-keybed': '风箱键盘', 'blown-wind': '吹奏',
  'plucked-string': '弹拨', 'bowed-string': '弓弦', struck: '击奏', 'drum-kit': '鼓组', effect: '效果/事件',
};

const INSTRUMENT_CLASS_LABEL: Record<string, string> = {
  'acoustic-piano': '原声钢琴', 'electric-piano': '电钢琴', 'synth-keyboard': '合成器键盘',
  'acoustic-keyed-pluck': '原声键控拨弦', 'electric-keyed-pluck': '电声键控拨弦', 'electric-organ': '电风琴',
  accordion: '手风琴/班多钮', harmonica: '口琴', vibraphone: '颤音琴', 'mallet-percussion': '击槌乐器',
  'acoustic-guitar': '原声吉他', 'electric-guitar': '电吉他',
  'acoustic-guitar-harmonics': '原声吉他泛音', 'electric-guitar-harmonics': '电吉他泛音',
  'acoustic-bass': '原声 Bass', 'electric-bass': '电 Bass', 'synth-bass': '合成 Bass', 'organ-bass': '风琴 Bass',
  'bowed-solo-string': '独奏弓弦', 'bowed-ensemble-string': '弦乐组', 'orchestral-plucked-string': '管弦拨弦',
  harp: '竖琴', 'world-plucked-string': '民族拨弦', 'thumb-piano': '卡林巴/拇指琴',
  brass: '铜管', saxophone: '萨克斯', 'single-reed-woodwind': '单簧木管', 'double-reed-woodwind': '双簧木管',
  'air-reed-woodwind': '空气簧片木管', bagpipe: '风笛', 'world-double-reed': '民族双簧吹管',
  'choir-voice': '合唱人声', 'pitched-percussion': '有音高打击', 'orchestral-percussion': '管弦打击',
  'drum-kit': '鼓组', effect: '效果音/事件',
};

const SOUND_SOURCE_LABEL: Record<string, string> = {
  acoustic: '原生', electric: '电声', synth: '合成', hybrid: '混合', effect: '效果',
};

const voiceKey = (bank: number | undefined, program: number): string => `${bank ?? 0}:${program}`;

export function deriveQnMonitorReadout(input: {
  ir: MusicalIR;
  status: string;
  attempts: number;
  bpm: number;
}): QnMonitorReadout {
  const { ir, status, attempts, bpm } = input;
  const bars = Math.round(ir.durationTicks / (480 * 4));
  const tracks = ir.tracks.map((tr) => ({
    role: tr.role as QnRole,
    count: tr.notes.length,
    instrument: trackInstrumentName(tr.role, tr.program, tr.bank),
    program: tr.program ?? 0,
    bank: tr.bank,
    switchTo: tr.programChanges && tr.programChanges.length
      ? trackInstrumentName(tr.role, tr.programChanges[tr.programChanges.length - 1].program, tr.programChanges[tr.programChanges.length - 1].bank)
      : undefined,
  }));
  return { status, attempts, bpm, bars, tracks };
}

export const QnGenerationMonitorView: React.FC<{
  status: string;
  readout: QnMonitorReadout | null;
  roll: PianoRoll | null;
  logLines: readonly string[];
  onVoiceChange?: (selection: CurrentSongVoiceSelection) => void;
  takeoverVoice?: TakeoverLeadVoiceSelection | null;
  onTakeoverVoiceChange?: (selection: TakeoverLeadVoiceSelection) => void;
  voiceControlsEnabled?: boolean;
  onReplayCustom?: () => void;
  canReplayCustom?: boolean;
  onStopPlayback?: () => void;
  canStopPlayback?: boolean;
}> = ({
  status,
  readout,
  roll,
  logLines,
  onVoiceChange,
  takeoverVoice,
  onTakeoverVoiceChange,
  voiceControlsEnabled = true,
  onReplayCustom,
  canReplayCustom = false,
  onStopPlayback,
  canStopPlayback = false,
}) => (
  <>
    {/* 状态 + 读出 */}
    <div className="rounded-lg border border-white/10 bg-zinc-950/60 px-3 py-2 text-[12px]">
      <div className="text-zinc-300">{status}</div>
      {readout && (
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-zinc-400">
          <div>状态 <span className={STATUS_COLOR[readout.status] ?? 'text-zinc-200'}>{readout.status}</span></div>
          <div>尝试次数 <span className="text-zinc-200">{readout.attempts}</span></div>
          <div>tempo <span className="text-zinc-200">{readout.bpm} bpm</span></div>
          <div>长度 <span className="text-zinc-200">{readout.bars} 小节</span></div>
          <div className="col-span-2 mt-1 flex flex-wrap gap-2">
            {readout.tracks.map((t) => (
              <span key={t.role} className="rounded bg-zinc-800 px-2 py-0.5">
                {t.role}:{t.count}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>

    {/* 当前乐器:本首【实际】编制 + 音色(含段落音色切换),非候选池 */}
    {readout && (
      <div className="rounded-lg border border-white/10 bg-zinc-950/60 px-3 py-2">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold text-sky-300">当前乐器 · 本首实际编制（{readout.tracks.length} 件）</div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onStopPlayback}
              disabled={!onStopPlayback || !canStopPlayback}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-rose-500/40 bg-rose-500/10 text-rose-200 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-600"
              title="停止播放，保留当前歌曲与乐器选择"
              aria-label="停止播放，保留当前歌曲与乐器选择"
            >
              <Square size={12} fill="currentColor" />
            </button>
            <button
              type="button"
              onClick={onReplayCustom}
              disabled={!onReplayCustom || !canReplayCustom}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-sky-500/40 bg-sky-500/10 text-sky-200 transition hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-600"
              title="按当前乐器选择从头播放"
              aria-label="按当前乐器选择从头播放"
            >
              <Play size={13} fill="currentColor" />
            </button>
          </div>
        </div>
        <div className="space-y-0.5">
          {readout.tracks.map((t) => (
            <div key={t.role} className="flex items-center gap-2 text-[11px]">
              <span className="w-10 shrink-0 text-zinc-400">{t.role}</span>
              {onVoiceChange ? (() => {
                const voices = availableCurrentSongVoices(t.role);
                const groups = new Map<string, typeof voices>();
                for (const voice of voices) {
                  const mechanism = voice.playingMechanism;
                  groups.set(mechanism, [...(groups.get(mechanism) ?? []), voice]);
                }
                const selectedKey = voiceKey(t.bank, t.program);
                return (
                  <select
                    value={selectedKey}
                    disabled={!voiceControlsEnabled}
                    onChange={(event) => {
                      const voice = voices.find((candidate) => voiceKey(candidate.address.bank, candidate.address.program) === event.target.value);
                      if (voice) onVoiceChange({ role: t.role, bank: voice.address.bank, program: voice.address.program });
                    }}
                    className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-100 outline-none focus:border-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
                    title={`Dream 5504 · ${t.role} 声道音色`}
                    aria-label={`${t.role} 声道 Dream 5504 音色`}
                  >
                    {[...groups.entries()].map(([mechanism, options]) => (
                      <optgroup key={mechanism} label={PLAYING_MECHANISM_LABEL[mechanism] ?? mechanism}>
                        {options.map((voice) => (
                          <option key={voiceKey(voice.address.bank, voice.address.program)} value={voiceKey(voice.address.bank, voice.address.program)}>
                            {INSTRUMENT_CLASS_LABEL[voice.instrumentClass] ?? voice.instrumentClass} · {SOUND_SOURCE_LABEL[voice.soundSource] ?? voice.soundSource} · {voice.name} · {t.role === 'drum' ? `PC${voice.address.program}` : `CC0 ${voice.address.bank ?? 0} · PC${voice.address.program}`}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                );
              })() : <span className="text-zinc-100">{t.instrument}</span>}
              {t.switchTo && <span className="text-violet-300">→ chorus {t.switchTo}</span>}
              <span className="ml-auto text-[10px] text-zinc-500">{t.count} 音</span>
            </div>
          ))}
          {onTakeoverVoiceChange && (() => {
            const nativeLead = readout.tracks.find((track) => track.role === 'lead');
            if (!nativeLead) return null;
            const voices = availableCurrentSongVoices('lead');
            const groups = new Map<string, typeof voices>();
            for (const voice of voices) {
              const mechanism = voice.playingMechanism;
              groups.set(mechanism, [...(groups.get(mechanism) ?? []), voice]);
            }
            const selectedKey = voiceKey(
              takeoverVoice?.bank ?? nativeLead.bank,
              takeoverVoice?.program ?? nativeLead.program,
            );
            return (
              <div className="flex items-center gap-2 border-t border-teal-500/15 pt-1 text-[11px]">
                <span className="w-10 shrink-0 text-teal-300">接管</span>
                <select
                  value={selectedKey}
                  disabled={!voiceControlsEnabled}
                  onChange={(event) => {
                    const voice = voices.find((candidate) => (
                      voiceKey(candidate.address.bank, candidate.address.program) === event.target.value
                    ));
                    if (voice) {
                      onTakeoverVoiceChange({
                        bank: voice.address.bank,
                        program: voice.address.program,
                      });
                    }
                  }}
                  className="min-w-0 flex-1 rounded border border-teal-500/35 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-100 outline-none focus:border-teal-300 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Q+T 接管 Lead 音色 · 调度 ch15 · 硬件 MIDI Ch16"
                  aria-label="接管 Lead 声道 Dream 5504 音色"
                >
                  {[...groups.entries()].map(([mechanism, options]) => (
                    <optgroup key={mechanism} label={PLAYING_MECHANISM_LABEL[mechanism] ?? mechanism}>
                      {options.map((voice) => (
                        <option key={voiceKey(voice.address.bank, voice.address.program)} value={voiceKey(voice.address.bank, voice.address.program)}>
                          {INSTRUMENT_CLASS_LABEL[voice.instrumentClass] ?? voice.instrumentClass} · {SOUND_SOURCE_LABEL[voice.soundSource] ?? voice.soundSource} · {voice.name} · CC0 {voice.address.bank ?? 0} · PC{voice.address.program}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <span className="ml-auto shrink-0 text-[10px] text-teal-400/70">ch15 → Ch16</span>
              </div>
            );
          })()}
        </div>
      </div>
    )}

    {/* Piano-roll(各轨音符可视化)*/}
    {roll && roll.notes.length > 0 && (
      <div className="rounded-lg border border-emerald-500/20 bg-black/50">
        <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5">
          <span className="text-[10px] uppercase tracking-widest text-emerald-300/70">piano-roll · 各轨音符</span>
          <span className="flex gap-2 text-[9px] text-zinc-400">
            {(['lead', 'comp', 'bass', 'pad', 'drum'] as const).map((r) => (
              <span key={r} className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: ROLE_COLOR[r] }} />{r}
              </span>
            ))}
          </span>
        </div>
        <svg
          viewBox={`0 0 ${roll.width} ${roll.height}`}
          width="100%"
          className="block"
          style={{ height: roll.height }}
          preserveAspectRatio="none"
        >
          <rect x={0} y={0} width={roll.width} height={roll.height} fill="#09090b" />
          {roll.notes.map((n, i) => (
            <rect key={i} x={n.x} y={n.y} width={n.w} height={n.h} rx={1} fill={n.color} opacity={0.92} />
          ))}
        </svg>
      </div>
    )}

    {/* 流程日志(逐层节点)*/}
    {logLines.length > 0 && (
      <div className="rounded-lg border border-emerald-500/20 bg-black/50">
        <div className="border-b border-white/5 px-3 py-1.5 text-[10px] uppercase tracking-widest text-emerald-300/70">
          流程日志 · 每层节点产出(同步打到浏览器 console)
        </div>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-3 py-2 text-[10px] leading-relaxed text-zinc-300">
          {logLines.join('\n')}
        </pre>
      </div>
    )}
  </>
);
