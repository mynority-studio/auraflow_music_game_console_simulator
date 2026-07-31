import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileSearch, LoaderCircle, Upload, X } from 'lucide-react';
import { motion } from 'motion/react';
import {
  getMidiAnalysisSession,
  startMidiAnalysisSession,
  subscribeMidiAnalysisSession,
  type MidiAnalysisSessionState,
} from '../core/analysis/midi';
import { AudioEngine } from '../core/audio/AudioEngine';
import { globalMidiScheduler } from '../core/audio/MidiScheduler';
import { useDevPanelChannel } from './devPanels';
import { MidiNoteLayerPanel } from './MidiNoteLayerPanel';

const confidenceText = (confidence: number): string => `${Math.round(confidence * 100)}%`;
const channelText = (channel: number): string => `Ch ${channel + 1}`;
const tickText = (tick: number, ppq: number): string => `${tick}t · ${(tick / ppq).toFixed(2)}拍`;
const fileSizeText = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const textureText: Record<string, string> = {
  block: '柱式',
  arpeggio: '分解',
  sustained: '持续',
  mixed: '混合',
  none: '无',
  unknown: '未知',
};
const pitchClassText = (pitchClass: number | null): string => pitchClass === null
  ? '—'
  : ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][pitchClass] ?? `pc${pitchClass}`;

export const MidiAnalysisMonitorPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<MidiAnalysisSessionState>(getMidiAnalysisSession);
  const [playheadTick, setPlayheadTick] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useDevPanelChannel('midiAnalysis', open, setOpen);

  useEffect(() => subscribeMidiAnalysisSession(setSession), []);

  useEffect(() => {
    const held = new Set<string>();
    const isTyping = () => {
      const element = document.activeElement;
      return !!element && ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      held.add(key);
      if (held.has('q') && held.has('a') && !isTyping()) {
        event.preventDefault();
        setOpen((current) => !current);
        held.clear();
      } else if (open && key === 'escape') {
        setOpen(false);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => held.delete(event.key.toLowerCase());
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const update = () => {
      const report = getMidiAnalysisSession().report;
      const sourcePpq = report?.document.timeDivision.kind === 'ppq'
        ? report.document.timeDivision.ppq
        : AudioEngine.getPpq();
      const uploadedMidiPlaying = globalMidiScheduler.isPlaying
        && AudioEngine.getCurrentMusicGeneration() === null;
      setPlayheadTick(uploadedMidiPlaying
        ? AudioEngine.getCurrentTick() * sourcePpq / AudioEngine.getPpq()
        : 0);
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const report = session.report;
  const ppq = report?.document.timeDivision.kind === 'ppq' ? report.document.timeDivision.ppq : 1;
  const activeChordId = report?.harmony.chordTimeline.find((span) =>
    playheadTick >= span.startTick && playheadTick < span.endTick)?.id ?? null;
  const voicePartsByLane = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const part of report?.voices.parts ?? []) {
      const range = part.minPitch === null ? '' : ` ${part.minPitch}–${part.maxPitch}`;
      const current = result.get(part.sourceLaneId) ?? [];
      current.push(`${part.kind}${range} (${part.noteCount})`);
      result.set(part.sourceLaneId, current);
    }
    return result;
  }, [report]);
  const textureByLane = useMemo(
    () => new Map(report?.voices.laneTextures.map((texture) => [texture.laneId, texture]) ?? []),
    [report],
  );
  const harmonicWindowById = useMemo(
    () => new Map(report?.harmony.windows.map((item) => [item.window.id, item.window]) ?? []),
    [report],
  );

  const analyzeFile = async (file: File): Promise<void> => {
    await startMidiAnalysisSession(await file.arrayBuffer(), { name: file.name, size: file.size });
  };

  if (!open) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed inset-x-4 top-4 bottom-4 z-[75] mx-auto flex max-w-[1280px] flex-col overflow-hidden
                 rounded-2xl border border-cyan-400/30 bg-zinc-950/97 text-zinc-200
                 shadow-[0_18px_70px_rgba(0,0,0,0.82)] backdrop-blur-xl"
      style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
      aria-label="MIDI Analysis Monitor"
    >
      <header className="flex items-center gap-3 border-b border-zinc-800 px-5 py-3">
        <FileSearch className="text-cyan-300" size={20} />
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-zinc-100">MIDI Analysis Monitor</h2>
          <p className="text-[10px] text-zinc-500">Q+A · 只读分析，不写回生成引擎</p>
        </div>
        {session.fileName && (
          <div className="ml-4 min-w-0 text-xs text-zinc-400">
            <span className="text-zinc-200">{session.fileName}</span>
            <span className="ml-2 text-zinc-600">{fileSizeText(session.fileSize)}</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5
                     text-xs text-cyan-200 hover:bg-cyan-500/20"
        >
          <Upload size={14} /> 上传 MIDI
        </button>
        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          accept=".mid,.midi,audio/midi,audio/x-midi"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void analyzeFile(file);
            event.currentTarget.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-100"
          aria-label="关闭 MIDI 分析面板"
        >
          <X size={18} />
        </button>
      </header>

      {session.status === 'idle' && (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="m-8 flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed
                     border-zinc-700 bg-zinc-900/40 text-zinc-500 hover:border-cyan-500/40 hover:text-cyan-200"
        >
          <Upload size={32} />
          <span className="text-sm">上传 .mid / .midi 文件开始只读分析</span>
          <span className="text-[10px]">支持 SMF 0/1 + PPQ；Format 2/SMPTE 仅显示诊断</span>
        </button>
      )}

      {session.status === 'analyzing' && (
        <div className="flex flex-1 items-center justify-center gap-3 text-sm text-cyan-200">
          <LoaderCircle className="animate-spin" size={20} />
          正在后台分析 {session.fileName}…
        </div>
      )}

      {session.status === 'error' && (
        <div className="m-8 flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          <AlertTriangle size={18} />
          <div>
            <div className="font-semibold">分析失败</div>
            <div className="mt-1 text-xs text-rose-300/80">{session.error}</div>
          </div>
        </div>
      )}

      {session.status === 'ready' && report && (
        <div className="grid flex-1 grid-cols-12 gap-3 overflow-auto p-4 text-[11px]">
          <article className="col-span-12 rounded-xl border border-emerald-500/20 bg-emerald-950/15 p-3 lg:col-span-6">
            <h3 className="mb-1 text-xs font-semibold text-emerald-200">① MIDI 原文件声明基准</h3>
            <p className="mb-2 text-[9px] text-emerald-300/55">仅显示字节流明确写入的信息，不含默认值和算法推断</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-zinc-400">
              <dt>格式</dt><dd className="text-zinc-200">SMF {report.baseline.format}</dd>
              <dt>时基</dt>
              <dd className="text-zinc-200">
                {report.baseline.timeDivision.kind === 'ppq'
                  ? `PPQ ${report.baseline.timeDivision.ppq}`
                  : `${report.baseline.timeDivision.framesPerSecond}fps × ${report.baseline.timeDivision.ticksPerFrame}`}
              </dd>
              <dt>声明轨道</dt>
              <dd className="text-zinc-200">
                {report.baseline.declaredTrackCount} Tracks · {report.baseline.usedChannels.map(channelText).join(', ') || '无通道事件'}
              </dd>
              <dt>Tempo Map</dt>
              <dd className="text-zinc-200">
                {report.baseline.tempoMap.length
                  ? report.baseline.tempoMap.map((item) => `${item.bpm.toFixed(2)} BPM @${item.tick}`).join(' · ')
                  : '未声明'}
              </dd>
              <dt>Meter Map</dt>
              <dd className="text-zinc-200">
                {report.baseline.timeSignatureMap.length
                  ? report.baseline.timeSignatureMap.map((item) =>
                    `${item.numerator}/${item.denominator}@${item.tick}`).join(' · ')
                  : '未声明'}
              </dd>
              <dt>Key Map</dt>
              <dd className="text-zinc-200">
                {report.baseline.keySignatureMap.length
                  ? report.baseline.keySignatureMap.map((item) =>
                    `${item.sharpsFlats >= 0 ? '+' : ''}${item.sharpsFlats} ${item.mode}@${item.tick}`).join(' · ')
                  : '未声明'}
              </dd>
              <dt>标记</dt>
              <dd className="text-zinc-200">
                {[...report.baseline.markers, ...report.baseline.cuePoints]
                  .sort((left, right) => left.tick - right.tick)
                  .map((item) => `${item.text}@${item.tick}`).join(' · ') || '未声明'}
              </dd>
            </dl>
          </article>

          <article className="col-span-12 rounded-xl border border-cyan-500/20 bg-zinc-900/55 p-3 lg:col-span-6">
            <h3 className="mb-1 text-xs font-semibold text-cyan-200">② 结构与调性分析</h3>
            <p className="mb-2 text-[9px] text-zinc-500">以下均为算法结果，并保留来源与置信度</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-zinc-400">
              <dt>解析数量</dt>
              <dd className="text-zinc-200">
                {report.inventory.physicalTrackCount} Tracks / {report.inventory.usedChannels.length} Channels / {report.inventory.lanes.length} Lanes / {report.inventory.noteCount} Notes
              </dd>
              <dt>采用拍号</dt>
              <dd className="text-zinc-200">
                {report.meter.selected
                  ? `${report.meter.selected.numerator}/${report.meter.selected.denominator}（${report.meter.selectedSource}）`
                  : '未知'}
              </dd>
              <dt>小节数量</dt>
              <dd className="text-zinc-200">
                {report.measures.measures.length} 小节
                {report.measures.measures.some((measure) => measure.isPickup) ? ' · 含弱起 M0' : ''}
                {report.measures.measures.some((measure) => measure.isPartial && !measure.isPickup)
                  ? ' · 含不完整尾小节'
                  : ''}
              </dd>
              <dt>拍组/重拍</dt>
              <dd className="text-zinc-200">
                {report.meter.beatGrouping?.join('+') ?? '未知'} · {report.meter.performedAccents.length} 个演奏重音点
              </dd>
              <dt>声明调号</dt><dd className="text-zinc-200">{report.key.declared?.value ?? '未声明'}</dd>
              <dt>实际调性</dt>
              <dd className="text-zinc-200">
                {report.key.inferred
                  ? `${report.key.inferred.value} · ${confidenceText(report.key.inferred.confidence)}`
                  : '未知'}
              </dd>
              <dt>局部调性</dt>
              <dd className="text-zinc-200">
                {report.key.localSegments.length > 0
                  ? report.key.localSegments.map((segment) =>
                    `${segment.startMeasureLabel ?? '?'}–${segment.endMeasureLabel ?? '?'}: ${
                      segment.selected?.label ?? '未知'
                    } ${confidenceText(segment.confidence ?? 0)}`).join(' · ')
                  : '素材不足'}
              </dd>
              <dt>播放位置</dt><dd className="text-cyan-300">{tickText(Math.round(playheadTick), ppq)}</dd>
            </dl>
          </article>

          <article className="col-span-12 rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-3">
            <h3 className="mb-2 text-xs font-semibold text-emerald-200">原文件 Track / Channel / Program 声明</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-zinc-600">
                  <tr><th>Track</th><th>轨名</th><th>乐器名</th><th>声明通道</th><th>Bank / Program</th><th>事件</th></tr>
                </thead>
                <tbody>
                  {report.baseline.tracks.map((track) => (
                    <tr key={track.trackIndex} className="border-t border-zinc-800/70">
                      <td className="py-1 text-zinc-400">T{track.trackIndex + 1}</td>
                      <td className="text-zinc-300">{track.name ?? '—'}</td>
                      <td>{track.instrumentName ?? '—'}</td>
                      <td>{track.channelNumbers.map(channelText).join(', ') || '—'}</td>
                      <td>
                        {track.programs.map((program) =>
                          `${program.bankMsb}/${program.bankLsb} · P${program.program}@${program.tick}`).join(' · ') || '未声明'}
                      </td>
                      <td>{track.eventCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="col-span-12 rounded-xl border border-zinc-800 bg-zinc-900/55 p-3">
            <h3 className="mb-2 text-xs font-semibold text-cyan-200">③ Track × Channel → 音域声部 → 伴奏织体</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-zinc-600">
                  <tr><th>Lane</th><th>名称</th><th>原始音域</th><th>整轨初判</th><th>拆分声部（音高/音符数）</th><th>伴奏织体</th><th>置信度</th></tr>
                </thead>
                <tbody>
                  {report.inventory.lanes.map((lane) => (
                    <tr key={lane.id} className="border-t border-zinc-800/70">
                      <td className="py-1 text-zinc-400">T{lane.trackIndex + 1} · {channelText(lane.channel)}</td>
                      <td className="max-w-40 truncate text-zinc-300">{lane.trackName ?? lane.instrumentName ?? '—'}</td>
                      <td>{lane.minPitch ?? '—'}–{lane.maxPitch ?? '—'}</td>
                      <td className="font-semibold text-amber-200">{lane.role}</td>
                      <td className="text-zinc-200">{voicePartsByLane.get(lane.id)?.join(' · ') ?? '—'}</td>
                      <td className="font-semibold text-violet-200">
                        {textureText[textureByLane.get(lane.id)?.texture ?? 'unknown']}
                      </td>
                      <td>{confidenceText(textureByLane.get(lane.id)?.confidence ?? lane.roleConfidence)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="col-span-12 rounded-xl border border-cyan-500/25 bg-zinc-900/55 p-3">
            <h3 className="mb-1 text-xs font-semibold text-cyan-200">④ 全曲音符分层面板</h3>
            <p className="mb-2 text-[9px] text-zinc-500">
              青色实线为小节线；琥珀虚线为小节内和弦切分；白色描边为骨干音；半透明为经过/邻接等装饰音。全曲连续显示，不需要切换小节。
            </p>
            <MidiNoteLayerPanel report={report} playheadTick={playheadTick} />
          </article>

          <article className="col-span-12 rounded-xl border border-zinc-800 bg-zinc-900/55 p-3">
            <div className="mb-2 flex items-center gap-3">
              <h3 className="text-xs font-semibold text-cyan-200">⑤ 和弦切片识别</h3>
              <span className="text-zinc-600">
                候选独立识别 · 仅合并同根包含型分批落键
              </span>
            </div>
            <div className="grid grid-cols-1 gap-1 md:grid-cols-2 xl:grid-cols-3">
              {report.harmony.chordTimeline.map((span) => {
                const active = activeChordId === span.id;
                const measure = harmonicWindowById.get(span.sourceWindowIds[0]);
                return (
                  <div
                    key={span.id}
                    className={`grid grid-cols-[1fr_auto] rounded-lg border px-2.5 py-2 ${
                      active
                        ? 'border-cyan-400/60 bg-cyan-500/15'
                        : 'border-zinc-800 bg-black/20'
                    }`}
                  >
                    <div>
                      <span className="mr-2 rounded bg-cyan-500/10 px-1.5 py-0.5 text-[9px] text-cyan-300">
                        {span.sourceWindowIds.length > 1
                          ? `${measure?.measureLabel ?? '?'} · 合并${span.sourceWindowIds.length}片`
                          : measure?.segmentLabel ?? '?'}
                      </span>
                      <span className="text-sm font-semibold text-zinc-100">{span.label}</span>
                    </div>
                    <span className="text-zinc-500">{confidenceText(span.confidence)}</span>
                    <div className="col-span-2 mt-0.5 text-[9px] text-zinc-600">
                      {tickText(span.startTick, ppq)} → {tickText(span.endTick, ppq)}
                      {' · '}bass {pitchClassText(measure?.bassPc ?? null)}
                      {' · '}证据 comp {measure?.evidenceTotals.accompaniment.toFixed(1) ?? '0.0'}
                      / bass {measure?.evidenceTotals.bass.toFixed(1) ?? '0.0'}
                      / 重拍 {measure?.evidenceTotals.strongBeat.toFixed(1) ?? '0.0'}
                      {measure && measure.segmentCount > 1
                        ? ` · ${measure.measureLabel} 内第 ${measure.segmentIndex + 1}/${measure.segmentCount} 段`
                        : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          </article>

          <article className="col-span-12 rounded-xl border border-zinc-800 bg-zinc-900/55 p-3">
            <h3 className="mb-2 text-xs font-semibold text-cyan-200">诊断与不确定性</h3>
            {report.warnings.length === 0 ? (
              <div className="text-emerald-300">无解析警告</div>
            ) : (
              <ul className="grid gap-1 text-amber-200/80 md:grid-cols-2">
                {report.warnings.map((warning, index) => (
                  <li key={`${warning}-${index}`} className="flex gap-1.5">
                    <AlertTriangle className="mt-0.5 shrink-0" size={11} /> {warning}
                  </li>
                ))}
              </ul>
            )}
          </article>
        </div>
      )}
    </motion.section>
  );
};
