// ============================================================
// newEngine · arranger · OpeningGesturePlanner
// ------------------------------------------------------------
// 全曲开头的“编配导演”:在 arranger 层决定首段入场手势。
// 约束:
//   - 只下发 plan,不生成 MIDI;
//   - 不指定 GM program,不覆盖器配 family 随机;
//   - 严格尊重 BandSpec.instrumentPool,没选的 role 不出现在计划里;
//   - 权重保持偏好级(1..3),黄金种子/诊断相似度不得进入生产概率。
// ============================================================

import type { BandSpec } from '../band/BandSpec';
import type { Rng } from '../foundation';
import type {
  OpeningDrumEntry,
  OpeningGestureMode,
  OpeningGesturePlan,
  OpeningIntensity,
  OpeningRole,
  OpeningTextureEntry,
  Section,
} from './ArrangementPlan';

interface OpeningGestureCandidate {
  mode: OpeningGestureMode;
  drumEntry: OpeningDrumEntry;
  textureEntry: OpeningTextureEntry;
  roleDelayBars: Partial<Record<OpeningRole, number>>;
  pickupBars: 0 | 1;
  intensity: OpeningIntensity;
  weight: number;
}

const ROLE_ORDER: readonly OpeningRole[] = ['comp', 'pad', 'bass', 'drum', 'lead'];
const MAX_WEIGHT = 3;

const TEXTURE_ROLE_SUPPORT: Record<OpeningTextureEntry, readonly OpeningRole[]> = {
  none: [],
  pianoRiff: ['comp', 'lead'],
  rhodesDust: ['comp', 'pad'],
  padSwell: ['pad', 'comp'],
  stringOstinato: ['pad', 'comp'],
  synthPulse: ['comp', 'pad', 'lead'],
  guitarMute: ['comp'],
  bellMotif: ['lead', 'comp'],
  vinylNoise: ['comp', 'pad', 'drum'],
};

const STYLE_TEXTURE_FALLBACKS: Record<string, readonly OpeningTextureEntry[]> = {
  pop: ['pianoRiff', 'synthPulse', 'padSwell', 'bellMotif', 'none'],
  rnb: ['rhodesDust', 'padSwell', 'pianoRiff', 'none'],
  lofi: ['rhodesDust', 'vinylNoise', 'padSwell', 'pianoRiff', 'none'],
  jazz: ['pianoRiff', 'rhodesDust', 'none'],
  acg: ['pianoRiff', 'bellMotif', 'stringOstinato', 'padSwell', 'none'],
  default: ['pianoRiff', 'padSwell', 'synthPulse', 'none'],
};

const STYLE_CANDIDATES: Record<string, readonly OpeningGestureCandidate[]> = {
  pop: [
    { mode: 'textureFadeIn', drumEntry: 'hatsOnly', textureEntry: 'pianoRiff', roleDelayBars: { comp: 0, pad: 0, drum: 0, bass: 1, lead: 3 }, pickupBars: 0, intensity: 'medium', weight: 3 },
    { mode: 'riffFirst', drumEntry: 'backbeatDelayed', textureEntry: 'synthPulse', roleDelayBars: { comp: 0, drum: 0, bass: 1, pad: 1, lead: 2 }, pickupBars: 0, intensity: 'bold', weight: 2 },
    { mode: 'drumsFirst', drumEntry: 'fourOnFloorRamp', textureEntry: 'padSwell', roleDelayBars: { drum: 0, comp: 1, bass: 1, pad: 0, lead: 3 }, pickupBars: 0, intensity: 'bold', weight: 2 },
    { mode: 'pickupFill', drumEntry: 'tomPickup', textureEntry: 'bellMotif', roleDelayBars: { drum: 0, comp: 0, bass: 0, lead: 1, pad: 1 }, pickupBars: 1, intensity: 'bold', weight: 1 },
  ],
  rnb: [
    { mode: 'textureFadeIn', drumEntry: 'halftimePocket', textureEntry: 'rhodesDust', roleDelayBars: { comp: 0, pad: 0, drum: 1, bass: 1, lead: 3 }, pickupBars: 0, intensity: 'soft', weight: 3 },
    { mode: 'riffFirst', drumEntry: 'hatsOnly', textureEntry: 'pianoRiff', roleDelayBars: { comp: 0, drum: 1, bass: 2, pad: 0, lead: 2 }, pickupBars: 0, intensity: 'medium', weight: 2 },
    { mode: 'textureFadeIn', drumEntry: 'backbeatDelayed', textureEntry: 'padSwell', roleDelayBars: { pad: 0, comp: 0, drum: 1, bass: 1, lead: 3 }, pickupBars: 0, intensity: 'medium', weight: 2 },
    { mode: 'pickupFill', drumEntry: 'kickOnly', textureEntry: 'rhodesDust', roleDelayBars: { comp: 0, bass: 1, drum: 0, lead: 2, pad: 1 }, pickupBars: 1, intensity: 'medium', weight: 1 },
  ],
  lofi: [
    { mode: 'textureFadeIn', drumEntry: 'hatsOnly', textureEntry: 'vinylNoise', roleDelayBars: { comp: 0, pad: 0, drum: 1, bass: 2, lead: 3 }, pickupBars: 0, intensity: 'soft', weight: 3 },
    { mode: 'textureFadeIn', drumEntry: 'brushLoop', textureEntry: 'rhodesDust', roleDelayBars: { comp: 0, drum: 1, bass: 1, pad: 0, lead: 3 }, pickupBars: 0, intensity: 'soft', weight: 2 },
    { mode: 'riffFirst', drumEntry: 'halftimePocket', textureEntry: 'pianoRiff', roleDelayBars: { comp: 0, bass: 1, drum: 1, lead: 2, pad: 1 }, pickupBars: 0, intensity: 'soft', weight: 2 },
    { mode: 'pickupFill', drumEntry: 'kickOnly', textureEntry: 'rhodesDust', roleDelayBars: { comp: 0, drum: 0, bass: 2, lead: 3, pad: 1 }, pickupBars: 1, intensity: 'soft', weight: 1 },
  ],
  jazz: [
    { mode: 'drumsFirst', drumEntry: 'rideOnly', textureEntry: 'pianoRiff', roleDelayBars: { drum: 0, comp: 0, bass: 1, lead: 2 }, pickupBars: 0, intensity: 'medium', weight: 3 },
    { mode: 'rubatoKeys', drumEntry: 'none', textureEntry: 'pianoRiff', roleDelayBars: { comp: 0, bass: 1, drum: 2, lead: 2 }, pickupBars: 0, intensity: 'soft', weight: 2 },
    { mode: 'pickupFill', drumEntry: 'brushLoop', textureEntry: 'rhodesDust', roleDelayBars: { drum: 0, comp: 0, bass: 1, lead: 1 }, pickupBars: 1, intensity: 'medium', weight: 2 },
    { mode: 'riffFirst', drumEntry: 'rideOnly', textureEntry: 'none', roleDelayBars: { bass: 0, drum: 0, comp: 1, lead: 2 }, pickupBars: 0, intensity: 'medium', weight: 1 },
  ],
  acg: [
    { mode: 'rubatoKeys', drumEntry: 'none', textureEntry: 'pianoRiff', roleDelayBars: { comp: 0, bass: 1, pad: 0, lead: 2 }, pickupBars: 0, intensity: 'soft', weight: 3 },
    { mode: 'textureFadeIn', drumEntry: 'none', textureEntry: 'stringOstinato', roleDelayBars: { pad: 0, comp: 0, bass: 1, lead: 2 }, pickupBars: 0, intensity: 'medium', weight: 2 },
    { mode: 'riffFirst', drumEntry: 'backbeatDelayed', textureEntry: 'synthPulse', roleDelayBars: { comp: 0, drum: 0, bass: 1, lead: 1, pad: 1 }, pickupBars: 0, intensity: 'bold', weight: 2 },
    { mode: 'pickupFill', drumEntry: 'tomPickup', textureEntry: 'bellMotif', roleDelayBars: { drum: 0, comp: 0, bass: 1, lead: 1, pad: 1 }, pickupBars: 1, intensity: 'bold', weight: 1 },
  ],
  default: [
    { mode: 'textureFadeIn', drumEntry: 'hatsOnly', textureEntry: 'pianoRiff', roleDelayBars: { comp: 0, pad: 0, drum: 0, bass: 1, lead: 2 }, pickupBars: 0, intensity: 'medium', weight: 2 },
    { mode: 'coldDownbeat', drumEntry: 'backbeatDelayed', textureEntry: 'padSwell', roleDelayBars: { comp: 0, drum: 0, bass: 0, pad: 0, lead: 1 }, pickupBars: 0, intensity: 'medium', weight: 1 },
  ],
};

function styleKey(style: string): string {
  return Object.prototype.hasOwnProperty.call(STYLE_CANDIDATES, style.toLowerCase())
    ? style.toLowerCase()
    : 'default';
}

function weightedPick(candidates: readonly OpeningGestureCandidate[], rng?: Rng): OpeningGestureCandidate {
  if (!rng) return candidates[0];
  const total = candidates.reduce((sum, c) => sum + Math.min(Math.max(c.weight, 0), MAX_WEIGHT), 0);
  if (total <= 0) return candidates[0];
  let roll = rng.next() * total;
  for (const c of candidates) {
    roll -= Math.min(Math.max(c.weight, 0), MAX_WEIGHT);
    if (roll <= 0) return c;
  }
  return candidates[candidates.length - 1];
}

function hasAnyRole(active: ReadonlySet<OpeningRole>, roles: readonly OpeningRole[]): boolean {
  return roles.some((role) => active.has(role));
}

function textureFits(entry: OpeningTextureEntry, active: ReadonlySet<OpeningRole>): boolean {
  if (entry === 'none') return true;
  return hasAnyRole(active, TEXTURE_ROLE_SUPPORT[entry]);
}

function adaptTexture(entry: OpeningTextureEntry, style: string, active: ReadonlySet<OpeningRole>): OpeningTextureEntry {
  if (textureFits(entry, active)) return entry;
  const fallback = STYLE_TEXTURE_FALLBACKS[styleKey(style)] ?? STYLE_TEXTURE_FALLBACKS.default;
  return fallback.find((candidate) => textureFits(candidate, active)) ?? 'none';
}

function adaptDrum(entry: OpeningDrumEntry, active: ReadonlySet<OpeningRole>): OpeningDrumEntry {
  return active.has('drum') ? entry : 'none';
}

function filterRoleDelays(
  delays: Partial<Record<OpeningRole, number>>,
  active: ReadonlySet<OpeningRole>,
  maxDelayBars = 4,
): Partial<Record<OpeningRole, number>> {
  const out: Partial<Record<OpeningRole, number>> = {};
  for (const role of ROLE_ORDER) {
    if (!active.has(role)) continue;
    const raw = delays[role] ?? 0;
    out[role] = Math.max(0, Math.min(maxDelayBars, Math.round(raw)));
  }
  return out;
}

export function planOpeningGesture(
  sections: readonly Section[],
  band: BandSpec,
  rng?: Rng,
): OpeningGesturePlan {
  const first = sections[0];
  const style = styleKey(band.style);
  const candidate = weightedPick(STYLE_CANDIDATES[style] ?? STYLE_CANDIDATES.default, rng);
  const active = new Set<OpeningRole>(band.instrumentPool);
  const hasDedicatedOpeningSection = first?.role === 'intro' || first?.functionTag === 'setup';

  return {
    sectionId: first?.id ?? 'intro',
    mode: candidate.mode,
    drumEntry: adaptDrum(candidate.drumEntry, active),
    // 当前 texture owner 是 section 级；core 首段不能把一小节开场色彩冒充成整段织体，
    // 尤其不能污染 repeatGroup 源段并被后续 replay 整段复制。
    textureEntry: hasDedicatedOpeningSection
      ? adaptTexture(candidate.textureEntry, style, active)
      : 'none',
    // core 通常按 4-bar brick 组织：仍保留首小节 staged entry，但不从 brick 中腹硬切入。
    roleDelayBars: filterRoleDelays(candidate.roleDelayBars, active, hasDedicatedOpeningSection ? 4 : 1),
    pickupBars: candidate.pickupBars,
    intensity: candidate.intensity,
  };
}
