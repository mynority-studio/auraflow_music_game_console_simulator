// ============================================================
// newEngine · ir · AuditReport(只读终检报告)
// ------------------------------------------------------------
// 架构定稿 Part 2.10。Auditor 只报告;findings 空 = pass。
// returnPoint = 回卷语义(从该 stage 重跑下游后缀)。
// ============================================================

export type Severity = 'warning' | 'error' | 'fatal';

export type ReturnPoint =
  | 'rewind-resolver'
  | 'rewind-melody'
  | 'rewind-accompaniment'
  | 'render-fallback';

export interface IRLocation {
  trackRole: string;
  startTick: number;
}

export interface AuditFinding {
  severity: Severity;
  location: IRLocation;
  ruleId: string;
  reason: string;
  suggestedReturnPoint: ReturnPoint;
}

export interface AuditReport {
  findings: AuditFinding[]; // 空 = pass
  textureCases?: string[];  // ★ 调试/审计:本曲 textureSchedule 用到的 textureCase 集(§4 逐-bar 织体多样性度量)
}

export function isPass(report: AuditReport): boolean {
  return report.findings.length === 0;
}
