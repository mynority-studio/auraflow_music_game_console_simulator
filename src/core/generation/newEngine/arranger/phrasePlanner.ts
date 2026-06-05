// ============================================================
// newEngine · arranger · PhrasePlanner(凝聚力核心)
// ------------------------------------------------------------
// 架构定稿 Part 2.3 / 4 / 铁律9-12:phrase role / cadenceTarget / skeletonRole
// + motifBindings。★ 同 repeatGroup 同 slot 共享 motifId → motif 跨段复现 = 记忆点/排比。
// restatementStrength:chorus 强(hook)、verse 中、首尾弱。源:hook 句→grammar / 连接句→guidetone。
// ============================================================

import type {
  CadenceTarget,
  MotifBinding,
  Phrase,
  PhraseRole,
  Section,
  SkeletonRole,
} from './ArrangementPlan';

const ROLE_STRENGTH: Record<Section['role'], number> = {
  intro: 0.3,
  verse: 0.5,
  chorus: 0.8,
  bridge: 0.55,
  outro: 0.3,
};

function phraseRoleAt(slot: number, count: number): PhraseRole {
  if (slot === count - 1) return 'cadence';
  return slot % 2 === 0 ? 'antecedent' : 'consequent';
}

function cadenceTargetFor(role: PhraseRole): CadenceTarget {
  switch (role) {
    case 'cadence': return 'authentic';
    case 'antecedent': return 'open';
    case 'consequent': return 'half';
    case 'climax': return 'climax';
    default: return 'half';
  }
}

function skeletonRoleFor(section: Section, slot: number): SkeletonRole {
  // ★ CODEX V4.2:hook scope 按 functionTag 收窄 — hook 段只前 2 句、head/loop/verse 仅首句是 hook,
  //   其余 connector。修"整段 chorus 全 hook"→ comp 整段过度让位 + 旋律丢 A/A' 记忆对比。
  const tag = section.functionTag;
  if (tag) {
    if (tag === 'hook') return slot <= 1 ? 'hook' : 'connector';          // 副歌:前 2 句 hook
    if (tag === 'head' || tag === 'headOut' || tag === 'loop' || tag === 'story')
      return slot === 0 ? 'hook' : 'connector';                          // head/loop/verse:仅首句 hook
    return 'connector';                                                  // build/breakdown/setup/solo/tag/outro
  }
  // 回退 legacy role(template/no-rng 段,无 functionTag)
  if (section.role === 'chorus') return 'hook';           // chorus 全是 hook
  if (section.role === 'verse') return slot === 0 ? 'hook' : 'connector';
  return 'connector';                                     // intro/outro/bridge
}

export interface PhrasePlan {
  phrases: Phrase[];
  motifBindings: MotifBinding[];
}

export function planPhrases(sections: Section[], phraseBars: number): PhrasePlan {
  const phrases: Phrase[] = [];
  const motifBindings: MotifBinding[] = [];

  for (const section of sections) {
    const count = Math.max(1, Math.floor(section.bars / phraseBars));
    for (let slot = 0; slot < count; slot++) {
      const id = `${section.id}-p${slot}`;
      const role = phraseRoleAt(slot, count);
      const skeletonRole = skeletonRoleFor(section, slot);

      phrases.push({
        id,
        sectionId: section.id,
        bars: phraseBars,
        phraseSlot: slot,
        role,
        cadenceTarget: cadenceTargetFor(role),
        repeatGroup: section.repeatGroup,
        skeletonRole,
      });

      // ★ motifId 按 (repeatGroup 或 section) + slot → 同功能段落同 slot 共享动机(排比)
      const motifKey = section.repeatGroup ?? section.id;
      motifBindings.push({
        id: `${id}-b`,
        motifId: `m-${motifKey}-${slot}`,
        phraseId: id,
        repeatGroup: section.repeatGroup,
        requestedRestatementStrength: ROLE_STRENGTH[section.role],
      });
    }
  }

  return { phrases, motifBindings };
}
