// ============================================================
// newEngine · render · motif 跨轨投射(墨盒任务书 P2:comp 回声)
// ------------------------------------------------------------
// P2.1 升级(用户反馈"回声太机械"):回声不再永远是同一个头部 cell,
// 而是从【回声 cell 池】按小节确定性轮换:
//   池 = 原头部 cell(首次回声,辨识优先)
//      + motif 语法变体的节奏(head/tail/diminished,userMotifGrammarRules)
//      + 风格语料里节奏最像动机的乐句 cell(melodyRhythmShapeSimilarity 同尺 top-N)
// 每次应答不同,但全部与动机节奏同族。力度按小节微变去机械感。
// 工程约束不变:相位 0.5 网格(避开 snapCompLaidback)、不与 authored span
// 抢话、仅 POP/RNB、纯函数确定性(retry 稳定)。
// ============================================================

import { authoredLeadSpans, type AuthoredUserMotifBrickPlan } from './userMotifBrick';
import { motifStyleIntegration } from './motifStyleIntegration';
import { userMotifGrammarRules } from './userMotifGrammar';
import {
  buildGrammarRhythmShapeProfile,
  buildMelodyRhythmShapeProfile,
  melodyRhythmShapeSimilarity,
} from './mgRhythmShapeMatcher';
import { POP_ENRICHED_GRAMMAR, RNB_ENRICHED_GRAMMAR } from '../knowledge/melodyStyleGrammarProfiles';
import type { AbstractMelodyToken, Grammar, GrammarRule } from '../knowledge/melodyGrammarTypes';

export interface MotifEchoBar {
  accentBeats: readonly number[]; // bar 内相位(0.5 网格)
  durations: readonly number[];
  velocity?: number;              // 0..1;缺省 0.5
  sourceLabel?: string;           // provenance:'motif-head' | 'usermotif_tail' | 语料 ruleId
}

const MAX_ECHO_ACCENTS = 4;
const CORPUS_NEIGHBORS = 4;
const CORPUS_SCAN_CAP = 300;
const quantizeHalf = (x: number): number => Math.round(x * 2) / 2;

/** token 序列(或音符序列)→ bar 内节奏 cell(0.5 网格,去重,2..4 个重音)。 */
function cellFromEvents(events: Array<{ onset: number; dur: number }>, beatsPerBar: number): Omit<MotifEchoBar, 'velocity' | 'sourceLabel'> | null {
  const accentBeats: number[] = [];
  const durations: number[] = [];
  for (const e of events) {
    if (accentBeats.length >= MAX_ECHO_ACCENTS) break;
    const phase = quantizeHalf(e.onset);
    if (phase >= beatsPerBar - 0.25) break;
    if (accentBeats.length > 0 && phase <= accentBeats[accentBeats.length - 1] + 1e-6) continue;
    accentBeats.push(phase);
    durations.push(Math.max(0.25, Math.min(0.75, quantizeHalf(e.dur) || 0.5)));
  }
  return accentBeats.length >= 2 ? { accentBeats, durations } : null;
}

function cellFromTokens(tokens: readonly AbstractMelodyToken[], beatsPerBar: number): Omit<MotifEchoBar, 'velocity' | 'sourceLabel'> | null {
  const events: Array<{ onset: number; dur: number }> = [];
  let cursor = 0;
  for (const t of tokens) {
    if (t.duration <= 0) continue;
    if (t.kind !== 'R') events.push({ onset: cursor, dur: t.duration });
    cursor += t.duration;
  }
  return cellFromEvents(events, beatsPerBar);
}

/** 风格语料的节奏 cell 候选(模块级懒缓存;与语法亲和度同一把相似度尺)。 */
type CorpusCell = { profile: ReturnType<typeof buildGrammarRhythmShapeProfile>; cell: Omit<MotifEchoBar, 'velocity' | 'sourceLabel'>; ruleId: string };
const corpusCellCache = new Map<string, CorpusCell[]>();
function corpusCellsForStyle(style: string, beatsPerBar: number): CorpusCell[] {
  const key = style.toUpperCase();
  const cached = corpusCellCache.get(key);
  if (cached) return cached;
  const grammar: Grammar | undefined = key === 'RNB' ? RNB_ENRICHED_GRAMMAR : key === 'POP' ? POP_ENRICHED_GRAMMAR : undefined;
  const out: CorpusCell[] = [];
  if (grammar) {
    const rules = [...(grammar.rulesByLhs.get('Phrase') ?? [])]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, CORPUS_SCAN_CAP);
    for (const rule of rules) {
      const tokens = rule.rhs.filter((x): x is AbstractMelodyToken => typeof x !== 'string');
      const cell = cellFromTokens(tokens, beatsPerBar);
      if (!cell) continue;
      const span = rule.metadata?.authoredDurationBeats ?? tokens.reduce((s, t) => s + Math.max(0, t.duration), 0);
      if (span < 1) continue;
      out.push({ profile: buildGrammarRhythmShapeProfile(tokens, span), cell, ruleId: rule.metadata?.sourceRuleId ?? 'corpus' });
    }
  }
  corpusCellCache.set(key, out);
  return out;
}

/** 回声 cell 池:原头部 + motif 语法变体 + 语料 top-N 节奏近邻。 */
function buildEchoPool(plan: AuthoredUserMotifBrickPlan, beatsPerBar: number, style?: string): MotifEchoBar[] {
  const pool: MotifEchoBar[] = [];
  const push = (cell: Omit<MotifEchoBar, 'velocity' | 'sourceLabel'> | null, sourceLabel: string): void => {
    if (!cell) return;
    const sig = cell.accentBeats.join(',');
    if (pool.some((p) => p.accentBeats.join(',') === sig)) return; // 去重:同节奏不重复入池
    pool.push({ ...cell, sourceLabel });
  };
  // 1) 原头部(首次回声用,辨识优先)
  const sorted = [...plan.notes].sort((a, b) => a.onsetBeat - b.onsetBeat);
  const base = sorted[0]?.onsetBeat ?? 0;
  push(cellFromEvents(sorted.map((n) => ({ onset: n.onsetBeat - base, dur: n.durationBeat })), beatsPerBar), 'motif-head');
  if (pool.length === 0) return pool; // 头部都提不出 → 整体放弃
  // 2) motif 语法变体的节奏(head/tail/diminished 等,与 lead 衍生词汇同源)
  for (const rule of userMotifGrammarRules(plan, style)) {
    const tokens = rule.rhs.filter((x): x is AbstractMelodyToken => typeof x !== 'string');
    push(cellFromTokens(tokens, beatsPerBar), rule.metadata?.sourceRuleId ?? 'usermotif');
  }
  // 3) 风格语料 top-N 节奏近邻(用户点名:"参考 grammar 库里的语句")
  const rel = sorted.map((n) => ({ onsetBeat: n.onsetBeat - base, durationBeat: n.durationBeat }));
  const motifProfile = buildMelodyRhythmShapeProfile(rel, 0, Math.max(1, plan.endBeat - plan.startBeat));
  const neighbors = corpusCellsForStyle(style ?? 'POP', beatsPerBar)
    .map((c) => ({ ...c, sim: melodyRhythmShapeSimilarity(motifProfile, c.profile) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, CORPUS_NEIGHBORS);
  for (const n of neighbors) push(n.cell, `corpus:${n.ruleId}`);
  return pool;
}

/** 每个 motif span 结束后的下一小节 → 回声 cell(池内按序轮换 + 力度微变)。 */
export function buildMotifCompEchoByBar(
  plan: AuthoredUserMotifBrickPlan | undefined,
  beatsPerBar: number,
  totalBeats: number,
  style?: string,
): Map<number, MotifEchoBar> {
  const out = new Map<number, MotifEchoBar>();
  if (!plan || !motifStyleIntegration(style).perSectionPresence) return out;
  const pool = buildEchoPool(plan, beatsPerBar, style);
  if (pool.length === 0) return out;
  const spans = authoredLeadSpans(plan);
  const totalBars = Math.floor(totalBeats / beatsPerBar);
  const echoBars: number[] = [];
  for (const span of spans) {
    const echoBar = Math.floor((span.endBeat + 1e-4) / beatsPerBar);
    if (echoBar >= totalBars) continue;
    const barStart = echoBar * beatsPerBar;
    const overlapsAuthored = spans.some((s) => barStart < s.endBeat - 1e-4 && barStart + beatsPerBar > s.startBeat + 1e-4);
    if (overlapsAuthored || echoBars.includes(echoBar)) continue;
    echoBars.push(echoBar);
  }
  echoBars.sort((a, b) => a - b);
  echoBars.forEach((bar, index) => {
    const cell = pool[index % pool.length]; // 首次 = motif-head,其后轮换变体/语料近邻
    out.set(bar, { ...cell, velocity: 0.44 + ((bar * 7) % 5) * 0.03 }); // 0.44..0.56 确定性微变
  });
  return out;
}
