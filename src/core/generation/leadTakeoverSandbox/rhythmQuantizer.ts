// ============================================================
// leadTakeoverSandbox · rhythm quantizer
// ------------------------------------------------------------
// Sandbox-local timing helper for user takeover input. It quantizes user
// note-on timing to a future grid point inside the current musical bar.
// ============================================================

export type TakeoverQuantizeGrid = '16th' | '32nd';

export interface TakeoverQuantizeOptions {
  beat: number;
  bpm: number;
  timeSignature: [number, number];
  grid: TakeoverQuantizeGrid;
  lateGraceMs?: number;
  strongBeatLateGraceMs?: number;
  grooveContract?: TakeoverQuantizeGrooveContract | null;
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
  const ratio = Number.isFinite(contract.melodySwingRatio) ? contract.melodySwingRatio! : 0.5;
  if (Math.abs(ratio - 0.5) < SWING_EPSILON) return 0;
  const frac = beatFraction(targetBeat);
  if (Math.abs(frac - SWING_EIGHTH_FRAC) > SWING_EPSILON) return 0;
  return ratio - SWING_EIGHTH_FRAC;
}

function groovePocketMs(targetBeat: number, contract: TakeoverQuantizeGrooveContract): number {
  return midpointMs(isOnBeat(targetBeat) ? contract.melodyStrongPocketMs : contract.melodyWeakPocketMs);
}

function grooveTargetForBase(
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

function applyGrooveContract(
  baseTargetBeat: number,
  sourceBeat: number,
  bpm: number,
  contract: TakeoverQuantizeGrooveContract | null | undefined,
): Pick<TakeoverQuantizeResult, 'targetBeat' | 'baseTargetBeat' | 'grooveOffsetMs' | 'grooveContractId'> {
  const groove = grooveTargetForBase(baseTargetBeat, bpm, contract);
  return {
    ...groove,
    targetBeat: Math.max(sourceBeat, groove.targetBeat),
  };
}

function isGrooveStrongBeat(
  baseBeat: number,
  barStartBeat: number,
  contract: TakeoverQuantizeGrooveContract | null | undefined,
): boolean {
  if (!isOnBeat(baseBeat)) return false;
  const beatIndex = Math.max(0, Math.round(baseBeat - barStartBeat));
  if (beatIndex === 0) return true;
  const accentPattern = contract?.accentPattern;
  if (!accentPattern || accentPattern.length === 0) return true;
  const accent = accentPattern[beatIndex % accentPattern.length];
  return !Number.isFinite(accent) || accent >= 1;
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

  const previousGridLocal = Math.floor((localBeat + EPSILON) / gridStepBeats) * gridStepBeats;
  const previousGridBeat = barStartBeat + previousGridLocal;
  const lateGraceMs = Math.max(0, options.lateGraceMs ?? 0);
  const strongBeatLateGraceMs = Math.max(lateGraceMs, options.strongBeatLateGraceMs ?? 0);
  const previousGroove = grooveTargetForBase(previousGridBeat, bpm, options.grooveContract);
  const previousGrooveBeat = previousGroove.targetBeat;
  const previousGraceMs = isGrooveStrongBeat(previousGridBeat, barStartBeat, options.grooveContract)
    ? strongBeatLateGraceMs
    : lateGraceMs;
  const previousCatchEndBeat = previousGrooveBeat + (previousGraceMs / msPerBeat);
  if (previousGraceMs > 0
    && sourceBeat >= previousGridBeat - EPSILON
    && sourceBeat <= previousCatchEndBeat + EPSILON) {
    const targetBeat = Math.max(sourceBeat, previousGrooveBeat);
    const delayMs = Math.max(0, (targetBeat - sourceBeat) * msPerBeat);
    return {
      sourceBeat,
      targetBeat,
      delayMs,
      gridStepBeats,
      barStartBeat,
      barEndBeat,
      grid: options.grid,
      baseTargetBeat: previousGroove.baseTargetBeat,
      grooveOffsetMs: previousGroove.grooveOffsetMs,
      grooveContractId: previousGroove.grooveContractId,
    };
  }

  const targetLocal = Math.ceil((localBeat - EPSILON) / gridStepBeats) * gridStepBeats;
  const baseTargetBeat = barStartBeat + targetLocal;
  const groove = applyGrooveContract(baseTargetBeat, sourceBeat, bpm, options.grooveContract);
  const targetBeat = groove.targetBeat;
  const delayMs = Math.max(0, (targetBeat - sourceBeat) * msPerBeat);
  return {
    sourceBeat,
    targetBeat,
    delayMs,
    gridStepBeats,
    barStartBeat,
    barEndBeat,
    grid: options.grid,
    baseTargetBeat: groove.baseTargetBeat,
    grooveOffsetMs: groove.grooveOffsetMs,
    grooveContractId: groove.grooveContractId,
  };
}
