// ============================================================
// newEngine · render · ReadOnlyHarmonyAuditor(只读终检)
// ------------------------------------------------------------
// 架构定稿 Part 2.10 / 铁律19:只读、严格、只判和声/音程,不审密度、无豁免。
// 规则(判据来自共享 KB,铁律21):
//   R1 avoid-long-exposure   [error]  : avoidNoteMap 命中 + ≥1 拍长暴露 → 触发纠错环
//   R2 chromatic-exposure    [warning]: 非鼓轨长音落在 chord-scale 之外(离调暴露)
//   R3 note-context-avoid    [warning]: lead 持续音走【统一评判器 evaluateNoteInChordContext】判 avoid
//                                       (Layer A 和弦 + Layer B 调性 max-merge,需 keyCtx;切到统一 KB API)
//   R4 dissonant-vert-clash  [warning]: lead vs comp 同时发声且实际小二度/小九度(浊响撞音)
// warning 不阻断(controller 带 warning 通过),作产品级安全网;error 才回卷重跑。
// ============================================================

import { beats, mod12, type DeepReadonly, type Timebase } from '../foundation';
import type { ChordSpan, HarmonicFunction, HarmonicPlan } from '../harmony/HarmonicPlan';
import type { MusicalIR } from '../ir/MusicalIR';
import type { AuditFinding, AuditReport } from '../ir/AuditReport';
import { evaluateNoteInChordContext } from '../knowledge/melodyChordSemantics';
import type { KeyMode } from '../knowledge/keyProfiles';

/** 调性上下文(由 band 下发):统一评判器 Layer B / scale 感知需要。 */
export interface AuditKeyContext {
  keyRootPc: number;
  globalMode: KeyMode;
  isModalContext: boolean;
  scaleName?: string;                 // modal regime 的教会调式名
  tonalCharacter: 'tonal' | 'modal';
}

function findSpanAtTick(
  plan: HarmonicPlan,
  timebase: Timebase,
  tick: number,
): DeepReadonly<ChordSpan> | undefined {
  for (const span of plan.chordTimeline) {
    const start = timebase.beatToTick(span.startBeat);
    const end = start + timebase.beatToTick(span.durationBeats);
    if (tick >= start && tick < end) return span;
  }
  return undefined;
}

export function auditHarmony(ir: MusicalIR, plan: HarmonicPlan, timebase: Timebase, keyCtx?: AuditKeyContext): AuditReport {
  const findings: AuditFinding[] = [];
  const oneBeatTicks = timebase.beatToTick(beats(1));
  const twoBeatTicks = oneBeatTicks * 2; // 离调/倾向"持续暴露"门槛:1 拍走音/经过音不算,≥2 拍才是真暴露

  // span → 功能 + 序号(chordTimeline 与 chordFunctionTimeline 平行对齐;序号取下一和弦)
  const funcBySpan: Record<string, HarmonicFunction> = {};
  const idxBySpan: Record<string, number> = {};
  plan.chordTimeline.forEach((s, i) => { funcBySpan[s.id] = plan.chordFunctionTimeline[i]; idxBySpan[s.id] = i; });

  // —— R1/R2/R3:逐音判据 ——
  for (const track of ir.tracks) {
    if (track.role === 'drum') continue; // 打击通道非和声音
    for (const note of track.notes) {
      const span = findSpanAtTick(plan, timebase, note.startTick);
      if (!span) continue;
      const notePc = mod12(note.pitch);
      const isLong = note.durationTicks >= oneBeatTicks;
      const isSustained = note.durationTicks >= twoBeatTicks; // ≥2 拍 = 真持续暴露(排除走音/经过音)

      // R1 avoid 长暴露(error,触发纠错环)
      const avoid = plan.avoidNoteMap[span.id] ?? [];
      if (avoid.includes(notePc) && isLong) {
        findings.push({
          severity: 'error',
          location: { trackRole: track.role, startTick: note.startTick },
          ruleId: 'avoid-long-exposure',
          reason: `pc ${notePc} 是 ${span.id} 的 avoid note,长时值暴露(>=1 拍)`,
          suggestedReturnPoint: 'rewind-melody',
        });
        continue; // 已是 error,不再叠加同音 warning
      }

      // R2 离调暴露:【持续】音落在 chord-scale 之外(warning);1 拍 walking/经过音不算
      const scale = plan.chordScaleMap[span.id] ?? [];
      if (isSustained && scale.length > 0 && !scale.includes(notePc as never)) {
        findings.push({
          severity: 'warning',
          location: { trackRole: track.role, startTick: note.startTick },
          ruleId: 'chromatic-exposure',
          reason: `pc ${notePc} 不在 ${span.id} 的 chord-scale 内(离调长暴露 >=1 拍)`,
          suggestedReturnPoint: 'rewind-melody',
        });
        continue;
      }

      // R3 统一评判器:lead【持续】音走 evaluateNoteInChordContext(Layer A 和弦 + Layer B 调性融合)
      //   判 avoid 且急迫(urgency≥0.9)→ warning。需 keyCtx;无则跳过(向后兼容)。
      if (track.role === 'lead' && isSustained && keyCtx) {
        const idx = idxBySpan[span.id];
        const next = plan.chordTimeline[idx + 1];
        const modKey = plan.modulationMap[span.sectionId]?.toKey;
        const a = evaluateNoteInChordContext({
          notePc, chordType: span.quality, chordRootPc: span.rootPc,
          effectiveFunc: funcBySpan[span.id] ?? 'T',
          nextChordType: next ? next.quality : null,
          nextChordRootPc: next ? next.rootPc : null,
          keyRootPc: keyCtx.keyRootPc,
          globalMode: keyCtx.globalMode,
          isModalContext: keyCtx.isModalContext,
          scaleNameForBar: keyCtx.scaleName,
          tonalCharacter: keyCtx.tonalCharacter,
          localTonalCenterPc: modKey,
        });
        if (a.consonance === 'avoid' && a.urgency >= 0.9) {
          findings.push({
            severity: 'warning',
            location: { trackRole: track.role, startTick: note.startTick },
            ruleId: 'note-context-avoid',
            reason: `pc ${notePc} 在 ${span.id} 经统一评判器判 avoid(urgency ${a.urgency.toFixed(2)},应解决到 ${a.resolutionTargets.join('/')})`,
            suggestedReturnPoint: 'rewind-melody',
          });
        }
      }
    }
  }

  // —— R4:lead vs comp 垂直撞音(同时发声且【实际音程】小二度/小九度)——
  //   用真实音高距离(非 pc 类):只有相邻音区贴住才浊响;lead 与 bass 隔 >1 八度不算。
  const lead = ir.tracks.find((t) => t.role === 'lead')?.notes ?? [];
  const comp = ir.tracks.find((t) => t.role === 'comp')?.notes ?? [];
  const halfBeat = oneBeatTicks / 2;
  for (const ln of lead) {
    const lStart = ln.startTick as number;
    const lEnd = lStart + (ln.durationTicks as number);
    for (const cn of comp) {
      const cStart = cn.startTick as number;
      const cEnd = cStart + (cn.durationTicks as number);
      const overlap = Math.min(lEnd, cEnd) - Math.max(lStart, cStart);
      if (overlap < halfBeat) continue;
      const semi = Math.abs((ln.pitch as number) - (cn.pitch as number));
      if (semi === 1 || semi === 13) { // 实际小二度 / 小九度(贴音区)
        findings.push({
          severity: 'warning',
          location: { trackRole: 'lead', startTick: lStart },
          ruleId: 'dissonant-vertical-clash',
          reason: `lead ${ln.pitch} 与 comp ${cn.pitch} 实际${semi === 1 ? '小二度' : '小九度'}贴音同响(浊响)`,
          suggestedReturnPoint: 'rewind-melody',
        });
        break;
      }
    }
  }

  return { findings };
}
