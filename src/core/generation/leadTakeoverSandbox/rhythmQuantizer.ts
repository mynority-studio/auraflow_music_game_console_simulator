// ============================================================
// leadTakeoverSandbox · rhythm quantizer
// ------------------------------------------------------------
// Sandbox-local timing helper for user takeover input. It micro-snaps live
// events to the nearest grooved grid point without hiding them behind latency.
// ============================================================

export type TakeoverQuantizeGrid = '16th' | '32nd';

export interface TakeoverQuantizeOptions {
  beat: number;
  bpm: number;
  timeSignature: [number, number];
  grid: TakeoverQuantizeGrid;
  grooveContract?: TakeoverQuantizeGrooveContract | null;
  /** Live-input guard: farther grid points are monitored but not delayed. */
  maxDelayMs?: number;
  /** Sequential notes must resolve after this already-assigned target. */
  afterTargetBeat?: number;
}

export interface TakeoverQuantizeGrooveContract {
  id?: string;
  grid?: string;
  melodySwingRatio?: number;
  melodyStrongPocketMs?: readonly [number, number];
  melodyWeakPocketMs?: readonly [number, number];
  accentPattern?: readonly number[];
}

export interface TakeoverQuantizeResult {
  sourceBeat: number;
  targetBeat: number;
  delayMs: number;
  gridStepBeats: number;
  barStartBeat: number;
  barEndBeat: number;
  grid: TakeoverQuantizeGrid;
  baseTargetBeat?: number;
  grooveOffsetMs?: number;
  grooveContractId?: string;
}

const DEFAULT_BPM = 120;
const GRID_STEP_BEATS: Record<TakeoverQuantizeGrid, number> = {
  '16th': 0.25,
  '32nd': 0.125,
};
const EPSILON = 1e-9;
const SWING_EIGHTH_FRAC = 0.5;
const SWING_EPSILON = 1e-6;

export function beatsPerBarOf(timeSignature: [number, number]): number {
  const [num, den] = timeSignature;
  if (!Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0) return 4;
  return num * (4 / den);
}

export function gridStepBeatsOf(grid: TakeoverQuantizeGrid): number {
  return GRID_STEP_BEATS[grid] ?? GRID_STEP_BEATS['16th'];
}

function safeMsPair(pair: readonly [number, number] | undefined): [number, number] {
  if (!pair || pair.length < 2) return [0, 0];
  const lo = Number.isFinite(pair[0]) ? pair[0] : 0;
  const hi = Number.isFinite(pair[1]) ? pair[1] : lo;
  return [lo, hi];
}

function midpointMs(pair: readonly [number, number] | undefined): number {
  const [lo, hi] = safeMsPair(pair);
  return (lo + hi) / 2;
}

function beatFraction(beat: number): number {
  return beat - Math.floor(beat);
}

function isOnBeat(targetBeat: number): boolean {
  return Math.abs(beatFraction(targetBeat)) < SWING_EPSILON;
}

function swingOffsetBeats(targetBeat: number, contract: TakeoverQuantizeGrooveContract): number {
  const rawRatio = Number.isFinite(contract.melodySwingRatio) ? contract.melodySwingRatio! : 0.5;
  const ratio = Math.max(0.5, Math.min(0.8, rawRatio));
  if (Math.abs(ratio - 0.5) < SWING_EPSILON) return 0;
  const frac = beatFraction(targetBeat);
  if (Math.abs(frac) < SWING_EPSILON) return 0;
  // Warp every 16th/32nd inside the beat around the swung eighth. Moving only
  // the eighth itself can put a later 32nd before it and merge rapid notes.
  const warped = frac <= SWING_EIGHTH_FRAC
    ? frac * (ratio / SWING_EIGHTH_FRAC)
    : ratio + (frac - SWING_EIGHTH_FRAC) * ((1 - ratio) / (1 - SWING_EIGHTH_FRAC));
  return warped - frac;
}

function groovePocketMs(targetBeat: number, contract: TakeoverQuantizeGrooveContract): number {
  return midpointMs(isOnBeat(targetBeat) ? contract.melodyStrongPocketMs : contract.melodyWeakPocketMs);
}

export function grooveTargetForBase(
  baseTargetBeat: number,
  bpm: number,
  contract: TakeoverQuantizeGrooveContract | null | undefined,
): Pick<TakeoverQuantizeResult, 'targetBeat' | 'baseTargetBeat' | 'grooveOffsetMs' | 'grooveContractId'> {
  if (!contract) return { targetBeat: baseTargetBeat, baseTargetBeat };

  const msPerBeat = 60000 / bpm;
  const swingBeats = swingOffsetBeats(baseTargetBeat, contract);
  const pocketMs = groovePocketMs(baseTargetBeat, contract);
  const targetBeat = baseTargetBeat + swingBeats + (pocketMs / msPerBeat);

  return {
    targetBeat,
    baseTargetBeat,
    grooveOffsetMs: (targetBeat - baseTargetBeat) * msPerBeat,
    grooveContractId: contract.id,
  };
}

export function quantizeTakeoverBeat(options: TakeoverQuantizeOptions): TakeoverQuantizeResult {
  const sourceBeat = Number.isFinite(options.beat) ? options.beat : 0;
  const bpm = Number.isFinite(options.bpm) && options.bpm > 0 ? options.bpm : DEFAULT_BPM;
  const beatsPerBar = beatsPerBarOf(options.timeSignature);
  const gridStepBeats = gridStepBeatsOf(options.grid);
  const msPerBeat = 60000 / bpm;
  const barStartBeat = Math.floor(sourceBeat / beatsPerBar) * beatsPerBar;
  const barEndBeat = barStartBeat + beatsPerBar;
  const localBeat = sourceBeat - barStartBeat;
  const gridIndex = Math.floor((localBeat + EPSILON) / gridStepBeats);
  const afterTargetBeat = Number.isFinite(options.afterTargetBeat)
    ? options.afterTargetBeat!
    : null;

  type Candidate = ReturnType<typeof grooveTargetForBase> & {
    distance: number;
    actualTargetBeat: number;
  };
  let selected: Candidate | null = null;

  // Four neighbours cover the locally warped swing grid. Expand forward when
  // a rapid sequence has already claimed all nearby targets.
  for (let offset = -2; offset <= 16; offset++) {
    const baseTargetBeat = barStartBeat + (gridIndex + offset) * gridStepBeats;
    const groove = grooveTargetForBase(baseTargetBeat, bpm, options.grooveContract);
    const actualTargetBeat = Math.max(sourceBeat, groove.targetBeat);
    if (afterTargetBeat !== null && actualTargetBeat <= afterTargetBeat + EPSILON) continue;
    const candidate: Candidate = {
      ...groove,
      actualTargetBeat,
      distance: Math.abs(groove.targetBeat - sourceBeat),
    };
    if (!selected
      || candidate.distance < selected.distance - EPSILON
      || (Math.abs(candidate.distance - selected.distance) <= EPSILON
        && candidate.targetBeat <= sourceBeat
        && selected.targetBeat > sourceBeat)) {
      selected = candidate;
    }
  }

  const nearest = selected ?? {
    ...grooveTargetForBase(sourceBeat, bpm, options.grooveContract),
    actualTargetBeat: sourceBeat,
    distance: 0,
  };
  let targetBeat = nearest.actualTargetBeat;
  let delayMs = Math.max(0, (targetBeat - sourceBeat) * msPerBeat);
  const maxDelayMs = Number.isFinite(options.maxDelayMs)
    ? Math.max(0, options.maxDelayMs!)
    : Number.POSITIVE_INFINITY;
  // A live note may skip a far-away snap, but never jump in front of an
  // already assigned sequential note.
  if (delayMs > maxDelayMs) {
    if (afterTargetBeat === null || sourceBeat > afterTargetBeat + EPSILON) {
      targetBeat = sourceBeat;
      delayMs = 0;
    } else {
      const maxDelayBeat = sourceBeat + (maxDelayMs / msPerBeat);
      const audibleSeparationBeat = afterTargetBeat + (12 / msPerBeat);
      targetBeat = Math.max(audibleSeparationBeat, Math.min(targetBeat, maxDelayBeat));
      delayMs = Math.max(0, (targetBeat - sourceBeat) * msPerBeat);
      if (targetBeat <= maxDelayBeat + EPSILON) delayMs = Math.min(delayMs, maxDelayMs);
    }
  }

  return {
    sourceBeat,
    targetBeat,
    delayMs,
    gridStepBeats,
    barStartBeat,
    barEndBeat,
    grid: options.grid,
    baseTargetBeat: nearest.baseTargetBeat,
    grooveOffsetMs: nearest.grooveOffsetMs,
    grooveContractId: nearest.grooveContractId,
  };
}
