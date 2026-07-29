// ============================================================
// export-afe-instrumentation-kb — P2-7 步b：L4 器配 KB/oracle 冻结导出
// ------------------------------------------------------------
// 设计 docs/afe_p2_7_instrumentation_design.md §4。原则：
//   · 一切可经公开 API 求值的面 → 运行时求值导出（不转录私有实现）；
//   · 私有 const 表（DRUM_PERFORMANCE_FAMILIES 键 / PIANO_EXPRESSION / REGISTER_BY_ROLE）
//     → 源码正则提取（标识符类含 0-9）+ 计数完备断言 + 运行时 API 交叉校验；
//   · 浮点面（texture density/energy）→ IEEE754 位型 hex；候选集在 TS 侧按生产
//     过滤谓词预演算并与 pickTextureForBar 捕获交叉校验（fail-closed）。
// 产物：
//   core/data/src/instrumental/afe_instrumentation_kb.json      （KB 数据）
//   core/data/src/instrumental/afe_instrumentation_oracle.json  （步c 值域穷举 oracle）
// ============================================================
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import {
  instrumentInfo, timbreSource, isPolyphonic, isSustainedInstrument, canPlayComp,
  isKeyboardFamily, isBassRoleProgram, preferredRegisterForRole, sameFamilyAlternates,
  dream5504OrchestrationBank,
} from '../src/core/generation/newEngine/knowledge/instruments';
import {
  CHAIN_PROFILES, chooseOrchestrationChain, isHarshLead,
  type EnsembleWorldId,
} from '../src/core/generation/newEngine/knowledge/gmOrchestrationChains';
import type { TimbreWorld } from '../src/core/generation/newEngine/knowledge/instruments';
import {
  TEXTURE_POOL, TEXTURE_BEHAVIOR, GENERIC_TEXTURE_YIELD, DELAYED_ENTRY_TEXTURES,
  pickGenericTexture, pickTextureForBar, densityForCell, energyForCell,
  rateTextureTransition,
  type TextureStyleName, type PhraseCellRole, type SectionLabel,
} from '../src/core/generation/newEngine/knowledge/textureProfiles';
import { mixForProgram, pickSpaceProfile, isDream5504DryBaselineStyle, DREAM5504_DEFAULT_CHANNEL_VOLUME, type SpaceProfile } from '../src/core/generation/newEngine/knowledge/gmMixProfile';
import { drumGrooveVariants, drumPerformanceVariants, type GrooveKind, type DrumHit } from '../src/core/generation/newEngine/knowledge/grooves';
import {
  ACOUSTIC_SUBSET_RELEASES, ACTIVE_ACOUSTIC_SUBSETS, ACOUSTIC_TEMPLATE_VOICES,
  ACOUSTIC_DEBUG_DRUM_KITS, applyAcousticDebugPalette, isActiveAcousticMelodicVoice,
  isActiveAcousticDrumProgram,
} from '../src/core/generation/newEngine/instrumental/acousticDebugPalette';
import { ACG_PIANOSONG_PIANO_VOICES, mapProgramToDream5504, selectGMBK5X128Voice, isAcousticPianoVoice, type GM128Role } from '../src/core/sound/GMBK5X128Voices';
import { gestureExpressionForProgram } from '../src/core/generation/newEngine/instrumental/gestureExpression';
import type { InstrumentRoleName } from '../src/core/generation/newEngine/band/BandSpec';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', '..', 'core', 'data', 'src', 'instrumental');
const PLANNER_SRC = readFileSync(join(HERE, '..', 'src', 'core', 'generation', 'newEngine', 'instrumental', 'instrumentalPlanner.ts'), 'utf-8');
const GROOVES_SRC = readFileSync(join(HERE, '..', 'src', 'core', 'generation', 'newEngine', 'knowledge', 'grooves.ts'), 'utf-8');
const MIX_SRC = readFileSync(join(HERE, '..', 'src', 'core', 'generation', 'newEngine', 'knowledge', 'gmMixProfile.ts'), 'utf-8');
const BAND_SRC = readFileSync(join(HERE, '..', 'src', 'core', 'generation', 'newEngine', 'band', 'bandEngine.ts'), 'utf-8');

const die = (m: string): never => { throw new Error(`export-afe-instrumentation-kb FAIL-CLOSED: ${m}`); };
const ALL_STYLES = ['pop', 'jazz', 'lofi', 'rnb', 'modal', 'default', 'acg'] as const; // afe_band_style_t 全域（序无关，C 按名映射）
const ALL_ROLES: readonly InstrumentRoleName[] = ['bass', 'comp', 'pad', 'lead', 'drum']; // afe_role_t 序（≠ TS ALL_ROLES 声明序）
const PROGRAMS = Array.from({ length: 128 }, (_, i) => i);

function dbitsHex(x: number): string {
  const buf = Buffer.alloc(8);
  buf.writeDoubleLE(x, 0);
  return buf.readBigUInt64LE(0).toString(16).padStart(16, '0');
}
const milli = (x: number): number => Math.round(x * 1000);

// ---- ① instruments 求值面（0..127 全域） ----
function buildInstrumentFace() {
  const info = PROGRAMS.map((p) => {
    const i = instrumentInfo(p);
    return { program: p, family: i.family, lo: i.range[0], hi: i.range[1] };
  });
  const source = PROGRAMS.map((p) => timbreSource(p));
  const caps = PROGRAMS.map((p) => ({
    program: p,
    polyphonic: isPolyphonic(p) ? 1 : 0,
    sustained: isSustainedInstrument(p) ? 1 : 0,
    canComp: canPlayComp(p) ? 1 : 0,
    keyboardFam: isKeyboardFamily(p) ? 1 : 0,
    bassRole: isBassRoleProgram(p) ? 1 : 0,
    harshLead: isHarshLead(p) ? 1 : 0,
  }));
  // preferredRegisterForRole 全域 oracle（role×program）
  const register = ALL_ROLES.map((role) => PROGRAMS.map((p) => {
    const [lo, hi] = preferredRegisterForRole(role, p);
    return [lo, hi];
  }));
  return { info, source, caps, register };
}

// ---- ② REGISTER_BY_ROLE / PIANO_EXPRESSION（planner 私有表 → 源码提取 + 计数断言） ----
function extractRegisterByRole(): Record<string, [number, number]> {
  const seg = PLANNER_SRC.match(/REGISTER_BY_ROLE: Record<InstrumentRoleName, RegisterRange> = \{([\s\S]*?)\n\};/);
  if (!seg) die('REGISTER_BY_ROLE 段未找到');
  const rows = [...seg![1].matchAll(/([a-z0-9]+): rr\((\d+), (\d+)\)/g)];
  if (rows.length !== 5) die(`REGISTER_BY_ROLE 行数 ${rows.length} != 5`);
  return Object.fromEntries(rows.map((m) => [m[1], [Number(m[2]), Number(m[3])]]));
}
function extractPianoExpression(): Record<string, Record<string, number>> {
  const seg = PLANNER_SRC.match(/PIANO_EXPRESSION_BY_STYLE[\s\S]*?= \{([\s\S]*?)\n\};/);
  if (!seg) die('PIANO_EXPRESSION_BY_STYLE 段未找到');
  const styles = [...seg![1].matchAll(/([a-z0-9]+): \{ ([^}]+) \}/g)];
  if (styles.length !== 5) die(`PIANO_EXPRESSION 风格数 ${styles.length} != 5`);
  const out: Record<string, Record<string, number>> = {};
  for (const s of styles) {
    const kv = [...s[2].matchAll(/([a-zA-Z0-9]+): (\d+)/g)];
    if (kv.length !== 6) die(`PIANO_EXPRESSION[${s[1]}] 键数 ${kv.length} != 6`);
    out[s[1]] = Object.fromEntries(kv.map((m) => [m[1], Number(m[2])]));
  }
  return out;
}

// ---- ③ texture 面：POOL(位型) + BEHAVIOR + 候选集预演算（生产捕获交叉校验） ----
const TEX_SLOTS = [
  { key: 'low', phraseRole: 'establish' as PhraseCellRole, section: 'VERSE' as SectionLabel },
  { key: 'high', phraseRole: 'lift' as PhraseCellRole, section: 'CHORUS' as SectionLabel },
  { key: 'var', phraseRole: 'develop' as PhraseCellRole, section: 'VERSE' as SectionLabel },
];
const RICH_STYLES: TextureStyleName[] = ['POP', 'RNB', 'JAZZ', 'LOFI', 'ACG'];
function buildTextureFace() {
  if (TEXTURE_POOL.length !== 51) die(`TEXTURE_POOL ${TEXTURE_POOL.length} != 51`);
  if (Object.keys(TEXTURE_BEHAVIOR).length !== 51) die('TEXTURE_BEHAVIOR != 51');
  const pool = TEXTURE_POOL.map((t) => ({
    id: t.id, textureCase: t.textureCase, styles: t.styles, mood: t.mood,
    phraseRoles: t.phraseRoles,
    densityBits: [dbitsHex(t.densityRange[0]), dbitsHex(t.densityRange[1])],
    energyBits: [dbitsHex(t.energyRange[0]), dbitsHex(t.energyRange[1])],
    avoidOnDominantChain: t.avoidOnDominantChain ? 1 : 0,
  }));
  const behavior = Object.values(TEXTURE_BEHAVIOR).map((b) => ({
    textureCase: b.textureCase, family: b.family, continuity: b.continuity,
    delayedEntry: DELAYED_ENTRY_TEXTURES.has(b.textureCase) ? 1 : 0,
  }));
  if (behavior.filter((b) => b.delayedEntry).length !== 4) die('DELAYED_ENTRY != 4');
  // 候选集：按生产过滤谓词预演算（density/energy 为常量），与 pickTextureForBar 捕获逐一交叉校验
  const candidateSets: Array<{ style: TextureStyleName; slot: string; dom: number; cases: string[] }> = [];
  const fallbackPools: Array<{ style: TextureStyleName; cases: string[] }> = [];
  for (const style of RICH_STYLES) {
    const fb = TEXTURE_POOL.filter((t) => t.styles.includes(style) && !DELAYED_ENTRY_TEXTURES.has(t.textureCase))
      .map((t) => t.textureCase);
    fallbackPools.push({ style, cases: fb });
    for (const slot of TEX_SLOTS) {
      const density = densityForCell(slot.phraseRole, slot.section);
      const energy = energyForCell(slot.phraseRole, slot.section);
      for (const dom of [0, 1]) {
        const replica = TEXTURE_POOL.filter((t) => {
          if (DELAYED_ENTRY_TEXTURES.has(t.textureCase)) return false;
          if (!t.styles.includes(style)) return false;
          if (!t.phraseRoles.includes(slot.phraseRole)) return false;
          if (density < t.densityRange[0] || density > t.densityRange[1]) return false;
          if (energy < t.energyRange[0] || energy > t.energyRange[1]) return false;
          if (t.avoidOnDominantChain && dom === 1) return false;
          return true;
        }).map((t) => t.textureCase);
        // 生产捕获：fake random 捕 pickTextureForBar 的 effective pool
        let captured: string[] = [];
        pickTextureForBar({
          style, phraseRole: slot.phraseRole, density, energy, isDominantChain: dom === 1,
          exclude: DELAYED_ENTRY_TEXTURES,
          random: { pick<T>(xs: readonly T[]): T { captured = (xs as unknown as { textureCase: string }[]).map((x) => x.textureCase); return xs[0]; } },
        });
        const effective = replica.length > 0 ? replica : fb;
        if (JSON.stringify(captured) !== JSON.stringify(effective)) {
          die(`候选集复算 ≠ 生产捕获: ${style}/${slot.key}/dom=${dom}`);
        }
        candidateSets.push({ style, slot: slot.key, dom, cases: replica });
      }
    }
  }
  // 段级切换兼容矩阵（rateTextureTransition 51×51 全域求值：C 侧仅消费 rating=='allow'）
  const names = Object.keys(TEXTURE_BEHAVIOR);
  const transitionAllow = names.map((from) => names.map((to) => (rateTextureTransition(from, to).rating === 'allow' ? 1 : 0)));
  const genericTexture = {
    yield: GENERIC_TEXTURE_YIELD,
    byRole: Object.fromEntries((['intro', 'verse', 'chorus', 'bridge', 'outro'] as const).map((r) => [r, pickGenericTexture(r)])),
  };
  return { pool, behavior, candidateSets, fallbackPools, transitionAllow, transitionNames: names, genericTexture };
}

// ---- ④ chains（17 profile 求值导出 + world→profile 经公开 API 派生） ----
const ALL_WORLDS: TimbreWorld[] = ['acousticPianoBand', 'brightPopHybrid', 'electricKeys', 'lofiTapeKeys', 'jazzCombo', 'modalAmbient', 'syntheticSoft'];
function buildChainFace() {
  const keys = Object.keys(CHAIN_PROFILES);
  if (keys.length !== 17) die(`CHAIN_PROFILES ${keys.length} != 17`);
  const profiles = keys.map((k) => {
    const p = CHAIN_PROFILES[k];
    return {
      key: k, id: p.id, world: p.world,
      compPriority: p.compPriority, leadByComp: p.leadByComp,
      bassPriority: p.bassPriority, padPriority: p.padPriority, drumPriority: p.drumPriority,
      sharedInstrumentRoleGroups: p.sharedInstrumentRoleGroups ?? null,
      registerByRole: p.registerByRole ?? null,
    };
  });
  const dummyRng = { next: () => 0, int: () => 0, pick: <T>(xs: readonly T[]): T => xs[0] };
  const profileByWorld = Object.fromEntries(ALL_WORLDS.map((w) => [w, chooseOrchestrationChain('pop', dummyRng, w).id]));
  return { profiles, profileByWorld };
}

// ---- ⑤ mix：私有表提取（计数断言 + oracle 全域兜底） + 求值表 ----
function extractRoleBase(): Record<string, Record<string, number>> {
  const seg = MIX_SRC.match(/ROLE_BASE: Record<InstrumentRoleName, RoleMix> = \{([\s\S]*?)\n\};/);
  if (!seg) die('ROLE_BASE 段未找到');
  const rows = [...seg![1].matchAll(/([a-z0-9]+): \{ ([^}]+) \}/g)];
  if (rows.length !== 5) die(`ROLE_BASE 行数 ${rows.length} != 5`);
  return Object.fromEntries(rows.map((m) => [m[1],
    Object.fromEntries([...m[2].matchAll(/([a-z0-9]+): (\d+)/g)].map((kv) => [kv[1], Number(kv[2])]))]));
}
function extractProgramMix(): Array<{ program: number; role: string; fields: Record<string, number> }> {
  const seg = MIX_SRC.match(/PROGRAM_MIX: Record<number, ProgOverride> = \{([\s\S]*?)\n\};/);
  if (!seg) die('PROGRAM_MIX 段未找到');
  const out: Array<{ program: number; role: string; fields: Record<string, number> }> = [];
  const progs = new Set<number>();
  for (const e of seg![1].matchAll(/(\d+): \{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
    const program = Number(e[1]);
    progs.add(program);
    for (const r of e[2].matchAll(/(comp|lead|bass|pad|drum): \{([^{}]*)\}/g)) {
      const fields = Object.fromEntries([...r[2].matchAll(/([a-z0-9]+): (\d+)/g)].map((kv) => [kv[1], Number(kv[2])]));
      if (Object.keys(fields).length === 0) die(`PROGRAM_MIX[${program}].${r[1]} 空字段`);
      out.push({ program, role: r[1], fields });
    }
  }
  if (progs.size !== 34) die(`PROGRAM_MIX 键数 ${progs.size} != 34`);
  return out;
}
function extractSpaceReverbScale(): Record<string, string> {
  const seg = MIX_SRC.match(/SPACE_REVERB_SCALE: Record<SpaceProfile, number> = \{\n?\s*([^}]*)\n?\};/);
  if (!seg) die('SPACE_REVERB_SCALE 段未找到');
  const rows = [...seg![1].matchAll(/([a-zA-Z0-9]+): ([0-9.]+)/g)];
  if (rows.length !== 6) die(`SPACE_REVERB_SCALE 行数 ${rows.length} != 6`);
  return Object.fromEntries(rows.map((m) => [m[1], m[2]]));
}
function extractAccompDensityPermille(): Record<string, number> {
  const seg = BAND_SRC.match(/STYLE_PROFILES: Record<string, StyleProfile> = \{([\s\S]*?)\n\};/);
  if (!seg) die('STYLE_PROFILES 段未找到');
  const rows = [...seg![1].matchAll(/([a-z0-9]+): \{ accompDensity: ([0-9.]+)/g)];
  if (rows.length !== 7) die(`STYLE_PROFILES 行数 ${rows.length} != 7`);
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  return Object.fromEntries(rows.map((m) => [m[1], milli(clamp01(Number(m[2])))]));
}
function buildMixFace() {
  // 干声域断言（pop/lofi/jazz/rnb）：恒 volume=100/reverb=0/chorus=0（pan 由规则）
  for (const s of ['pop', 'lofi', 'jazz', 'rnb']) {
    if (!isDream5504DryBaselineStyle(s)) die(`${s} 应为干声域`);
  }
  if (isDream5504DryBaselineStyle('acg') || isDream5504DryBaselineStyle('modal') || isDream5504DryBaselineStyle('default')) die('非干声域误判');
  // 非干声域 mixForProgram 全枚举 oracle：style×world×role×program×hasPad
  const rows: number[][] = []; // [styleIdx, worldIdx, roleIdx, program, hasPad, vol, pan, rev, cho]
  const NON_DRY = ['acg', 'modal', 'default'] as const;
  for (let si = 0; si < NON_DRY.length; si++) {
    for (let wi = 0; wi < ALL_WORLDS.length; wi++) {
      for (let ri = 0; ri < ALL_ROLES.length; ri++) {
        for (const p of PROGRAMS) {
          for (const hasPad of [0, 1]) {
            const space = pickSpaceProfile(NON_DRY[si], ALL_WORLDS[wi], hasPad === 1);
            const m = mixForProgram({ style: NON_DRY[si], timbreWorld: ALL_WORLDS[wi], role: ALL_ROLES[ri], program: p, hasPad: hasPad === 1, space });
            if (m.delay !== undefined || m.expression !== undefined) die('delay/expression 意外产出');
            rows.push([si, wi, ri, p, hasPad, m.volume, m.pan, m.reverb, m.chorus]);
          }
        }
      }
    }
  }
  // 干声域 pan 规则 oracle（4 style 恒同 → 按 role×hasPad 8 行）
  const dryPan: number[][] = [];
  for (let ri = 0; ri < ALL_ROLES.length; ri++) {
    for (const hasPad of [0, 1]) {
      const m = mixForProgram({ style: 'pop', timbreWorld: 'acousticPianoBand', role: ALL_ROLES[ri], program: 0, hasPad: hasPad === 1, space: 'dryFront' });
      if (m.volume !== DREAM5504_DEFAULT_CHANNEL_VOLUME || m.reverb !== 0 || m.chorus !== 0) die('干声基线漂移');
      dryPan.push([ri, hasPad, m.pan]);
    }
  }
  // space 选择 oracle：非干声 style×world×hasPad
  const spaceIds: SpaceProfile[] = ['popWarmRoom', 'lofiTapeRoom', 'rnbPlateRoom', 'jazzClub', 'dryFront', 'syntheticSoftRoom'];
  const spacePick: number[][] = [];
  for (let si = 0; si < NON_DRY.length; si++) {
    for (let wi = 0; wi < ALL_WORLDS.length; wi++) {
      for (const hasPad of [0, 1]) {
        spacePick.push([si, wi, hasPad, spaceIds.indexOf(pickSpaceProfile(NON_DRY[si], ALL_WORLDS[wi], hasPad === 1))]);
      }
    }
  }
  // ending exit-bar round 表（域 0..48 = AFE_GROOVE_MAX_BARS_PER_SECTION）
  const endingRound = {
    c034: Array.from({ length: 49 }, (_, n) => Math.max(1, Math.round(n * 0.34))),
    c060: Array.from({ length: 49 }, (_, n) => Math.max(1, Math.round(n * 0.6))),
    c080: Array.from({ length: 49 }, (_, n) => Math.max(1, Math.round(n * 0.8))),
  };
  // reverb×scale 求值表（TS binary64 一次到位；C 只查表——scale 常量提取仅存证）
  const scaleConsts = extractSpaceReverbScale();
  const spaceIdsAll: SpaceProfile[] = ['popWarmRoom', 'lofiTapeRoom', 'rnbPlateRoom', 'jazzClub', 'dryFront', 'syntheticSoftRoom'];
  const spaceReverbRound = Object.fromEntries(spaceIdsAll.map((sp) => [sp,
    PROGRAMS.map((r) => Math.round(r * Number(scaleConsts[sp])))]));
  const kbPart = {
    roleBase: extractRoleBase(),
    programMix: extractProgramMix(),
    spaceReverbScaleSrc: scaleConsts,
    spaceReverbRound,
    endingRound,
    densityCeilingPermille: extractAccompDensityPermille(),
  };
  const oraclePart = { nonDryStyles: [...NON_DRY], worlds: ALL_WORLDS, roles: [...ALL_ROLES], mixOracle: rows, dryPan, spaceIds, spacePick };
  return { kbPart, oraclePart };
}

// ---- ⑥ drum grooves + performance families（求值 hits；键 = 源码提取 + 27 断言） ----
function extractFamilyKeys(): string[] {
  const seg = GROOVES_SRC.match(/DRUM_PERFORMANCE_FAMILIES: Record<string, DrumHit\[\]\[\]> = \{([\s\S]*?)\n\};/);
  if (!seg) die('DRUM_PERFORMANCE_FAMILIES 段未找到');
  const keys = [...seg![1].matchAll(/'([a-z0-9-]+)':/g)].map((m) => m[1]);
  if (keys.length !== 27) die(`family 键数 ${keys.length} != 27`);
  return keys;
}
const hitRow = (h: DrumHit): number[] => [h.drum, milli(h.beat), h.vel];
function buildDrumFace() {
  const grooveStyles = ['pop', 'rnb', 'lofi', 'jazz'];
  const kinds: GrooveKind[] = ['sparse', 'laidback', 'straight', 'driving'];
  const grooves = grooveStyles.map((s) => ({
    style: s,
    kinds: kinds.map((k) => ({ kind: k, variants: drumGrooveVariants(s, k).map((v) => v.map(hitRow)) })),
  }));
  const familyKeys = extractFamilyKeys();
  const families = familyKeys.map((key) => ({
    key, variants: drumPerformanceVariants({ patternFamily: key }).map((v) => v.map(hitRow)),
  }));
  // fallback 语义见证：未知 key → pop/straight
  const fb = drumPerformanceVariants({ patternFamily: '__nonexistent__' }).map((v) => v.map(hitRow));
  const popStraight = drumGrooveVariants('pop', 'straight').map((v) => v.map(hitRow));
  if (JSON.stringify(fb) !== JSON.stringify(popStraight)) die('family fallback ≠ pop/straight');
  return { grooves, families };
}

// ---- ⑦ acoustic palette + ACG 钢琴 + 定向探针 ----
function buildAcousticFace() {
  if (ACOUSTIC_SUBSET_RELEASES.length !== 21) die(`subset releases ${ACOUSTIC_SUBSET_RELEASES.length} != 21`);
  const activeMelodic = PROGRAMS.flatMap((p) => [0, 1, 8, 9, 16, 24].flatMap((b) =>
    (isActiveAcousticMelodicVoice({ bank: b, program: p }) ? [[b, p]] : [])));
  // 权威 active 集合直接从 ACTIVE 子集展开（上面按已知 bank 扫描仅为交叉校验）
  const activeMelodicAuthoritative = ACTIVE_ACOUSTIC_SUBSETS.flatMap((s) => s.melodicVoices.map((v) => [v.bank, v.program]));
  const canon = (xs: number[][]) => JSON.stringify([...xs].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
  if (canon(activeMelodic) !== canon([...new Set(activeMelodicAuthoritative.map((x) => JSON.stringify(x)))].map((s) => JSON.parse(s)))) {
    die('active melodic 扫描 ≠ 子集展开');
  }
  const activeDrums = PROGRAMS.filter((p) => isActiveAcousticDrumProgram(p));
  const templates = Object.entries(ACOUSTIC_TEMPLATE_VOICES).map(([id, t]) => ({
    id,
    comp: t.comp.map((v) => [v.bank, v.program]), lead: t.lead.map((v) => [v.bank, v.program]),
    bass: t.bass.map((v) => [v.bank, v.program]), pad: t.pad.map((v) => [v.bank, v.program]),
    drumProgram: t.drumProgram, sharedPianoRoles: t.sharedPianoRoles ?? null,
  }));
  // applyAcousticDebugPalette 定向探针（步c C 重放）：style×provisional 变化 × intent 有/无
  const probes: Array<{ style: string; provisional: Record<string, number>; intentId: string | null; requestedDrum: number | null; out: unknown }> = [];
  const intentIds = Object.keys(ACOUSTIC_TEMPLATE_VOICES);
  const provisionalCases = [
    { lead: 0, comp: 0, bass: 32 }, { lead: 5, comp: 5, bass: 38 }, { lead: 66, comp: 0, bass: 32 },
    { lead: 108, comp: 25, bass: 33 }, { lead: 1, comp: 4, bass: 39 }, { lead: 42, comp: 1, bass: 43 },
    { lead: 25, comp: 24, bass: 36 }, { lead: 11, comp: 6, bass: 34 },
  ];
  for (const style of ALL_STYLES) {
    for (const prov of provisionalCases) {
      for (const intentId of [null, ...intentIds]) {
        const r = applyAcousticDebugPalette({
          style, lineup: ['bass', 'comp', 'pad', 'lead', 'drum'], provisional: prov,
          requestedDrumProgram: undefined,
          instrumentationIntent: intentId ? ({ id: intentId } as never) : undefined,
          palette: 'acoustic-debug',
        });
        probes.push({ style, provisional: prov, intentId, requestedDrum: null, out: { roleProgram: r.roleProgram, roleBank: r.roleBank, sharedPianoRoles: r.sharedPianoRoles ?? null } });
      }
    }
  }
  const acgVoices = ACG_PIANOSONG_PIANO_VOICES.map((v) => ({ bank: v.bank, program: v.program, weight: v.weight }));
  if (acgVoices.length !== 4) die('ACG voices != 4');
  return {
    kbPart: { drumKits: [...ACOUSTIC_DEBUG_DRUM_KITS], activeMelodic: JSON.parse(canon(activeMelodic)), activeDrums, templates, acgVoices },
    oraclePart: { paletteProbes: probes },
  };
}

// ---- ⑧ gesture / dream5504 map / orchestration bank / alternates oracle ----
function buildOracles() {
  // gestureExpressionForProgram 全域（role×program×style）；evidenceRefs 生产零消费不导
  const gestures: unknown[] = [];
  for (const role of ALL_ROLES) {
    for (const p of PROGRAMS) {
      for (const s of ALL_STYLES) {
        const g = gestureExpressionForProgram(role, p, s);
        gestures.push([role, p, s, g.kind, g.family, g.continuity, g.articulationScope,
          g.articulationExclusionGroup, g.triggerPolicy, g.phrasePolicy, g.breathModel, g.noteShape,
          g.articulation, g.velocityCurve, g.pedalPolicy, g.rudimentPolicy, g.hiHatPolicy,
          g.ccControllers, g.bassTechniques ?? null,
          g.gateRatio === undefined ? null : milli(g.gateRatio),
          g.maxConnectBeats === undefined ? null : milli(g.maxConnectBeats),
          g.overlapBeats === undefined ? null : milli(g.overlapBeats),
          g.tailPolicy ?? null, g.program ?? null]);
      }
    }
  }
  // mapProgramToDream5504 全域（program×role×style）
  const dreamMap: number[][] = [];
  for (let ri = 0; ri < ALL_ROLES.length; ri++) {
    for (const p of PROGRAMS) {
      for (let si = 0; si < ALL_STYLES.length; si++) {
        dreamMap.push([ri, p, si, mapProgramToDream5504(p, ALL_ROLES[ri] as GM128Role, ALL_STYLES[si])]);
      }
    }
  }
  // dream5504OrchestrationBank 全域
  const orchBank: (number | null)[][] = [];
  for (let ri = 0; ri < ALL_ROLES.length; ri++) {
    for (const p of PROGRAMS) {
      for (let si = 0; si < ALL_STYLES.length; si++) {
        const b = dream5504OrchestrationBank(ALL_STYLES[si], ALL_ROLES[ri], p);
        orchBank.push([ri, p, si, b === undefined ? null : b]);
      }
    }
  }
  // sameFamilyAlternates（style×role×program 全域；planner 只用 comp/lead 但导全域省争议）
  const alternates: unknown[] = [];
  for (let si = 0; si < ALL_STYLES.length; si++) {
    for (const role of ['comp', 'lead'] as const) {
      for (const p of PROGRAMS) {
        const alts = sameFamilyAlternates(ALL_STYLES[si], role, p);
        if (alts.length) alternates.push([si, role, p, alts]);
      }
    }
  }
  // isAcousticPianoVoice 见证（bank0×PC{0,1,3} 域）
  const acousticPianoTrue = PROGRAMS.filter((p) => isAcousticPianoVoice(0, p));
  if (JSON.stringify(acousticPianoTrue) !== JSON.stringify([0, 1, 3])) die('isAcousticPianoVoice 域漂移');
  // selectGMBK5X128Voice 定向探针（bank 解析链：显式 bank / bank0 回退 / program 回退）
  const voiceProbes: unknown[] = [];
  const voiceCases: Array<{ role: GM128Role; program: number; bank?: number; style?: string }> = [
    { role: 'comp', program: 5, bank: 16, style: 'pop' }, { role: 'lead', program: 66, bank: 8, style: 'jazz' },
    { role: 'comp', program: 0, bank: 0 }, { role: 'bass', program: 32, bank: 0 },
    { role: 'drum', program: 40 }, { role: 'drum', program: 25 }, { role: 'pad', program: 89, bank: 3 },
    { role: 'lead', program: 4, bank: 8 }, { role: 'comp', program: 1, bank: 0 }, { role: 'bass', program: 0, bank: 0 },
    { role: 'lead', program: 127, bank: 99 }, { role: 'comp', program: 31, bank: 64 },
  ];
  for (const c of voiceCases) {
    const v = selectGMBK5X128Voice({ style: c.style, role: c.role, program: c.program, bank: c.bank });
    voiceProbes.push([c.role, c.program, c.bank ?? null, c.style ?? null, v.program, v.bank ?? null]);
  }
  return { gestures, dreamMap, orchBank, alternates, voiceProbes };
}

// ---- 汇总 ----
describe('export-afe-instrumentation-kb', () => {
  it('exports instrumentation KB + oracle (P2-7 步b)', () => {
    const mixFace = buildMixFace();
    const acousticFace = buildAcousticFace();
    const meta = {
      exporter: 'export-afe-instrumentation-kb.export.test.ts',
      sourceNote: 'P2-7 步b：值域求值 + 私有表源码提取（计数断言）+ 生产 API 交叉校验；设计 docs/afe_p2_7_instrumentation_design.md §4',
      roleOrder: ALL_ROLES, styleOrder: ALL_STYLES,
    };
    const kb = {
      meta,
      instruments: buildInstrumentFace(),
      registerByRole: extractRegisterByRole(),
      pianoExpression: extractPianoExpression(),
      texture: buildTextureFace(),
      chains: buildChainFace(),
      mix: mixFace.kbPart,
      drums: buildDrumFace(),
      acoustic: acousticFace.kbPart,
    };
    const oracle = { meta, mix: mixFace.oraclePart, acoustic: acousticFace.oraclePart, ...buildOracles() };
    mkdirSync(OUT_DIR, { recursive: true });
    const kbJson = JSON.stringify(kb, null, 1) + '\n';
    const oracleJson = JSON.stringify(oracle) + '\n';
    const sha = (s: string) => createHash('sha256').update(s).digest('hex');
    writeFileSync(join(OUT_DIR, 'afe_instrumentation_kb.json'),
      kbJson.replace('"meta": {', `"meta": {\n  "payloadSha256": "${sha(kbJson)}",`));
    writeFileSync(join(OUT_DIR, 'afe_instrumentation_oracle.json'), oracleJson);
    expect(kb.texture.pool.length).toBe(51);
    expect(kb.chains.profiles.length).toBe(17);
    expect(kb.drums.families.length).toBe(27);
    expect(kb.mix.programMix.length).toBeGreaterThanOrEqual(34);
  });
});
