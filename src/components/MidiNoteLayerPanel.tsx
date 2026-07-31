import React, { useMemo, useState } from 'react';
import type {
  MidiAnalysisReport,
  MidiDerivedVoiceKind,
  MidiMelodicFunction,
  MidiMetricLevel,
  MidiStructuralRole,
} from '../core/analysis/midi';

interface MidiNoteLayerPanelProps {
  report: MidiAnalysisReport;
  playheadTick: number;
}

type VoiceFilter = 'all' | MidiDerivedVoiceKind;

const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const MEASURE_WIDTH = 144;
const DETAIL_ROW_LIMIT = 500;
const VOICE_COLORS: Record<MidiDerivedVoiceKind, string> = {
  melody: '#22d3ee',
  accompaniment: '#a78bfa',
  bass: '#fbbf24',
  drums: '#fb7185',
  unassigned: '#a1a1aa',
};
const VOICE_TEXT: Record<MidiDerivedVoiceKind, string> = {
  melody: '旋律',
  accompaniment: '伴奏',
  bass: '低音',
  drums: '鼓',
  unassigned: '未定',
};
const METRIC_TEXT: Record<MidiMetricLevel, string> = {
  downbeat: '小节重拍',
  strongBeat: '次重拍',
  beat: '拍点',
  subdivision: '细分拍',
  offbeat: '弱位',
};
const FUNCTION_TEXT: Record<MidiMelodicFunction, string> = {
  chordTone: '和弦音',
  sustainedChordTone: '延续和弦音',
  passingTone: '经过音',
  neighborTone: '邻接音',
  anticipation: '先现音',
  suspension: '延留音',
  appoggiatura: '倚音',
  escapeTone: '逸音',
  scaleNonChordTone: '调内非和弦音',
  nonChordTone: '非和弦音',
  percussion: '打击音',
  unknown: '未知',
};
const STRUCTURE_TEXT: Record<MidiStructuralRole, string> = {
  backbone: '骨干',
  ornament: '装饰',
  ambiguous: '待定',
};

const noteName = (pitch: number): string =>
  `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
const percent = (value: number): string => `${Math.round(value * 100)}%`;

export const MidiNoteLayerPanel: React.FC<MidiNoteLayerPanelProps> = ({
  report,
  playheadTick,
}) => {
  const [voiceFilter, setVoiceFilter] = useState<VoiceFilter>('all');
  const layers = report.noteLayers.measures;
  const allEntries = useMemo(
    () => layers.flatMap((layer, measureIndex) =>
      layer.notes.map((note) => ({ note, layer, measureIndex }))),
    [layers],
  );
  const visibleEntries = useMemo(
    () => allEntries.filter(({ note }) =>
      voiceFilter === 'all' || note.voiceKind === voiceFilter),
    [allEntries, voiceFilter],
  );
  const pitchRange = useMemo(() => {
    const source = visibleEntries.length > 0 ? visibleEntries : allEntries;
    if (source.length === 0) return { minimum: 48, maximum: 72 };
    return {
      minimum: Math.max(0, Math.min(...source.map(({ note }) => note.pitch)) - 1),
      maximum: Math.min(127, Math.max(...source.map(({ note }) => note.pitch)) + 1),
    };
  }, [allEntries, visibleEntries]);

  if (layers.length === 0) {
    return <div className="text-zinc-500">没有可显示的小节音符层。</div>;
  }

  const measureWidth = Math.max(MEASURE_WIDTH, 800 / layers.length);
  const timelineWidth = layers.length * measureWidth;
  const measureIndexById = new Map<string, number>(
    layers.map((layer, index) => [layer.measure.id, index] as const),
  );
  const pitchSpan = Math.max(1, pitchRange.maximum - pitchRange.minimum + 1);
  const presentKinds = new Set(allEntries.map(({ note }) => note.voiceKind));
  const playheadMeasureIndex = layers.findIndex((layer) =>
    playheadTick >= layer.measure.startTick && playheadTick < layer.measure.endTick);
  const playheadLayer = playheadMeasureIndex >= 0 ? layers[playheadMeasureIndex] : null;
  const playheadLeft = playheadLayer
    ? (
      playheadMeasureIndex
      + (playheadTick - playheadLayer.measure.startTick)
        / Math.max(1, playheadLayer.measure.endTick - playheadLayer.measure.startTick)
    ) * measureWidth
    : null;
  const detailEntries = visibleEntries.slice(0, DETAIL_ROW_LIMIT);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="mr-2 text-[9px] text-zinc-500">
          文件头声明 {report.baseline.declaredTrackCount} Tracks · 实际解析 {report.baseline.tracks.length} 个物理轨
          {' · '}{layers.length} 小节 · {allEntries.length} 个发声音符片段
        </span>
        {(['all', 'melody', 'accompaniment', 'bass', 'drums', 'unassigned'] as const)
          .filter((kind) => kind === 'all' || presentKinds.has(kind))
          .map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setVoiceFilter(kind)}
              className={`rounded border px-2 py-0.5 text-[9px] ${
                voiceFilter === kind
                  ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-100'
                  : 'border-zinc-800 text-zinc-500'
              }`}
            >
              {kind === 'all' ? '全部声部' : VOICE_TEXT[kind]}
            </button>
          ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-black/30">
        <div
          className="relative h-64"
          style={{ width: `${timelineWidth}px` }}
          aria-label={`全曲音符视图，共 ${layers.length} 小节`}
        >
          {layers.map((layer, index) => (
            <React.Fragment key={layer.measure.id}>
              <div
                className="absolute inset-y-0 z-[2] border-l border-cyan-300/55"
                style={{ left: `${index * measureWidth}px` }}
              />
              <div
                className="absolute top-1 z-[3] flex items-center gap-1 rounded bg-zinc-950/80 px-1 text-[8px] text-cyan-300"
                style={{ left: `${index * measureWidth + 3}px` }}
              >
                <span>{layer.measure.label}</span>
                <span className="text-zinc-600">
                  {layer.measure.meter.numerator}/{layer.measure.meter.denominator}
                </span>
                <span className="text-amber-300/70">{layer.chordLabel}</span>
              </div>
            </React.Fragment>
          ))}
          <div
            className="absolute inset-y-0 z-[2] border-l border-cyan-300/55"
            style={{ left: `${layers.length * measureWidth - 1}px` }}
          />

          {report.harmony.boundaries.map((boundary) => {
            const measureIndex = measureIndexById.get(boundary.measureId);
            if (measureIndex === undefined) return null;
            const measure = layers[measureIndex]?.measure;
            if (!measure) return null;
            const localPosition = (boundary.tick - measure.startTick)
              / Math.max(1, measure.endTick - measure.startTick);
            const left = (measureIndex + localPosition) * measureWidth;
            return (
              <div
                key={boundary.id}
                className="absolute inset-y-0 z-[2] border-l border-dashed border-amber-300/70"
                style={{ left: `${left}px` }}
                title={`和弦切分 · ${boundary.evidence.join('；')}`}
              >
                <span className="absolute top-7 -translate-x-1/2 rounded bg-amber-950/90 px-1 text-[7px] text-amber-200">
                  和弦切分
                </span>
              </div>
            );
          })}

          {visibleEntries.map(({ note, layer, measureIndex }) => {
            const measureDuration = Math.max(1, layer.measure.endTick - layer.measure.startTick);
            const localStart = (note.clippedStartTick - layer.measure.startTick) / measureDuration;
            const localDuration = (note.clippedEndTick - note.clippedStartTick) / measureDuration;
            const left = (measureIndex + localStart) * measureWidth;
            const width = Math.max(2, localDuration * measureWidth);
            const bottom = (note.pitch - pitchRange.minimum) / pitchSpan * 100;
            const color = VOICE_COLORS[note.voiceKind];
            return (
              <div
                key={note.id}
                className="absolute z-[1] flex min-h-[6px] items-center overflow-hidden rounded-sm border px-0.5 text-[7px] font-semibold text-black"
                style={{
                  left: `${left}px`,
                  width: `${width}px`,
                  bottom: `${bottom}%`,
                  height: `${Math.max(7, Math.min(14, 218 / pitchSpan))}px`,
                  backgroundColor: color,
                  borderColor: note.structuralRole === 'backbone' ? '#ffffff' : color,
                  opacity: note.structuralRole === 'ornament'
                    ? 0.48
                    : note.structuralRole === 'ambiguous'
                      ? 0.72
                      : 0.94,
                  boxShadow: note.structuralRole === 'backbone' ? `0 0 7px ${color}` : 'none',
                }}
                title={`${layer.measure.label} · ${noteName(note.pitch)} · ${VOICE_TEXT[note.voiceKind]} · ${FUNCTION_TEXT[note.melodicFunction]} · ${STRUCTURE_TEXT[note.structuralRole]}`}
              >
                {width >= 18 ? noteName(note.pitch) : ''}
              </div>
            );
          })}

          {playheadLeft !== null && (
            <div
              className="absolute inset-y-0 z-10 w-px bg-white shadow-[0_0_6px_white]"
              style={{ left: `${playheadLeft}px` }}
            />
          )}
          <div className="absolute bottom-1 left-1 z-20 rounded bg-black/70 px-1 text-[8px] text-zinc-500">
            {noteName(pitchRange.minimum)}–{noteName(pitchRange.maximum)}
          </div>
        </div>
      </div>

      <div className="mt-2 max-h-64 overflow-auto">
        <table className="w-full text-left text-[9px]">
          <thead className="sticky top-0 bg-zinc-950 text-zinc-600">
            <tr>
              <th>小节</th><th>原轨/Lane</th><th>音符</th><th>拍位</th>
              <th>度量/演奏重音</th><th>声部</th><th>旋律功能</th><th>结构层</th>
            </tr>
          </thead>
          <tbody>
            {detailEntries.map(({ note, layer }) => (
              <tr key={`row-${note.id}`} className="border-t border-zinc-800/70">
                <td className="py-1 text-cyan-300">{layer.measure.label}</td>
                <td className="text-zinc-500">
                  T{note.trackIndex + 1} / Ch {note.channel + 1}
                  {note.isCarriedIn ? ' · 延入' : ''}
                  {note.pedalExtended ? ' · 踏板' : ''}
                </td>
                <td className="font-semibold" style={{ color: VOICE_COLORS[note.voiceKind] }}>
                  {noteName(note.pitch)} <span className="font-normal text-zinc-600">({note.pitch})</span>
                </td>
                <td>{note.beatPosition.toFixed(2)}</td>
                <td title={note.evidence.join('；')}>
                  {METRIC_TEXT[note.metricLevel]} {percent(note.metricStrength)} / {percent(note.performedAccent)}
                </td>
                <td>{VOICE_TEXT[note.voiceKind]}</td>
                <td>
                  {FUNCTION_TEXT[note.melodicFunction]} · {percent(note.functionConfidence)}
                </td>
                <td className={
                  note.structuralRole === 'backbone'
                    ? 'font-semibold text-emerald-300'
                    : note.structuralRole === 'ornament'
                      ? 'text-zinc-500'
                      : 'text-amber-300'
                }>
                  {STRUCTURE_TEXT[note.structuralRole]} · {percent(note.structuralScore)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visibleEntries.length > DETAIL_ROW_LIMIT && (
          <div className="border-t border-zinc-800 py-2 text-center text-[9px] text-zinc-600">
            全曲卷帘已显示全部音符；明细表为保证性能仅列前 {DETAIL_ROW_LIMIT} 条。
          </div>
        )}
      </div>
    </div>
  );
};
