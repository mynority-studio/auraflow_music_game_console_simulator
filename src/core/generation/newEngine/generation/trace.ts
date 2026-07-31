// ============================================================
// newEngine · generation · traceGeneration(观测层)
// ------------------------------------------------------------
// 走遍每个节点层级,把各 stage 实际产出汇成可读流程日志。
// 不污染纯引擎(不在纯函数里 console.log);单独走查 → 同样的逐层可见性。
// ★ render+audit 走真实控制环(runGenerationControl):含 retry/budget/fallback,
//   面板试听 = 真实产品路径(generateSong 同款),日志显示真实 attempts/status。
// ============================================================

import { beats } from '../foundation';
import type { GenerationRequest } from '../band/bandEngine';
import { beatsPerBarOf } from '../arranger/phraseTiming';
import { deriveMusicIntentPlan } from '../arranger/deriveMusicIntentPlan';
import { compPattern } from '../knowledge/grooves';
import { dream5504VoiceName, type GM128Role } from '../../../sound/GMBK5X128Voices';
import type { RomanChord } from '../harmony/HarmonicPlan';
import { renderSongFull } from '../render/renderCoordinator';
import { leadGrammarLabelForStyle, renderMgMelody } from '../render/mgLeadRenderer';
import { planRepeatGroupReplays } from '../render/repeatGroupReplay';
import { planLeadGapFills } from '../render/leadGapFill';
import type { MusicalIR } from '../ir/MusicalIR';
import type { AuditReport } from '../ir/AuditReport';
import { buildSongBundle, runGenerationControl, type GenerationStatus, type RenderFn } from './GenerationController';
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

const roleVoiceName = (role: string, program: number | undefined, bank?: number): string =>
  dream5504VoiceName(bank, program, role as GM128Role) ?? `Dream5504 PC${program ?? 0}`;

export interface TraceSection {
  id: string;
  role: string;       // intro | verse | chorus | bridge | outro
  startTick: number;
  endTick: number;
  bars: number;
}

export interface GenerationTrace {
  lines: string[];
  ir: MusicalIR;
  audit: AuditReport;
  bpm: number;
  attempts: number;        // 控制环真实重跑次数
  status: GenerationStatus; // pass / warning / failed
  sections: TraceSection[]; // 段落骨架(piano-roll DAW 视图段落标尺用)
}

export function traceGeneration(request: GenerationRequest): GenerationTrace {
  const lines: string[] = [];
  const log = (s: string) => lines.push(s);
  // Trace must observe the same immutable ACG phrase score as production.  In
  // particular, the score carries the factual functional RoadMap that a
  // direct render fallback cannot reconstruct at this layer.
  const { band, arrangement, harmonic, instrumentation, acgPianoScorePlan, lofiLeadScorePlan, jazzFiveFourScorePlan, timebase, seedRng } = buildSongBundle(request);

  log(`■ REQUEST    seed=${request.seed}  style=${request.styleHint}  mood=${request.mood}  dur=${request.targetDuration}s`);

  // —— BAND ——
  log(`■ BAND       ${band.tonalityKind}${band.modalModeName ? `(${band.modalModeName})` : ''} · key=${band.key} ${band.mode} · style=${band.style}  (accompDensity=${band.styleProfile.accompDensity} melodyFreedom=${band.styleProfile.melodyFreedom})`);
  log(`   编制(${band.instrumentPool.length}件): ${band.instrumentPool.map((r) => `${r}=PC${band.roleProgram[r]}(候选)`).join(' · ')}`);

  // —— ARRANGER ——
  const formShape = arrangement.sections.map((s) => s.role).join('-'); // seed 选型曲式骨架
  const totalBars = arrangement.sections.reduce((n, s) => n + s.bars, 0);
  log(`■ ARRANGER   ${arrangement.tempoBpm}bpm ${arrangement.meter.numerator}/${arrangement.meter.denominator} ${arrangement.feel.kind} · 曲式=${formShape}(${arrangement.sections.length}段/${totalBars}小节,seed 选) · 高潮=${arrangement.climaxMap.map((c) => c.sectionId).join(',') || '-'}`);
  log(`   段落: ${arrangement.sections.map((s) => `${s.id}[${s.bars}b${s.repeatGroup ? '·' + s.repeatGroup : ''}·${s.hookPolicy}${s.functionTag ? '·' + s.functionTag : ''}${s.harmonyRole ? '·H:' + s.harmonyRole : ''}${s.linkOut && s.linkOut !== 'none' ? '·→' + s.linkOut : ''}]`).join('  ')}`);
  log(`   乐句 ${arrangement.phrases.length} · 动机绑定 ${arrangement.motifBindings.length}(同 motifId 跨段=排比)`);

  // —— INSTRUMENTAL ——
  const samePairs = instrumentation.sameInstrumentPairs?.map((p) => `${p.a}=${p.b}(PC${p.program})`).join(' ');
  log(`■ INSTRUMENT 音色世界=${instrumentation.timbreWorld ?? '-'}${samePairs ? ` · 同乐器对:${samePairs}` : ''}`);
  // ★ 链式协同(gm128_chain_orchestration):器配层拥有 GM 选择 —— 链世界/profile + 生效 roleProgram + 决策轨迹
  const oc = instrumentation.orchestrationChain;
  log(`   链 world=${oc.world} profile=${oc.profileId} · 生效:${band.instrumentPool.map((r) => {
    const bank = instrumentation.roleBank?.[r];
    const bankLabel = r === 'drum' ? 'PC' : `CC0=${bank ?? 0}`;
    const name = instrumentation.voiceNameByRole?.[r] ?? roleVoiceName(r, instrumentation.roleProgram[r], bank);
    return `${r}=${name}(PC${instrumentation.roleProgram[r]},${bankLabel})`;
  }).join(' ')}`);
  log(`   链决策: ${oc.decisions.join(' | ')}`);
  // ★ ESP32 混音(器配层 mix:CC7 音量/CC10 声像/CC91 混响/CC93 合唱;印各角色首段代表值)
  const firstSec = arrangement.sections[0]?.id;
  log(`   混音空间=${instrumentation.spaceProfile} · ${band.instrumentPool.map((r) => {
    const m = firstSec ? instrumentation.mixByRoleSection[r]?.[firstSec] : undefined;
    return m ? `${r}PC${instrumentation.roleProgram[r]}[V${m.volume} P${m.pan} R${m.reverb} C${m.chorus}]` : `${r}-`;
  }).join(' ')}`);
  const gestures = band.instrumentPool
    .map((r) => {
      const g = instrumentation.gestureExpressionByRole[r];
      if (!g?.kind || g.kind === 'none') return null;
      const cc = g.ccControllers.length ? `/CC${g.ccControllers.join('/')}` : '';
      const pedal = g.pedalPolicy !== 'none' ? `/pedal=${g.pedalPolicy}` : '';
      const rud = g.rudimentPolicy !== 'none' ? `/rud=${g.rudimentPolicy}` : '';
      const hat = g.hiHatPolicy !== 'none' ? `/hat=${g.hiHatPolicy}` : '';
      const bass = g.bassTechniques?.length ? `/tech=${g.bassTechniques.join('+')}` : '';
      const gate = g.gateRatio !== undefined ? `/gate=${g.gateRatio}` : '';
      return `${r}:${g.family} PC${g.program}:${g.kind}/${g.continuity}/${g.articulation}/${g.articulationExclusionGroup}${cc}${pedal}${rud}${hat}${bass}${gate}`;
    })
    .filter(Boolean);
  if (gestures.length) log(`   手势表情(器配下发): ${gestures.join(' · ')}`);
  log(`   lead grammar: ${leadGrammarLabelForStyle(band.style, instrumentation.roleProgram.lead)}`);
  log(`   织体(让位类): ${Object.entries(instrumentation.textureBySection).map(([s, t]) => `${s}=${t}`).join(' ')}`);
  // ★ rich textureCase 段级下发(非 LOFI):器配层定,整段沿用,不逐 span 乱切(texture-switch 修复)
  const richTex = Object.entries(instrumentation.richTextureBySection);
  if (richTex.length) log(`   rich 织体(段级,器配下发): ${richTex.map(([s, tc]) => `${s}=${tc.replace('Piano_', '')}`).join(' ')}`);
  else log(`   rich 织体: 逐 span 回退(blues/default;POP/RNB/JAZZ/LOFI 已段级下发)`);
  const richSw = Object.entries(instrumentation.richTextureSwitchBySection);
  if (richSw.length) log(`   ★ 段内变化(verse 中段,≤2/段,所有 verse 一致): ${richSw.map(([s, v]) => `${s}@${v.atFraction}→${v.toTexture.replace('Piano_', '')}`).join(' ')}`);
  // ★ 音色切换(同乐手换声音):某角色跨段落用了 >1 种 program → 印 verse↔chorus
  const timbreSwitch = band.instrumentPool.map((r) => {
    const bySec = instrumentation.programByRoleSection[r];
    if (new Set(arrangement.sections.map((s) => bySec[s.id])).size <= 1) return null;
    const cho = arrangement.sections.find((s) => s.role === 'chorus');
    const oth = arrangement.sections.find((s) => s.role !== 'chorus');
    if (!cho || !oth) return null;
    const from = instrumentation.voiceNameByRoleSection[r]?.[oth.id]
      ?? roleVoiceName(r, bySec[oth.id], instrumentation.bankByRoleSection[r]?.[oth.id]);
    const to = instrumentation.voiceNameByRoleSection[r]?.[cho.id]
      ?? roleVoiceName(r, bySec[cho.id], instrumentation.bankByRoleSection[r]?.[cho.id]);
    return `${r} ${from}↔chorus ${to}`;
  }).filter(Boolean);
  if (timbreSwitch.length) log(`   ★ 音色切换(同乐手换声): ${timbreSwitch.join(' · ')}`);
  const mainHooks = instrumentation.melodyReservationPlan.hookAnchorSlots.filter((h) => h.anchorRequired);
  log(`   主 hook 让位锚点: ${mainHooks.map((h) => `${h.phraseId}@拍${h.beatSlot}`).join(' ') || '-'}`);
  // ★ 编曲密度弧:每段在场乐手(谁进/出)
  log(`   密度弧: ${arrangement.sections.map((s) => `${s.id}{${(instrumentation.activeRolesBySection[s.id] ?? []).join('+')}}`).join('  ')}`);
  // ★ 鼓 groove 下发(Arranger)+ 器配匹配变体(逐段鼓型 hit 数):取代单一 drumPattern
  log(`   鼓 groove: ${arrangement.sections.map((s) => `${s.id}=${arrangement.grooveBySection[s.id]}(${instrumentation.drumPatternBySection[s.id]?.length ?? 0}hit)`).join('  ')}`);
  log(`   总谱Performance: ${arrangement.sections.map((s) => {
    const p = arrangement.rolePerformanceBySection.drum[s.id];
    return `${s.id}{fg=${p.foregroundRole} grid=${p.rhythmGrid}/${p.swingUnit} safe=${p.safeRangeTicks} max=${p.maxMoveTicks} preQ=${p.preQuantizeGrid}}`;
  }).join('  ')}`);
  log(`   鼓手合同: ${arrangement.sections.map((s) => {
    const d = arrangement.drumPerformanceBySection[s.id];
    return `${s.id}=kit${d.kitProgram}:${d.patternFamily}/${d.feelProfileId}/${d.timingProfile}/fill:${d.fillPolicy}.${d.fillAmount}.${d.fillComplexity}/var${d.phraseVariation}`;
  }).join('  ')}`);
  // ★ 段落边界(Arranger 下发):进入方式(lead-in=末小节铺垫推进)+ 收尾方式(cold/fade/tag)+ 器配退出排布
  const leadIns = arrangement.sections.filter((s) => arrangement.entryBySection[s.id] === 'lead-in').map((s) => s.id);
  const ep = instrumentation.endingPlan;
  const exits = Object.entries(ep.exitBarByRole).map(([r, b]) => `${r}@bar${b}`).join(',') || (ep.coldStop ? '齐停' : '响到末');
  log(`   段落衔接: lead-in→[${leadIns.join(' ') || '-'}] · 收尾=${arrangement.endingStyle}(退出 ${exits}${ep.holdFinalChord ? ' · 末和弦延留' : ''})`);
  // ★ Loop C 衔接计划:song entry 方式 + 各 lead-in 边界的 pickup 角色
  const tp = instrumentation.transitionPlan;
  const pickups = tp.boundaries.filter((b) => b.pickupRoles.length).map((b) => `${b.toSectionId}<${b.pickupRoles.join('/')}`).join(' ') || '-';
  log(`   衔接计划: entry=${tp.songEntry.mode}(anchor ${tp.songEntry.downbeatAnchorRoles.join('+') || '-'}${tp.songEntry.delayedRoles.length ? ` 延后 ${tp.songEntry.delayedRoles.join('+')}` : ''}) · pickup→ ${pickups}`);
  // ★ 段落重心诊断:中心段(hook/head/loop)占比 + 回归次数 + 末段能量(听感飘 → 看是否中心占比/复现不够)
  const CENTER_TAGS = ['hook', 'head', 'loop'];
  const centerSecs = arrangement.sections.filter((s) => CENTER_TAGS.includes(s.functionTag ?? ''));
  const centerBars = centerSecs.reduce((n, s) => n + s.bars, 0);
  const allBars = arrangement.sections.reduce((n, s) => n + s.bars, 0);
  const cnt = (tag: string) => arrangement.sections.filter((s) => s.functionTag === tag).length;
  const peakE = Math.max(0, ...arrangement.sections.map((s) => arrangement.energyBySection[s.id] ?? 0));
  const reqAnchors = instrumentation.melodyReservationPlan.hookAnchorSlots.filter((h) => h.anchorRequired).length;
  log(`   重心: centerBars=${centerBars}/${allBars}(${allBars ? Math.round((centerBars / allBars) * 100) : 0}%) hook×${cnt('hook')} loop×${cnt('loop')} head×${cnt('head')} 主锚×${reqAnchors} 末段energy=${peakE.toFixed(2)}`);

  // —— HARMONY(上面已构建 harmonic;此处仅日志)——
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

  // —— RENDER + AUDIT(走真实控制环:retry/budget/fallback,与 generateSong 同路径)——
  // ★ 2026-06-07 退役 Motif 旋律子系统(backlog D-1/c):旋律=MG 链,不再跑 Prepass/MotifStore。
  // 段落骨架 → tick 区间(piano-roll DAW 段落标尺消费)
  const bpbSec = beatsPerBarOf(arrangement.meter);
  const sections: TraceSection[] = [];
  let secBeatCursor = 0;
  for (const s of arrangement.sections) {
    const startTick = timebase.beatToTick(beats(secBeatCursor)) as number;
    secBeatCursor += s.bars * bpbSec;
    sections.push({ id: s.id, role: s.role, startTick, endTick: timebase.beatToTick(beats(secBeatCursor)) as number, bars: s.bars });
  }
  const intentPlan = deriveMusicIntentPlan(band.style, arrangement);
  const render: RenderFn = (retry) =>
    renderSongFull(band, arrangement, harmonic, instrumentation, timebase, retry?.rng ?? seedRng,
      retry && { voicingSafer: retry.voicingSafer }, undefined, intentPlan, undefined, acgPianoScorePlan, jazzFiveFourScorePlan, undefined, lofiLeadScorePlan);
  const locator = buildRetryLocator(harmonic, timebase);
  const result = runGenerationControl(render, seedRng, DEFAULT_BUDGET, locator);
  const audit = result.report;
  // failed 时控制环不返回 IR → 补渲一次基础版供面板展示/试听(并明确标 failed)
  const ir: MusicalIR = result.ir ?? render(undefined).ir;

  log(`■ RENDER     ${ir.tracks.map((t) => `${t.role}=${t.notes.length}`).join('  ')}  [控制环 ${result.status} · ${result.attempts} 次尝试]`);
  // ★ repeatGroup 重放(2026-06-11):重复段 body 复用首段(全轨同音符),链接尾巴各自(发散点之后)。
  const replays = planRepeatGroupReplays(arrangement, harmonic.chordTimeline, timebase);
  if (replays.length) {
    log(`   重复段重放(body 同音符·lead 逐字节·伴奏各自人性化): ${replays.map((p) => `${p.sourceId}→${p.targetId}(前缀${(p.prefixTicks / timebase.ppq).toFixed(0)}拍)`).join(' · ')}`);
  }
  // ★ lead 空拍补全(2026-06-11):末音后大空拍 → 延长末音到 bar 末(钳位和弦),不和弦未完成戛然而止
  //   (在【原始 MG lead】上算补全计划展示,production lead 已补全)
  const rawLeadForGaps = renderMgMelody(
    harmonic,
    band,
    timebase,
    request.seed,
    instrumentation.roleProgram.lead,
    arrangement.songGrooveContract,
    acgPianoScorePlan?.leadPresencePlan,
    acgPianoScorePlan,
  );
  const gapFills = planLeadGapFills(rawLeadForGaps.notes, harmonic.chordTimeline, timebase, beatsPerBarOf(arrangement.meter));
  if (gapFills.length) log(`   lead 空拍补全 ×${gapFills.length}(延末音到 bar 末;${gapFills.filter((f) => f.chordClamped).length} 处钳到起音和弦末,不跨和弦)`);
  // ★ 手势表情层:器配下发 sax/pipe-wind timing/legato plan。当前硬件输出
  // 保持非钢琴通道的 5504 默认控制器状态，不把未审定的 wind CC 写到板端。
  const leadTrack = ir.tracks.find((t) => t.role === 'lead');
  const leadGesture = instrumentation.gestureExpressionByRole.lead;
  if (leadGesture?.kind !== 'none') log(`   吹奏手势(${leadGesture.kind},GM${leadTrack?.program ?? '—'}):时值/连奏由器配计划驱动；板端 CC 保持默认`);
  const pianoCc11 = ir.tracks.flatMap((track) => (track.ccEvents ?? [])
    .filter((event) => event.controller === 11)
    .map((event) => ({ role: track.role, value: event.value })));
  if (pianoCc11.length) log(`   原声钢琴 CC11 乐句表情 ×${pianoCc11.length}(器配层按 keyboardMotion 的段落/小节下发,${Math.min(...pianoCc11.map((event) => event.value))}..${Math.max(...pianoCc11.map((event) => event.value))})`);
  log(`   pad↔comp 分工: comp 主奏(GM 织体)· pad=sustain/air 层(单轨优化,不碰伴奏/旋律/和声合同)`);
  log(`     pad mode: chord-bed(当前和弦开放排列+共同音连接)· drone(严格共同音,无则休息)· inner-line(RNB 慢内声部级进)· cluster-mist(LOFI 暗段高区二度雾)· gated-pad(高密 pop chorus shimmer)· full-support(pad-only 3-4 声部)· 全在正交音阶内·避同绝对音高`);
  log(`   comp 织体: ${band.style}(${compPattern(band.style).length} hits/bar,有律动/切分)· 全声部 voice-leading(贴最近上一声部,声部连贯)`);
  log(`   resolver: voicing-around-melody(comp 与旋律撞小二度/小九度→丢该 comp 声部)+ lead 音域碰撞上移`);
  log(`   bass 行进: ${band.style}(jazz=walking / pop=根-五 / lofi=根音持续)`);
  log(`   drum: ${band.style} per-段 groove 变体(主权威)+ 段落转折 fill + 力度人性化`);
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
    // ★ Loop H 音乐性审计(只读 warning,不重跑):衔接/收尾/comp 断层
    const MUSICALITY_RULES = new Set(['transition-pickup-missing', 'section-downbeat-anchor-missing', 'song-start-abrupt', 'outro-harmonic-support-missing', 'comp-continuity-gap', 'lead-groove-desync', 'texture-clock-drift', 'structural-comp-anchor-late', 'roll-spread-too-wide']);
    const mus = audit.findings.filter((f) => MUSICALITY_RULES.has(f.ruleId));
    log(`   音乐性(Loop H): ${mus.length ? mus.map((f) => `${f.ruleId}@${f.location.trackRole}`).join(' / ') : '无(衔接/收尾/comp 连续性 OK)'}`);
    if (errs.length > 0) {
      log(`   纠错环(${result.attempts} 次尝试): error@${errs[0].location.trackRole}#${errs[0].location.startTick} → 撞音消解阶梯(voicing→降锁→换hook→fallback)`);
    } else {
      log(`   (均 warning 级:离调/撞音/note-context-avoid 安全网,信息性不阻断;avoid 判据走【统一评判器 evaluateNoteInChordContext】Layer A 和弦+Layer B 调性融合)`);
    }
  }
  const bars = Math.round(ir.durationTicks / (480 * beatsPerBarOf(arrangement.meter)));
  log(`■ 总长       ${bars} 小节 @ ${arrangement.tempoBpm}bpm`);
  log(`■ MIX        render后处理 → ${ir.tracks.map((t) => {
    const m = t.mix;
    return m ? `${t.role}GM${t.program ?? '-'}[V${m.volume} P${m.pan} R${m.reverb} C${m.chorus}]` : `${t.role}-`;
  }).join(' ')} · CC7/10/91/93 写入 IR,浏览器与 ESP32 共用`);

  return { lines, ir, audit, bpm: arrangement.tempoBpm, attempts: result.attempts, status: result.status, sections };
}
