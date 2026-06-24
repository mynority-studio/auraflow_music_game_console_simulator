// ============================================================
// motifSandbox · model · 审计 + quote 校验
// ------------------------------------------------------------
// 校验:第一槽原样 motif(head)、真有发展(developVariants>1 不是复制)、密度/留白、
//   非 jazz diatonic、跳进/jazziness。
// ============================================================

import type { MotifNote, MotifOccurrence, MotifWeaveAudit, ScaleMode, UserMotif } from './types';
import type { SandboxTonality } from './sandboxScales';
import { isInScale } from './scale';
import { fitRange, identity } from './motifTransform';
import { chordAtBeat, effectiveTonePcs, type SandboxChord } from './chords';
import { buildPitchContractContext, contractAtBeat, classifyMelodyNoteAgainstContract, isStructuralMelodyNote, isBlueColorPc } from './pitchContract';

const EPS = 1e-6;
const BAR = 4;
const LEAD_LOW = 60, LEAD_HIGH = 84;
const mod12 = (n: number): number => ((n % 12) + 12) % 12;

/** 某 startBeat 处是否原样复现 refNotes(逐音 onset 相对 + pitch)。 */
function quotedAt(lead: readonly MotifNote[], refNotes: readonly MotifNote[], startBeat: number): boolean {
  for (const m of refNotes) {
    const want = startBeat + m.onsetBeat;
    if (!lead.find((n) => Math.abs(n.onsetBeat - want) < EPS && n.midi === m.midi)) return false;
  }
  return true;
}

/** 最早 quote occurrence 原样陈述 motif【前缀】(放多少匹配多少;slot 截断 → 前缀到此;A B A B 变奏遍不查此)。
 *  —— 主题陈述只要 exposition 把 motif 头原样唱出即成立,不要求整段;变奏遍(改音)在头部出现即判否(故只查最早遍)。 */
function quotedPrefixAt(lead: readonly MotifNote[], refNotes: readonly MotifNote[], startBeat: number): boolean {
  let matched = 0;
  for (const m of refNotes) {
    const found = lead.find((n) => Math.abs(n.onsetBeat - (startBeat + m.onsetBeat)) < EPS && n.occurrenceKind === 'quote');
    if (!found) break;                 // slot 截断 → 前缀到此为止
    if (found.midi !== m.midi) return false; // quote 音必须原样(变奏遍头部就会 ≠)
    matched++;
  }
  return matched >= 1;                  // 至少把主题头原样唱出
}

export function auditMotifWeave(
  lead: readonly MotifNote[],
  motif: UserMotif,
  occurrences: readonly MotifOccurrence[],
  keyPc: number,
  mode: ScaleMode,
  ctx: { totalBars: number; quoteBeats?: number; progression?: readonly SandboxChord[]; inputTonality?: SandboxTonality },
): MotifWeaveAudit {
  const sorted = [...lead].sort((a, b) => a.onsetBeat - b.onsetBeat);
  let maxLeap = 0;
  for (let i = 1; i < sorted.length; i++) maxLeap = Math.max(maxLeap, Math.abs(sorted[i].midi - sorted[i - 1].midi));
  const chromatic = sorted.filter((n) => !isInScale(n.midi, keyPc, mode)).length;
  const chromaticRatio = sorted.length ? chromatic / sorted.length : 0;
  // ★ 不【证成】的离调音:既不在调内、也不是用户原样陈述(quote 含 blues/五声特征)、也不是
  //   当拍【真实和声】(选中模板的 realTonePcs,含次属/借)的和弦音 → 才算"真离调"。非 jazz 应=0。
  const unjustifiedChromatic = sorted.filter((n) => {
    if (n.occurrenceKind === 'quote') return false;
    if (isInScale(n.midi, keyPc, mode)) return false;
    const ch = ctx.progression ? chordAtBeat(ctx.progression, n.onsetBeat) : undefined;
    return !(ch && effectiveTonePcs(ch).includes(mod12(n.midi)));
  }).length;
  const dense = sorted.filter((n) => n.durationBeat <= 0.25 + EPS).length;
  // jazziness 用【不证成】的离调比,而非全部离调 —— 和声证成的色彩(次属/七和弦)不算 jazzy。
  const jazzinessScore = Math.min(1, (sorted.length ? unjustifiedChromatic / sorted.length : 0) * 0.6 + (sorted.length ? dense / sorted.length : 0) * 0.3 + Math.min(1, Math.max(0, maxLeap - 9) / 8) * 0.1);

  // ★ 按【实际 quote 单元】校验(长 motif 会缩成 ≤2 小节子动机)—— 否则用完整 motif 会误报 ✗。
  //   slot-plan 驱动后 quote 落点来自 RoadMap(不一定 beat0;短 brick 会裁剪)→ 只要【某个 quote
  //   occurrence】原样含完整 quote 单元即算成立(旧乐句循环=beat0 也满足)。
  const qBeats = ctx.quoteBeats ?? Infinity;
  const refQuote = fitRange(identity(motif.notes), LEAD_LOW, LEAD_HIGH).filter((n) => n.onsetBeat < qBeats - 1e-6);
  // ★ A B A B(2026-06-22):只查【最早】quote occurrence(= exposition,永远原样);它原样唱出 motif 前缀即成立。
  //   (后续偶数遍也原样、奇数遍微变化;不能用 some(quotedAt) —— 变奏遍会让"全原样"判否。)
  const firstQuote = occurrences.filter((o) => o.kind === 'quote').sort((a, b) => a.startBeat - b.startBeat)[0];
  const motifQuotedFirstCycle = firstQuote ? quotedPrefixAt(lead, refQuote, firstQuote.startBeat) : false;

  const themeStatements = occurrences.filter((o) => o.kind === 'quote' || o.kind === 'develop').length;
  const developVariants = new Set(occurrences.filter((o) => o.kind === 'develop').map((o) => o.label)).size;
  const connectSlots = sorted.filter((n) => n.occurrenceKind === 'connect').length; // 连接留白音数(透气)
  const notesPerBar = ctx.totalBars ? sorted.length / ctx.totalBars : 0;
  const sounding = sorted.reduce((a, n) => a + n.durationBeat, 0);
  const restRatio = Math.max(0, 1 - sounding / (ctx.totalBars * BAR));

  // —— 音高合同审计(blues contract Phase 5):逐音对【每和弦合同】分类,统计支持/不支持 ——
  let structuralUnsupported = 0, weakUnsupported = 0, quoteStructuralUnsupported = 0, blueColorStructuralSupported = 0, supported = 0;
  if (ctx.progression && ctx.progression.length) {
    const pctx = buildPitchContractContext({ progression: ctx.progression, keyPc, mode, inputTonality: ctx.inputTonality });
    for (let i = 0; i < sorted.length; i++) {
      const n = sorted[i];
      const contract = contractAtBeat(pctx, n.onsetBeat);
      const isBlue = ctx.inputTonality ? isBlueColorPc(mod12(n.midi), keyPc, ctx.inputTonality) : false;
      // ★ followup 2.2:传 prev/next(approach 解决校验)。
      const cls = classifyMelodyNoteAgainstContract({ note: n, prev: sorted[i - 1], next: sorted[i + 1], contract, isBlue });
      const struct = isStructuralMelodyNote(n);
      // ★ followup 2.3:quote 的结构音不被支持 → 记 quoteStructuralUnsupported(和声没接住用户 motif,不 mutate quote);
      //   非 quote 结构不支持 → structuralUnsupported(全风格 fail)。
      if (cls === 'unsupported-structural') { if (n.occurrenceKind === 'quote') quoteStructuralUnsupported++; else structuralUnsupported++; }
      else if (cls === 'unsupported-weak') weakUnsupported++;
      else { supported++; if (isBlue && struct && (cls === 'structural-supported' || cls === 'color-supported')) blueColorStructuralSupported++; }
    }
  }
  const bluesSeasonedChordCount = (ctx.progression ?? []).filter((c) => c.bluesSeasoned).length;
  const contractPassRatio = sorted.length ? supported / sorted.length : 1;

  // —— 新手治愈审计(beginner healing Phase 1):从 motif 音的标签统计(治愈在分析层做) ——
  const articulationGapsHealed = motif.notes.filter((n) => n.healingTags?.includes('gap-healed-legato')).length;
  const intentionalRepeatStaccatoCount = motif.notes.filter((n) => n.healingTags?.includes('intentional-repeat-staccato')).length;

  return {
    motifQuotedFirstCycle,
    themeStatements,
    developVariants,
    connectSlots,
    notesPerBar,
    restRatio,
    maxLeap,
    chromaticRatio,
    unjustifiedChromatic,
    jazzinessScore,
    structuralUnsupported,
    weakUnsupported,
    quoteStructuralUnsupported,
    blueColorStructuralSupported,
    bluesSeasonedChordCount,
    contractPassRatio,
    articulationGapsHealed,
    intentionalRepeatStaccatoCount,
    captureBpmUsedForTimingOnly: true, // ★ playbackBpm = generation snapshot;capture BPM 仅 ms→beat
  };
}

export { quotedAt };
