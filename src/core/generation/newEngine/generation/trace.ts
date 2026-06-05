// ============================================================
// newEngine · generation · traceGeneration(观测层)
// ------------------------------------------------------------
// 走遍每个节点层级,把各 stage 实际产出汇成可读流程日志。
// 不污染纯引擎(不在纯函数里 console.log);单独走查 → 同样的逐层可见性。
// ★ render+audit 走真实控制环(runGenerationControl):含 retry/budget/fallback,
//   面板试听 = 真实产品路径(generateSong 同款),日志显示真实 attempts/status。
// ============================================================

import { beats, createRandomContext, createTimebase } from '../foundation';
import { buildBandSpec, type GenerationRequest } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { beatsPerBarOf } from '../arranger/phraseTiming';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { compPattern } from '../knowledge/grooves';
import { pickGrammarName } from '../knowledge/grammarLibrary';
import { gmName } from '../knowledge/instruments';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import type { RomanChord } from '../harmony/HarmonicPlan';
import { runPrepass } from '../render/motifAnchorPrepass';
import { renderSongFull } from '../render/renderCoordinator';
import type { MusicalIR } from '../ir/MusicalIR';
import type { AuditReport } from '../ir/AuditReport';
import { runGenerationControl, type GenerationStatus, type RenderFn } from './GenerationController';
import { DEFAULT_BUDGET } from './RetryPolicy';
import { buildRetryLocator } from './retryMapping';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
function romanLabel(r: RomanChord): string {
  const acc = r.accidental === 'b' ? 'b' : r.accidental === '#' ? '#' : '';
  const sec = r.secondaryTarget ? `/${ROMAN[r.secondaryTarget.degree]}` : '';
  return `${acc}${ROMAN[r.degree]}${r.quality === 'maj' ? '' : r.quality}${sec}`;
}
// ★ Loop 2 后:用【宽 chordType】+ borrowedSource 标记(romanLabel 只印窄品质、不知 borrowed)。
const BORROW_MARK: Record<string, string> = {
  secondary_dominant: '↗副属', secondary_ii_v: '↗ii-V', backdoor_dominant: '⤵backdoor',
  modal_interchange: '◆借', chromatic_color: '◇半音',
};
function spanLabel(span: { roman: RomanChord; quality: string; chordType?: string; borrowedSource?: string }): string {
  const r = span.roman;
  const acc = r.accidental === 'b' ? 'b' : r.accidental === '#' ? '#' : '';
  const ct = span.chordType ?? span.quality;
  const type = ct === 'maj' ? '' : ct; // 宽 chordType(maj9/m9/13sus4…)
  return `${acc}${ROMAN[r.degree]}${type}${span.borrowedSource ? BORROW_MARK[span.borrowedSource] ?? '◆' : ''}`;
}

export interface GenerationTrace {
  lines: string[];
  ir: MusicalIR;
  audit: AuditReport;
  bpm: number;
  attempts: number;        // 控制环真实重跑次数
  status: GenerationStatus; // pass / warning / failed
}

export function traceGeneration(request: GenerationRequest): GenerationTrace {
  const lines: string[] = [];
  const log = (s: string) => lines.push(s);
  const seedRng = createRandomContext(request.seed);

  log(`■ REQUEST    seed=${request.seed}  style=${request.styleHint}  mood=${request.mood}  dur=${request.targetDuration}s`);

  // —— BAND ——
  const band = buildBandSpec(request);
  log(`■ BAND       ${band.tonalityKind}${band.modalModeName ? `(${band.modalModeName})` : ''} · key=${band.key} ${band.mode} · style=${band.style}  (accompDensity=${band.styleProfile.accompDensity} melodyFreedom=${band.styleProfile.melodyFreedom})`);
  log(`   编制(${band.instrumentPool.length}件): ${band.instrumentPool.map((r) => `${r}=GM${band.roleProgram[r]}`).join(' · ')}`);

  // —— ARRANGER ——
  const arrangement = buildArrangementPlan(band, { rng: seedRng });
  const formShape = arrangement.sections.map((s) => s.role).join('-'); // seed 选型曲式骨架
  const totalBars = arrangement.sections.reduce((n, s) => n + s.bars, 0);
  log(`■ ARRANGER   ${arrangement.tempoBpm}bpm ${arrangement.meter.numerator}/${arrangement.meter.denominator} ${arrangement.feel.kind} · 曲式=${formShape}(${arrangement.sections.length}段/${totalBars}小节,seed 选) · 高潮=${arrangement.climaxMap.map((c) => c.sectionId).join(',') || '-'}`);
  log(`   段落: ${arrangement.sections.map((s) => `${s.id}[${s.bars}b${s.repeatGroup ? '·' + s.repeatGroup : ''}·${s.hookPolicy}${s.functionTag ? '·' + s.functionTag : ''}${s.harmonyRole ? '·H:' + s.harmonyRole : ''}${s.linkOut && s.linkOut !== 'none' ? '·→' + s.linkOut : ''}]`).join('  ')}`);
  log(`   乐句 ${arrangement.phrases.length} · 动机绑定 ${arrangement.motifBindings.length}(同 motifId 跨段=排比)`);

  // —— INSTRUMENTAL ——
  const instrumentation = buildInstrumentationPlan(band, arrangement, seedRng.substream('timbre'));
  const samePairs = instrumentation.sameInstrumentPairs?.map((p) => `${p.a}=${p.b}(GM${p.program})`).join(' ');
  log(`■ INSTRUMENT 音色世界=${instrumentation.timbreWorld ?? '-'}${samePairs ? ` · 同乐器对:${samePairs}` : ''}`);
  log(`   织体: ${Object.entries(instrumentation.textureBySection).map(([s, t]) => `${s}=${t}`).join(' ')}`);
  // ★ 音色切换(同乐手换声音):某角色跨段落用了 >1 种 program → 印 verse↔chorus
  const timbreSwitch = band.instrumentPool.map((r) => {
    const bySec = instrumentation.programByRoleSection[r];
    if (new Set(arrangement.sections.map((s) => bySec[s.id])).size <= 1) return null;
    const cho = arrangement.sections.find((s) => s.role === 'chorus');
    const oth = arrangement.sections.find((s) => s.role !== 'chorus');
    return cho && oth ? `${r} ${gmName(bySec[oth.id])}↔chorus ${gmName(bySec[cho.id])}` : null;
  }).filter(Boolean);
  if (timbreSwitch.length) log(`   ★ 音色切换(同乐手换声): ${timbreSwitch.join(' · ')}`);
  const mainHooks = instrumentation.melodyReservationPlan.hookAnchorSlots.filter((h) => h.anchorRequired);
  log(`   主 hook 让位锚点: ${mainHooks.map((h) => `${h.phraseId}@拍${h.beatSlot}`).join(' ') || '-'}`);
  // ★ 编曲密度弧:每段在场乐手(谁进/出)
  log(`   密度弧: ${arrangement.sections.map((s) => `${s.id}{${(instrumentation.activeRolesBySection[s.id] ?? []).join('+')}}`).join('  ')}`);
  // ★ 段落重心诊断:中心段(hook/head/loop)占比 + 回归次数 + 末段能量(听感飘 → 看是否中心占比/复现不够)
  const CENTER_TAGS = ['hook', 'head', 'loop'];
  const centerSecs = arrangement.sections.filter((s) => CENTER_TAGS.includes(s.functionTag ?? ''));
  const centerBars = centerSecs.reduce((n, s) => n + s.bars, 0);
  const allBars = arrangement.sections.reduce((n, s) => n + s.bars, 0);
  const cnt = (tag: string) => arrangement.sections.filter((s) => s.functionTag === tag).length;
  const peakE = Math.max(0, ...arrangement.sections.map((s) => arrangement.energyBySection[s.id] ?? 0));
  const reqAnchors = instrumentation.melodyReservationPlan.hookAnchorSlots.filter((h) => h.anchorRequired).length;
  log(`   重心: centerBars=${centerBars}/${allBars}(${allBars ? Math.round((centerBars / allBars) * 100) : 0}%) hook×${cnt('hook')} loop×${cnt('loop')} head×${cnt('head')} 主锚×${reqAnchors} 末段energy=${peakE.toFixed(2)}`);

  // —— HARMONY ——
  const harmonic = buildHarmonicPlanFromArrangement(band, arrangement, seedRng);
  // ★ borrowed/离调按 span.borrowedSource 统计(prototype 不填 borrowedChordMap)
  const borrowedSpans = harmonic.chordTimeline.filter((c) => c.borrowedSource);
  log(band.tonalityKind === 'modal'
    ? `■ HARMONY    ${harmonic.chordTimeline.length} 和弦(modal 静态 vamp:i+特征和弦循环,无功能;约束放松=avoid 空、chord-scale=primaryScale)`
    : `■ HARMONY    ${harmonic.chordTimeline.length} 和弦(prototype-first 真实编曲进行 + 宽 chordType;不命中回退 degree-picker)${borrowedSpans.length ? ` · 借/离调 ×${borrowedSpans.length}` : ''}`);
  const seenSec = new Set<string>();
  for (const span of harmonic.chordTimeline) {
    if (seenSec.has(span.sectionId)) continue;
    seenSec.add(span.sectionId);
    const inSec = harmonic.chordTimeline.filter((c) => c.sectionId === span.sectionId);
    log(`   ${span.sectionId}: ${inSec.map((c) => spanLabel(c)).join(' ')}`);
  }
  // 借/离调和弦明细(根音 + 类型 + 来源)
  const PCN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  if (borrowedSpans.length) {
    log(`   借/离调: ${borrowedSpans.map((c) => `${c.sectionId} ${PCN[c.rootPc]}${c.chordType ?? c.quality}=${c.borrowedSource}`).join(' · ')}`);
  }
  // 真 chord-scale 采样:首和弦 + 任一借/离调和弦的调式音阶(含离调音)
  const scaleLabel = (id: string) => harmonic.chordScaleMap[id].map((p) => PCN[p]).join(' ');
  const first = harmonic.chordTimeline[0];
  log(`   chord-scale ${spanLabel(first)} = [${scaleLabel(first.id)}](真调式音阶)`);
  const chromId = borrowedSpans[0];
  if (chromId) {
    const sec = chromId.borrowedSource === 'secondary_dominant' || chromId.borrowedSource === 'secondary_ii_v';
    // 离调和弦优先印 forcedScale(planner 显式设的 Mixolydian/Phrygian Dominant/Dorian/Locrian);否则按推导
    const scaleName = chromId.forcedScale ?? (sec ? 'Mixolydian' : 'Dorian');
    const place = chromId.tonicizationPlacement ? ` ${chromId.tonicizationPlacement}` : '';
    log(`   chord-scale ${spanLabel(chromId)} = [${scaleLabel(chromId.id)}](离调${place}:根音 ${scaleName})`);
  }
  for (const [sid, m] of Object.entries(harmonic.modulationMap)) {
    log(`   转调 ${sid}: ${PCN[m.fromKey]}→${PCN[m.toKey]}(${m.label} ${m.semitones > 0 ? '+' : ''}${m.semitones}半音,进行整体移调 + 旋律随升)`);
  }

  // —— PREPASS ——
  const timebase = createTimebase({
    meter: { numerator: arrangement.meter.numerator, denominator: arrangement.meter.denominator },
    tempoMap: [{ atBeat: beats(0), bpm: arrangement.tempoBpm }],
  });
  const { anchorPlan, motifStore } = runPrepass(band, arrangement, harmonic, seedRng);
  log(`■ PREPASS    动机 ${Object.keys(motifStore.motifs).length} 个(种子驱动形状):`);
  for (const [id, m] of Object.entries(motifStore.motifs)) {
    log(`   ${id}: 节奏[${m.rhythmCell.durations.join(',')}] 音级[${m.noteSlots.map((s) => s.scaleDegree).join(',')}] 源=${m.source} grammar=${pickGrammarName(id)}`);
  }
  for (const e of anchorPlan.entries) {
    if (e.commonSafeToneScope === 'global' || e.downgradeReason) {
      log(`   ${e.phraseId}: scope=${e.commonSafeToneScope} 安全音[${e.commonSafeToneSet.join(',')}] 强度 ${e.requestedRestatementStrength}→${e.effectiveRestatementStrength}${e.downgradeReason ? ' (' + e.downgradeReason + ')' : ''}`);
    }
  }

  // —— RENDER + AUDIT(走真实控制环:retry/budget/fallback,与 generateSong 同路径)——
  const render: RenderFn = (retry) =>
    renderSongFull(band, arrangement, harmonic, instrumentation, timebase, retry?.rng ?? seedRng,
      retry && { candidateSwap: retry.candidateSwap, restatementOverride: retry.restatementOverride, voicingSafer: retry.voicingSafer });
  const locator = buildRetryLocator(arrangement, anchorPlan, motifStore, harmonic, timebase);
  const result = runGenerationControl(render, seedRng, DEFAULT_BUDGET, locator);
  const audit = result.report;
  // failed 时控制环不返回 IR → 补渲一次基础版供面板展示/试听(并明确标 failed)
  const ir: MusicalIR = result.ir ?? render(undefined).ir;

  log(`■ RENDER     ${ir.tracks.map((t) => `${t.role}=${t.notes.length}`).join('  ')}  [控制环 ${result.status} · ${result.attempts} 次尝试]`);
  log(`   织体分流: active 段=comp / floating 段(pad/sustained)=pad 长音铺底`);
  log(`   comp 织体: ${band.style}(${compPattern(band.style).length} hits/bar,有律动/切分)· 全声部 voice-leading(贴最近上一声部,声部连贯)`);
  log(`   resolver: voicing-around-melody(comp 与旋律撞小二度/小九度→丢该 comp 声部)+ lead 音域碰撞上移`);
  log(`   bass 行进: ${band.style}(jazz=walking / pop=根-五 / lofi=根音持续)`);
  log(`   drum: ${band.style} groove + 段落转折 fill + 力度人性化`);
  log(`   melody: hook 句=grammar 变体发展 / connector·cadence 句=GuideTone 导音线(贴 3/7,authentic 落 3 音);句尾呼吸 + 音区随能量抬升(高潮冲峰)`);
  log(`   dynamics: 全轨力度随段落能量缩放(chorus 强 / intro 弱 / 高潮峰)`);
  log(`   feel: ${arrangement.feel.kind}(swingRatio ${arrangement.feel.swingRatio}${Math.abs(arrangement.feel.swingRatio - 0.5) < 1e-6 ? ' 直' : ' → offbeat 摆动'})`);
  log(`   humanize: 力度 metric accent(强拍重/反拍软,鼓除外)+ 微随机 + 微时序抖动(±~${Math.max(2, Math.round(480 * 0.015))} tick,审计后施加=网格下层)`);
  const statusLabel = result.status === 'pass' ? 'PASS ✓(全链无 avoid 暴露)'
    : result.status === 'warning' ? `WARNING(${audit.findings.length} findings,带警告通过)`
    : `FAILED(budget 耗尽,${audit.findings.length} findings 未消解 → 不静默输出非法)`;
  log(`■ AUDITOR    ${statusLabel}`);
  if (audit.findings.length > 0) {
    const byRule: Record<string, number> = {};
    for (const f of audit.findings) byRule[f.ruleId] = (byRule[f.ruleId] ?? 0) + 1;
    const errs = audit.findings.filter((f) => f.severity === 'error' || f.severity === 'fatal');
    log(`   findings: ${Object.entries(byRule).map(([k, n]) => `${k}×${n}`).join(' / ')}`);
    if (errs.length > 0) {
      log(`   纠错环(${result.attempts} 次尝试): error@${errs[0].location.trackRole}#${errs[0].location.startTick} → 撞音消解阶梯(voicing→降锁→换hook→fallback)`);
    } else {
      log(`   (均 warning 级:离调/撞音/note-context-avoid 安全网,信息性不阻断;avoid 判据走【统一评判器 evaluateNoteInChordContext】Layer A 和弦+Layer B 调性融合)`);
    }
  }
  const bars = Math.round(ir.durationTicks / (480 * beatsPerBarOf(arrangement.meter)));
  log(`■ 总长       ${bars} 小节 @ ${arrangement.tempoBpm}bpm`);
  log(`■ MIX        音量分层 lead120>bass112>drum100>comp90>pad68(CC7)· 声像 comp 偏左/pad 偏右/骨干居中(CC10)`);

  return { lines, ir, audit, bpm: arrangement.tempoBpm, attempts: result.attempts, status: result.status };
}
