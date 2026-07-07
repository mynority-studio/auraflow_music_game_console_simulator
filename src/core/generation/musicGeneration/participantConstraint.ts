// ============================================================
// musicGeneration · participantConstraint(qn_takeover_followup §4.3/§4.4)
// ------------------------------------------------------------
// 产品语义层:把「参与乐手/职能」选择(BandParticipantSelection)推导为 Q+N band 层
// 消费的 LineupConstraint(allowedRoles + requiredRoles + familyByRole)。
//   - participant 只决定【谁参与 / 哪些 role / 哪些家族可用】,不决定具体 GM 音色;
//     音色仍由器配层按 style/seed/音色世界 rng 在【约束家族内】选(见 instrumentalPlanner)。
//   - ★ selected 乐手是【必须出现】(requiredRoles),不只是「允许」(allowedRoles):
//     选了鼓手必须有 drum 轨,不能被默认 lineup 随机掉(P1 修复)。
//   - 故意放在【服务层】而非 bandEngine:participant→role/family 是产品语义,
//     bandEngine 只消费纯 LineupConstraint(职责分离,§7)。
// ============================================================

import type { InstrumentFamily, LineupConstraint } from '../newEngine/knowledge/instruments';
import type { BandParticipantRole, BandParticipantSelection, QnRole } from './types';

/** 每个参与乐手能承担的 Q+N role + 带来的家族 + 首选(必出)role 顺序。
 *  ★ 裁到可兑现:roles/families 只列引擎池真能出的(keyboard/guitar=lead/comp,bass,pad,drum,任意=lead)。 */
const PARTICIPANT_CAP: Record<BandParticipantRole, { roles: QnRole[]; families?: InstrumentFamily[]; prefer: QnRole[] }> = {
  keyboardist: { roles: ['lead', 'comp'], families: ['keyboard'], prefer: ['comp', 'lead'] },
  guitarist: { roles: ['lead', 'comp'], families: ['guitar'], prefer: ['comp', 'lead'] },
  bassist: { roles: ['bass'], families: ['bass'], prefer: ['bass'] },
  drummer: { roles: ['drum'], prefer: ['drum'] },               // 鼓走 ch9,不做家族过滤
  synthPlayer: { roles: ['pad'], families: ['pad'], prefer: ['pad'] },
  leadPlayer: { roles: ['lead'], prefer: ['lead'] },            // 主奏不限家族
};

/** 乐手在 requiredRoles 贪心分配中的处理顺序(确定性)。 */
const PARTICIPANT_ORDER: BandParticipantRole[] = ['keyboardist', 'guitarist', 'bassist', 'drummer', 'synthPlayer', 'leadPlayer'];
const ALL_ROLES: QnRole[] = ['lead', 'comp', 'bass', 'pad', 'drum'];

/**
 * 参与乐手选择 → LineupConstraint。语义:
 *   - 全 auto / 空 → undefined(Q+N 默认完整乐队,字节不变)。
 *   - 任一 selected → 白名单:仅 selected 乐手覆盖的 role 参与(allowedRoles);
 *     **每个 selected 乐手必须分到一条 role(requiredRoles,贪心去重分配)** → 选了的乐手一定出声;
 *     按其家族限定候选;被「不限家族」乐手(leadPlayer)覆盖的 role 开放全家族。
 *   - 仅 disabled(无 selected)→ 默认乐队减去 disabled 乐手独占的 role。
 *   - selected 覆盖的 role 永远胜过 disabled(重叠时不被减掉)。
 * 必要旋律 role 仍缺(如只选鼓手)由 bandEngine 自动补位(§4.4,autoFilledRoles 标记)。
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
    // 仅 disabled:默认乐队减去 disabled 的 role(不限家族,不强制)。
    const allowedRoles = new Set<QnRole>(ALL_ROLES.filter((r) => !disabledRoles.has(r)));
    return { allowedRoles };
  }

  // 白名单:仅 selected 覆盖的 role(再减 disabled 独占的 role)。
  const allowedRoles = new Set<QnRole>([...selectedRoles].filter((r) => !disabledRoles.has(r)));

  // ★ requiredRoles:每个 selected 乐手贪心分到一条【不同】的 role(按 prefer 顺序,只取 allowed 且未被占的)。
  const requiredRoles = new Set<QnRole>();
  const claimed = new Set<QnRole>();
  const selectedOrdered = PARTICIPANT_ORDER.filter((role) => selected.some((p) => p.role === role));
  for (const role of selectedOrdered) {
    const pick = PARTICIPANT_CAP[role].prefer.find((r) => allowedRoles.has(r) && !claimed.has(r));
    if (pick) { claimed.add(pick); requiredRoles.add(pick); }
  }

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
  const out: LineupConstraint = { allowedRoles, requiredRoles };
  if (fam) out.familyByRole = fam;
  return out;
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
