// ============================================================
// newEngine · arranger · EdgePlanner(2026-06-08)
// ------------------------------------------------------------
// 修「intro→verse 衔接 / outro 收尾」:Arranger(最高权威)下发【段落边界行为】,
//   器配/render 才知道乐器怎么进、怎么出。两件事:
//   ① entryBySection — 每段乐器【进入方式】:能量跃升(intro→verse / verse→chorus / build→hook)
//      = lead-in(上一段末小节铺垫推进到本段下拍,release 感);平/降(重复段、loop→loop、收尾)= downbeat 直入。
//   ② endingStyle — 全曲【收尾方式】(联网研究 4 类收尾,按用户选 = 风格定制、不改 tempo):
//      pop=cold(button 干净停)· rnb/lofi=fade(逐件抽离+渐弱)· jazz=tag(末和弦延留+节奏件先退=渐慢感)。
//   纯派生(energy + style),无 rng → 确定性、不扰其它子流。
// ============================================================

import type { EndingStyle, Section, SectionEntry, SectionId } from './ArrangementPlan';

// 能量跃升阈值:setup→story(+0.20)/ story→hook(+0.28)/ build→hook(+0.14)/ setup→loop(+0.16)皆触发;
//   重复段(verse2≈verse1)、loop→loop(0)、head→head(ramp 0.04)、收尾段(降)不触发。
const ENTRY_LIFT_THRESHOLD = 0.10;

// 收尾风格词汇表(2026-08-12,治"每首歌同一种收法"):每风格一组加权候选,
// 首项 = 旧固定值(无 seedHint 时保持旧行为,既有单测不破)。seeded 选择 → 同 seed 复现、跨 seed 有变化。
const ENDING_VOCAB_BY_STYLE: Record<string, Array<{ ending: EndingStyle; weight: number }>> = {
  pop: [{ ending: 'cold', weight: 0.5 }, { ending: 'tag', weight: 0.3 }, { ending: 'fade', weight: 0.2 }],
  rnb: [{ ending: 'fade', weight: 0.4 }, { ending: 'tag', weight: 0.4 }, { ending: 'cold', weight: 0.2 }],
  lofi: [{ ending: 'fade', weight: 0.55 }, { ending: 'tag', weight: 0.45 }],
  jazz: [{ ending: 'tag', weight: 0.55 }, { ending: 'cold', weight: 0.3 }, { ending: 'fade', weight: 0.15 }],
  default: [{ ending: 'cold', weight: 0.6 }, { ending: 'tag', weight: 0.4 }],
};

/** 风格的收尾词汇表(测试/审计用)。 */
export function endingVocabularyForStyle(style: string): EndingStyle[] {
  return (ENDING_VOCAB_BY_STYLE[style.toLowerCase()] ?? ENDING_VOCAB_BY_STYLE.default).map((v) => v.ending);
}

function pickEndingStyle(style: string, mood: string | undefined, seedHint: number | undefined): EndingStyle {
  const vocab = ENDING_VOCAB_BY_STYLE[style.toLowerCase()] ?? ENDING_VOCAB_BY_STYLE.default;
  // 抒情 pop 仍偏 fade:把 fade 权重抬到首位候选
  const weighted = style.toLowerCase() === 'pop' && isLyricalMood(mood)
    ? vocab.map((v) => v.ending === 'fade' ? { ...v, weight: v.weight + 0.5 } : v)
    : vocab;
  if (seedHint === undefined) return weighted.slice().sort((a, b) => b.weight - a.weight)[0].ending; // 旧行为
  const total = weighted.reduce((a, v) => a + v.weight, 0);
  let roll = ((Math.imul(seedHint ^ 0x9e3779b9, 2654435761) >>> 9) % 1000) / 1000 * total;
  for (const v of weighted) { roll -= v.weight; if (roll <= 0) return v.ending; }
  return weighted[0].ending;
}

function isLyricalMood(mood?: string): boolean {
  if (!mood) return false;
  const s = mood.toLowerCase();
  if (/\b(drive|hype|hard|dance|edm|fast|upbeat|energetic)\b/.test(s) || /(硬|炸|燃|舞曲|跳舞|高速)/.test(s)) return false;
  return /\b(ballad|lyric|calm|soft|sad|melanchol|emotional|emo|gentle|warm|tender|slow|smooth|chill|dream|romantic)\b/.test(s)
    || /(抒情|慢歌|慢板|温柔|柔和|悲伤|伤感|情绪|浪漫|安静|平静|柔)/.test(s);
}

export interface EdgePlan {
  entryBySection: Record<SectionId, SectionEntry>;
  endingStyle: EndingStyle;
}

export function planEdges(
  sections: readonly Section[],
  energyBySection: Record<SectionId, number>,
  style: string,
  mood?: string,
  seedHint?: number,
): EdgePlan {
  const endingStyle = pickEndingStyle(style, mood, seedHint);
  const entryBySection: Record<SectionId, SectionEntry> = {};
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (i === 0) { entryBySection[s.id] = 'downbeat'; continue; }
    const lift = (energyBySection[s.id] ?? 0.5) - (energyBySection[sections[i - 1].id] ?? 0.5);
    entryBySection[s.id] = lift >= ENTRY_LIFT_THRESHOLD ? 'lead-in' : 'downbeat';
  }
  return { entryBySection, endingStyle };
}
