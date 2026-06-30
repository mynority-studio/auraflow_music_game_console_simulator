// ============================================================
// musicGeneration · participantConstraint(qn_takeover_followup §4.3/§4.4)
// ------------------------------------------------------------
// 产品语义层:把「参与乐手/职能」选择(BandParticipantSelection)推导为 Q+N band 层
// 消费的 LineupConstraint(allowedRoles + familyByRole)。
//   - participant 只决定【谁参与 / 哪些 role / 哪些家族可用】,不决定具体 GM 音色;
//     音色仍由器配层按 style/seed/音色世界 rng 选(见 instrumentalPlanner)。
//   - 故意放在【服务层】而非 bandEngine:participant→role/family 是产品语义,
//     bandEngine 只消费纯 LineupConstraint(职责分离,§7)。
// ============================================================

import type { InstrumentFamily, LineupConstraint } from '../newEngine/knowledge/instruments';
import type { BandParticipantRole, BandParticipantSelection, QnRole } from './types';

/** 每个参与乐手能承担的 Q+N role + 带来的乐器家族(families 缺省=不限家族,任意音色)。 */
const PARTICIPANT_CAP: Record<BandParticipantRole, { roles: QnRole[]; families?: InstrumentFamily[] }> = {
  keyboardist: { roles: ['lead', 'comp', 'pad'], families: ['keyboard'] },
  bassist: { roles: ['bass'], families: ['bass'] },
  drummer: { roles: ['drum'] },                                  // 鼓走 ch9,不做家族过滤
  guitarist: { roles: ['lead', 'comp'], families: ['guitar'] },
  synthPlayer: { roles: ['pad', 'lead', 'comp'], families: ['pad'] },
  leadPlayer: { roles: ['lead'] },                               // 主奏不限家族
};

const ALL_ROLES: QnRole[] = ['lead', 'comp', 'bass', 'pad', 'drum'];

/**
 * 参与乐手选择 → LineupConstraint。语义:
 *   - 全 auto / 空 → undefined(Q+N 默认完整乐队,字节不变)。
 *   - 任一 selected → 白名单:仅 selected 乐手覆盖的 role 参与;按其家族限定候选;
 *     被「不限家族」乐手(leadPlayer/drummer)覆盖的 role 开放全家族。
 *   - 仅 disabled(无 selected)→ 默认乐队减去 disabled 乐手独占的 role。
 *   - selected 覆盖的 role 永远胜过 disabled(重叠时不被减掉)。
 * 必要旋律/和声 role 缺失由 bandEngine 自动补位(§4.4,autoFilledRoles 标记),此处不补。
 */
export function deriveLineupConstraint(participants?: BandParticipantSelection[]): LineupConstraint | undefined {
  if (!participants || participants.length === 0) return undefined;

  const selected = participants.filter((p) => p.state === 'selected');
  const selectedRoles = new Set<QnRole>();
  for (const p of selected) for (const r of PARTICIPANT_CAP[p.role].roles) selectedRoles.add(r);

  // disabled 覆盖的 role,但被任一 selected 覆盖的 role 不算(选择胜过排除)。
  const disabledRoles = new Set<QnRole>();
  for (const p of participants) {
    if (p.state !== 'disabled') continue;
    for (const r of PARTICIPANT_CAP[p.role].roles) if (!selectedRoles.has(r)) disabledRoles.add(r);
  }

  // 无任何明确表态(全 auto)→ 无约束(默认完整乐队)。
  if (selected.length === 0 && disabledRoles.size === 0) return undefined;

  if (selected.length === 0) {
    // 仅 disabled:默认乐队减去 disabled 的 role(不限家族)。
    const allowedRoles = new Set<QnRole>(ALL_ROLES.filter((r) => !disabledRoles.has(r)));
    return { allowedRoles };
  }

  // 白名单:仅 selected 覆盖的 role(再减 disabled 独占的 role)。
  const allowedRoles = new Set<QnRole>([...selectedRoles].filter((r) => !disabledRoles.has(r)));

  // 家族:每个 role 取覆盖它的 selected 乐手家族并集;被无家族乐手覆盖 → 开放全家族(清空)。
  const familyByRole: Partial<Record<QnRole, InstrumentFamily[]>> = {};
  const unrestricted = new Set<QnRole>();
  for (const p of selected) {
    const cap = PARTICIPANT_CAP[p.role];
    for (const r of cap.roles) {
      if (!allowedRoles.has(r)) continue;
      if (cap.families) {
        const cur = familyByRole[r] ?? [];
        for (const f of cap.families) if (!cur.includes(f)) cur.push(f);
        familyByRole[r] = cur;
      } else {
        unrestricted.add(r);
      }
    }
  }
  for (const r of unrestricted) delete familyByRole[r];

  const fam = Object.keys(familyByRole).length ? familyByRole : undefined;
  return fam ? { allowedRoles, familyByRole: fam } : { allowedRoles };
}

/** participant role → 它承担的首要 Q+N role(roster 显示「谁演这条轨」用)。 */
export function participantForRole(role: QnRole, participants?: BandParticipantSelection[]): BandParticipantRole | undefined {
  if (!participants) return DEFAULT_PARTICIPANT_BY_ROLE[role];
  // selected 优先,其次 auto;取首个能覆盖该 role 的(未 disabled)。
  const byPriority = [...participants].sort((a, b) => stateRank(a.state) - stateRank(b.state));
  for (const p of byPriority) {
    if (p.state === 'disabled') continue;
    if (PARTICIPANT_CAP[p.role].roles.includes(role)) return p.role;
  }
  return DEFAULT_PARTICIPANT_BY_ROLE[role];
}

const DEFAULT_PARTICIPANT_BY_ROLE: Record<QnRole, BandParticipantRole> = {
  lead: 'leadPlayer', comp: 'keyboardist', pad: 'synthPlayer', bass: 'bassist', drum: 'drummer',
};
function stateRank(s: BandParticipantSelection['state']): number {
  return s === 'selected' ? 0 : s === 'auto' ? 1 : 2;
}
