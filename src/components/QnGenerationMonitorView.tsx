import React from 'react';
import type { MusicalIR } from '../core/generation/newEngine/ir/MusicalIR';
import { ROLE_COLOR, type PianoRoll } from '../core/generation/newEngine/sandbox/pianoRoll';
import { dream5504VoiceName, type GM128Role } from '../core/sound/GMBK5X128Voices';

export interface QnMonitorTrack {
  role: string;
  count: number;
  instrument: string;
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

export function deriveQnMonitorReadout(input: {
  ir: MusicalIR;
  status: string;
  attempts: number;
  bpm: number;
}): QnMonitorReadout {
  const { ir, status, attempts, bpm } = input;
  const bars = Math.round(ir.durationTicks / (480 * 4));
  const tracks = ir.tracks.map((tr) => ({
    role: tr.role,
    count: tr.notes.length,
    instrument: trackInstrumentName(tr.role, tr.program, tr.bank),
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
}> = ({ status, readout, roll, logLines }) => (
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
        <div className="mb-1.5 text-[11px] font-semibold text-sky-300">当前乐器 · 本首实际编制（{readout.tracks.length} 件）</div>
        <div className="space-y-0.5">
          {readout.tracks.map((t) => (
            <div key={t.role} className="flex items-center gap-2 text-[11px]">
              <span className="w-10 shrink-0 text-zinc-400">{t.role}</span>
              <span className="text-zinc-100">{t.instrument}</span>
              {t.switchTo && <span className="text-violet-300">→ chorus {t.switchTo}</span>}
              <span className="ml-auto text-[10px] text-zinc-500">{t.count} 音</span>
            </div>
          ))}
        </div>
        <p className="mt-1 text-[9px] text-zinc-500">乐器随 seed 确定性挑;紫色=同乐手段落换音色(效果器/电钢)。</p>
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
