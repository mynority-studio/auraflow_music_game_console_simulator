// ============================================================
// newEngine · arranger · FormPlanner
// ------------------------------------------------------------
// 架构定稿 Part 3.2 / 5:sections / repeats / hook placement。
// Slice 1 固定模板 verse-chorus(repeatGroup 标排比:verse↔verse, chorus↔chorus)。
// 同功能段落共享 repeatGroup → 下游 PhrasePlanner 据此让 motif 跨段复现(记忆点)。
// ============================================================

import type { Section } from './ArrangementPlan';

export type FormTemplate = 'verse-chorus';

const TEMPLATES: Record<FormTemplate, Section[]> = {
  'verse-chorus': [
    { id: 'intro', role: 'intro', bars: 4, hookPolicy: 'none' },
    { id: 'verse1', role: 'verse', bars: 8, repeatGroup: 'V', hookPolicy: 'light' },
    { id: 'chorus1', role: 'chorus', bars: 8, repeatGroup: 'C', hookPolicy: 'main' },
    { id: 'verse2', role: 'verse', bars: 8, repeatGroup: 'V', hookPolicy: 'light' },
    { id: 'chorus2', role: 'chorus', bars: 8, repeatGroup: 'C', hookPolicy: 'main' },
    { id: 'outro', role: 'outro', bars: 4, hookPolicy: 'none' },
  ],
};

export function planForm(template: FormTemplate = 'verse-chorus'): Section[] {
  return TEMPLATES[template].map((s) => ({ ...s }));
}
