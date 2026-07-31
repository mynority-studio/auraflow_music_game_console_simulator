import type {
  MeterValue,
  DeclaredMidiBaseline,
  MidiMeasure,
  MidiMeasureMap,
  MidiMeterAnalysis,
  RichSmfDocument,
} from './types';

interface MeterSegment {
  tick: number;
  meter: MeterValue;
  source: MidiMeasure['source'];
}

const meterEquals = (left: MeterValue, right: MeterValue): boolean =>
  left.numerator === right.numerator && left.denominator === right.denominator;

const ticksPerMeasure = (meter: MeterValue, ppq: number): number =>
  Math.max(1, Math.round(meter.numerator * ppq * 4 / meter.denominator));

function meterSegments(
  document: RichSmfDocument,
  meterAnalysis: MidiMeterAnalysis,
  baseline?: DeclaredMidiBaseline,
): MeterSegment[] {
  const fallbackMeter = meterAnalysis.selected ?? { numerator: 4, denominator: 4 };
  const fallbackSource: MidiMeasure['source'] = meterAnalysis.selectedSource === 'declared'
    ? 'declared'
    : meterAnalysis.selectedSource === 'inferred'
      ? 'inferred'
      : 'default';
  const declarations = (baseline?.timeSignatureMap ?? document.timeSignatureMap)
    .filter((event) => event.valid)
    .map((event) => ({
      tick: event.tick,
      meter: { numerator: event.numerator, denominator: event.denominator },
      source: 'declared' as const,
    }))
    .sort((a, b) => a.tick - b.tick);

  const segments: MeterSegment[] = [];
  if (declarations[0]?.tick !== 0) {
    segments.push({
      tick: 0,
      meter: fallbackMeter,
      source: fallbackSource === 'declared' ? 'default' : fallbackSource,
    });
  }
  for (const declaration of declarations) {
    const previous = segments[segments.length - 1];
    if (previous?.tick === declaration.tick) {
      // Keep the first declaration, matching the meter overview. Conflicting
      // same-tick events remain visible in the baseline and are warned below.
      continue;
    } else if (!previous || !meterEquals(previous.meter, declaration.meter) || previous.source !== 'declared') {
      segments.push(declaration);
    }
  }
  if (segments.length === 0) {
    segments.push({ tick: 0, meter: fallbackMeter, source: fallbackSource });
  }
  return segments;
}

export function buildMidiMeasureMap(
  document: RichSmfDocument,
  meterAnalysis: MidiMeterAnalysis,
  baseline?: DeclaredMidiBaseline,
): MidiMeasureMap {
  if (!document.analysisSupport.supported || document.timeDivision.kind !== 'ppq') {
    return {
      measures: [],
      warnings: ['非 SMF 0/1 PPQ 文件，无法建立小节地图'],
    };
  }
  if (document.durationTicks <= 0) return { measures: [], warnings: [] };

  const ppq = document.timeDivision.ppq;
  const segments = meterSegments(document, meterAnalysis, baseline);
  const measures: MidiMeasure[] = [];
  const warnings: string[] = [];
  const declarationsAtTick = new Map<number, Set<string>>();
  for (const declaration of (baseline?.timeSignatureMap ?? document.timeSignatureMap)
    .filter((event) => event.valid)) {
    const values = declarationsAtTick.get(declaration.tick) ?? new Set<string>();
    values.add(`${declaration.numerator}/${declaration.denominator}`);
    declarationsAtTick.set(declaration.tick, values);
  }
  for (const [tick, values] of declarationsAtTick) {
    if (values.size > 1) {
      warnings.push(
        `tick ${tick} 存在冲突拍号声明（${Array.from(values).join('、')}）；小节地图采用排序后的首个声明`,
      );
    }
  }
  let regularMeasureNumber = 1;

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const segment = segments[segmentIndex];
    const segmentEnd = Math.min(
      document.durationTicks,
      segments[segmentIndex + 1]?.tick ?? document.durationTicks,
    );
    if (segmentEnd <= segment.tick) continue;
    const barTicks = ticksPerMeasure(segment.meter, ppq);
    let cursor = segment.tick;

    if (segmentIndex === 0 && segment.tick === 0) {
      // A declared meter at tick 0 establishes the SMF bar origin. Repeated
      // mid-bar accents must not be reinterpreted as a pickup. Only an
      // undeclared/inferred meter may shift the first full bar by accent phase.
      const rawPhase = segment.source === 'inferred'
        ? Math.round(meterAnalysis.barPhaseTick ?? 0)
        : 0;
      const phase = rawPhase > 0 && rawPhase < barTicks ? rawPhase : 0;
      if (phase > 0) {
        const pickupEnd = Math.min(phase, segmentEnd);
        measures.push({
          id: 'measure-pickup',
          label: 'M0',
          index: 0,
          startTick: 0,
          endTick: pickupEnd,
          meter: segment.meter,
          source: segment.source,
          isPickup: true,
          isPartial: true,
        });
        cursor = pickupEnd;
      }
    }

    while (cursor < segmentEnd) {
      const endTick = Math.min(segmentEnd, cursor + barTicks);
      const partial = endTick - cursor < barTicks;
      measures.push({
        id: `measure-${regularMeasureNumber}`,
        label: `M${regularMeasureNumber}`,
        index: regularMeasureNumber,
        startTick: cursor,
        endTick,
        meter: segment.meter,
        source: segment.source,
        isPickup: false,
        isPartial: partial,
      });
      if (partial && endTick < document.durationTicks) {
        warnings.push(
          `拍号在 tick ${endTick} 切换，前一小节 ${regularMeasureNumber} 被截为不完整小节`,
        );
      }
      regularMeasureNumber += 1;
      cursor = endTick;
    }
  }

  if (segments[0]?.source === 'default') {
    warnings.push('文件没有可用拍号声明或可靠推断；小节地图明确使用默认 4/4');
  } else if (segments[0]?.source === 'inferred') {
    warnings.push('文件没有拍号声明；小节边界来自演奏重音推断');
  }
  return { measures, warnings };
}
