// ============================================================
// newEngine · foundation · Timebase
// ------------------------------------------------------------
// 架构定稿 Part 2.0.1 / 附录 C2:全管线唯一时间换算底座。
// tick↔beat 换算【只许走这里】。beat/tick 与 tempo 无关(纯 PPQ 网格);
// tempoMap 仅为后续 tempoCurve / 秒换算预留,本层不消费。
// ============================================================

import { beats, ticks, type Beats, type Ticks } from './brandedPrimitives';
import { deepFreeze, type DeepReadonly } from './deepReadonly';

export interface Meter {
  numerator: number;     // 每小节拍数(分子)
  denominator: number;   // 拍单位(分母:2/4/8/16)
}

export interface TempoEvent {
  atBeat: Beats;
  bpm: number;
}

export interface Timebase {
  readonly ppq: number;
  readonly meter: DeepReadonly<Meter>;
  readonly tempoMap: ReadonlyArray<DeepReadonly<TempoEvent>>;
  beatToTick(beat: Beats): Ticks;
  tickToBeat(tick: Ticks): Beats;
  barToBeat(bar: number): Beats;
}

const DEFAULT_PPQ = 480;

export function createTimebase(opts: {
  ppq?: number;
  meter: Meter;
  tempoMap?: TempoEvent[];
}): Timebase {
  const ppq = opts.ppq ?? DEFAULT_PPQ;
  if (!Number.isInteger(ppq) || ppq <= 0) {
    throw new RangeError(`createTimebase(): ppq 须正整数,得到 ${ppq}`);
  }

  const { numerator, denominator } = opts.meter;
  if (
    !Number.isInteger(numerator) || numerator <= 0 ||
    !Number.isInteger(denominator) || denominator <= 0
  ) {
    throw new RangeError(
      `createTimebase(): meter 须正整数 num/denom,得到 ${numerator}/${denominator}`,
    );
  }

  // 每小节的【四分音符拍】数 = numerator * (4 / denominator)。4/4=4 · 3/4=3 · 6/8=3。
  const beatsPerBar = numerator * (4 / denominator);

  const tb: Timebase = {
    ppq,
    meter: deepFreeze({ numerator, denominator }),
    tempoMap: deepFreeze((opts.tempoMap ?? []).slice()),
    beatToTick(beat: Beats): Ticks {
      return ticks(Math.round((beat as number) * ppq));
    },
    tickToBeat(tick: Ticks): Beats {
      return beats((tick as number) / ppq);
    },
    barToBeat(bar: number): Beats {
      return beats(bar * beatsPerBar);
    },
  };

  return Object.freeze(tb);
}
