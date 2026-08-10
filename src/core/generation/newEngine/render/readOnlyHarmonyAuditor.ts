// ============================================================
// newEngine · render · ReadOnlyHarmonyAuditor(只读终检)
// ------------------------------------------------------------
// 架构定稿 Part 2.10 / 铁律19:只读、严格、只判和声/音程,不审密度。
// 显式 bass pedal 是和声计划层意图,审计不把 pedal 本音回卷成生成失败。
// 规则(判据来自共享 KB,铁律21):
//   R1 avoid-long-exposure   [error]  : avoidNoteMap 命中 + ≥1 拍长暴露 → 触发纠错环
//   R2 chromatic-exposure    [warning]: 非鼓轨长音落在 chord-scale 之外(离调暴露)
//   R3 note-context-avoid    [warning]: lead 持续音走【统一评判器 evaluateNoteInChordContext】判 avoid
//                                       (Layer A 和弦 + Layer B 调性 max-merge,需 keyCtx;切到统一 KB API)
//   R4 dissonant-vert-clash  [warning]: lead vs comp 同时发声且实际小二度/小九度(浊响撞音)
// warning 不阻断(controller 带 warning 通过),作产品级安全网;error 才回卷重跑。
// ============================================================

import { beats, mod12, ticks, type DeepReadonly, type Timebase } from '../foundation';
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

interface ChordExposure {
  span: DeepReadonly<ChordSpan>;
  spanStartTick: number;
  startTick: number;
  durationTicks: number;
}

/** 一个持续音在每个和弦内的实际暴露区间；阈值按区间而不是整音时值计算。 */
function findChordExposures(
  plan: HarmonicPlan,
  timebase: Timebase,
  noteStart: number,
  noteEnd: number,
): ChordExposure[] {
  const exposures: ChordExposure[] = [];
  for (const span of plan.chordTimeline) {
    const spanStart = timebase.beatToTick(span.startBeat) as number;
    const spanEnd = spanStart + (timebase.beatToTick(span.durationBeats) as number);
    const overlapStart = Math.max(noteStart, spanStart);
    const overlapEnd = Math.min(noteEnd, spanEnd);
    if (overlapEnd <= overlapStart) continue;
    exposures.push({ span, spanStartTick: spanStart, startTick: overlapStart, durationTicks: overlapEnd - overlapStart });
  }
  return exposures;
}

function isDeclaredBassPedalExposure(
  trackRole: string,
  notePc: number,
  span: DeepReadonly<ChordSpan>,
): boolean {
  return trackRole === 'bass'
    && span.bassRole === 'pedal'
    && span.bassPedalPc !== undefined
    && notePc === (span.bassPedalPc as number);
}

export function auditHarmony(
  ir: MusicalIR,
  plan: HarmonicPlan,
  timebase: Timebase,
  keyCtx?: AuditKeyContext,
  /** 用户 motif 的 authored lead 窗口:窗内 lead 音的 R1/R1b 降级为 warning(quote 保护 —
   *  用户音高是既定事实,和声已按 motif 尽力选择;镜像沙盒 quoteStructuralUnsupported 哲学)。 */
  authoredLeadWindows?: readonly { startBeat: number; endBeat: number }[],
): AuditReport {
  const findings: AuditFinding[] = [];
  const authoredTickWindows = (authoredLeadWindows ?? []).map((w) => ({
    start: timebase.beatToTick(beats(w.startBeat)) as number,
    end: timebase.beatToTick(beats(w.endBeat)) as number,
  }));
  const isAuthoredLeadNote = (trackRole: string, noteStart: number, noteEnd: number): boolean =>
    trackRole === 'lead' && authoredTickWindows.some((w) => noteStart < w.end - 1 && noteEnd > w.start + 1);
  const oneBeatTicks = timebase.beatToTick(beats(1));
  const twoBeatTicks = oneBeatTicks * 2; // 离调/倾向"持续暴露"门槛:1 拍走音/经过音不算,≥2 拍才是真暴露
  const structuralTicks = Math.round(oneBeatTicks * 0.75);
  const beatsPerBar = timebase.meter.numerator * (4 / timebase.meter.denominator);
  const metricTolerance = oneBeatTicks * 0.08;

  // span → 功能 + 序号(chordTimeline 与 chordFunctionTimeline 平行对齐;序号取下一和弦)
  const funcBySpan: Record<string, HarmonicFunction> = {};
  const idxBySpan: Record<string, number> = {};
  plan.chordTimeline.forEach((s, i) => { funcBySpan[s.id] = plan.chordFunctionTimeline[i]; idxBySpan[s.id] = i; });

  // —— R1/R2/R3:逐音判据 ——
  for (const track of ir.tracks) {
    if (track.role === 'drum') continue; // 打击通道非和声音
    for (const note of track.notes) {
      const noteStart = note.startTick as number;
      const noteEnd = noteStart + (note.durationTicks as number);
      const exposures = findChordExposures(plan, timebase, noteStart, noteEnd);
      if (exposures.length === 0) continue;
      const notePc = mod12(note.pitch);

      // R1 avoid 长暴露(error,触发纠错环)。整音跨和弦时逐 span 计算实际暴露,
      // 但同一音只报告首个最高优先级 finding,避免一个待修音重复刷屏。
      const avoidExposure = exposures.find(({ span, durationTicks }) => {
        const avoid = plan.avoidNoteMap[span.id] ?? [];
        return durationTicks >= oneBeatTicks
          && avoid.includes(notePc)
          && !isDeclaredBassPedalExposure(track.role, notePc, span);
      });
      if (avoidExposure) {
        const authored = isAuthoredLeadNote(track.role, noteStart, noteEnd);
        findings.push({
          severity: authored ? 'warning' : 'error',
          location: { trackRole: track.role, startTick: avoidExposure.startTick },
          ruleId: 'avoid-long-exposure',
          reason: `pc ${notePc} 是 ${avoidExposure.span.id} 的 avoid note,在该和弦内长时值暴露(>=1 拍)${authored ? '(authored user quote,不回卷)' : ''}`,
          suggestedReturnPoint: 'rewind-melody',
        });
        continue; // 已是最高级 finding,不再叠加同音 warning
      }

      // R1b 最终结构落点必须属于 chord contract ∩ local scale。结构 = 和弦入口/强拍/在某和弦内
      // 暴露至少 0.75 拍；跨边界后仍长时间保持也视为新和弦的结构悬挂。
      if (track.role === 'lead') {
        const structuralExposure = exposures.find(({ span, spanStartTick, startTick, durationTicks }) => {
          const contract = new Set<number>([...(plan.stableToneMap[span.id] ?? []), ...(plan.colorToneMap[span.id] ?? [])]);
          const scale = new Set<number>(plan.chordScaleMap[span.id] ?? []);
          const legal = [...contract].filter((pc) => scale.has(pc) && !(plan.avoidNoteMap[span.id] ?? []).includes(pc as never));
          if (legal.length === 0 || legal.includes(notePc)) return false;
          const isOnsetExposure = Math.abs(startTick - noteStart) <= 1;
          const beat = timebase.tickToBeat(ticks(startTick)) as number;
          const phase = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
          const strong = Math.min(Math.abs(phase), Math.abs(phase - beatsPerBar), Math.abs(phase - beatsPerBar / 2)) * oneBeatTicks <= metricTolerance;
          const chordEntrance = Math.abs(startTick - spanStartTick) <= metricTolerance;
          return durationTicks >= structuralTicks || (isOnsetExposure && (strong || chordEntrance));
        });
        if (structuralExposure) {
          const authored = isAuthoredLeadNote(track.role, noteStart, noteEnd);
          findings.push({
            severity: authored ? 'warning' : 'error',
            location: { trackRole: track.role, startTick: structuralExposure.startTick },
            ruleId: 'structural-tone-outside-intersection',
            reason: `pc ${notePc} 在 ${structuralExposure.span.id} 是结构落点,但不属于 chord contract ∩ local scale${authored ? '(authored user quote,不回卷)' : ''}`,
            suggestedReturnPoint: 'rewind-melody',
          });
          continue;
        }
      }

      // R2 离调暴露:【持续】音落在 chord-scale 之外(warning);每个和弦内不足 2 拍仍视为经过。
      const chromaticExposure = exposures.find(({ span, durationTicks }) => {
        const scale = plan.chordScaleMap[span.id] ?? [];
        return durationTicks >= twoBeatTicks && scale.length > 0 && !scale.includes(notePc as never);
      });
      if (chromaticExposure) {
        findings.push({
          severity: 'warning',
          location: { trackRole: track.role, startTick: chromaticExposure.startTick },
          ruleId: 'chromatic-exposure',
          reason: `pc ${notePc} 不在 ${chromaticExposure.span.id} 的 chord-scale 内(在该和弦内离调长暴露 >=2 拍)`,
          suggestedReturnPoint: 'rewind-melody',
        });
        continue;
      }

      // R3 统一评判器:lead【持续】音走 evaluateNoteInChordContext(Layer A 和弦 + Layer B 调性融合)
      //   判 avoid 且急迫(urgency≥0.9)→ warning。需 keyCtx;无则跳过(向后兼容)。
      if (track.role === 'lead' && keyCtx) {
        for (const { span, startTick, durationTicks } of exposures) {
          if (durationTicks < twoBeatTicks) continue;
          const idx = idxBySpan[span.id];
          const next = plan.chordTimeline[idx + 1];
          const modKey = plan.modulationMap[span.sectionId]?.toKey;
          const localScalePcs = new Set<number>(plan.chordScaleMap[span.id] ?? []);
          const a = evaluateNoteInChordContext({
            notePc, chordType: span.chordType ?? String(span.quality), chordRootPc: span.rootPc,
            effectiveFunc: funcBySpan[span.id] ?? 'T',
            nextChordType: next ? (next.chordType ?? String(next.quality)) : null,
            nextChordRootPc: next ? next.rootPc : null,
            keyRootPc: keyCtx.keyRootPc,
            globalMode: keyCtx.globalMode,
            isModalContext: keyCtx.isModalContext,
            scaleNameForBar: keyCtx.scaleName,
            localScalePcs,
            tonalCharacter: keyCtx.tonalCharacter,
            localTonalCenterPc: span.localTonalCenterPc ?? modKey,
          });
          if (a.consonance !== 'avoid' || a.urgency < 0.9) continue;
          findings.push({
            severity: 'warning',
            location: { trackRole: track.role, startTick },
            ruleId: 'note-context-avoid',
            reason: `pc ${notePc} 在 ${span.id} 经统一评判器判 avoid(urgency ${a.urgency.toFixed(2)},应解决到 ${a.resolutionTargets.join('/')})`,
            suggestedReturnPoint: 'rewind-melody',
          });
          break;
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
