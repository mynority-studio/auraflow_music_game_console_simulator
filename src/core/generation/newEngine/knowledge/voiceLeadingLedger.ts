// ============================================================
// newEngine · knowledge · VoiceLeadingLedger(声部进行义务 + 评分,B-port 纯规则)
// ------------------------------------------------------------
// Provenance:忠实 port 自 melodygenerative/src/lib/voiceLeadingLedger.ts。
// "债务模型":dom3→上行半音 / dom7→下行半音 / maj7→飘 6 或升 1 / 借和弦色彩→级进归位 /
//   bass→5 度下行。逐义务核对目标和弦是否在 maxMotion 内落到 expected pc → 评分(诊断,不改生成)。
// 输入 = LedgerChord(ChordDef 的 type/rootMidi/notesMidi/bassMidi/borrowedFrom 子集)。
// ============================================================

const pc = (m: number): number => ((m % 12) + 12) % 12;

/** 评分输入:消费方按此 shape 喂和弦(我方 ChordSpan→此结构由消费层适配)。 */
export interface LedgerChord {
  type: string;
  rootMidi: number;
  notesMidi: number[];
  bassMidi?: number;
  borrowedFrom?: string;
}

export type VoiceLeadingRole = 'dom3' | 'dom7' | 'maj7' | 'borrowedColor' | 'bassLeading';

export interface VoiceLeadingObligation {
  id: string;
  sourceChordIndex: number;
  sourceVoiceMidi: number;
  sourceRole: VoiceLeadingRole;
  expectedTargetPcs: number[];
  maxMotion: number;
  deadlineChordIndex: number;
  severity: 'hard' | 'medium' | 'soft';
}

export interface VoiceLeadingResolution {
  obligation: VoiceLeadingObligation;
  actualTargetMidi: number | null;
  actualMotion: number | null;
  pcHit: boolean;
  motionOk: boolean;
  score: number;
}

export interface VoiceLeadingReport {
  obligations: VoiceLeadingObligation[];
  resolutions: VoiceLeadingResolution[];
  overallScore: number;
  stats: { total: number; fullyResolved: number; pcOnlyHit: number; pcMissing: number };
}

// —— 和弦品质判定(本地,避免耦合)——
function isDominantChord(type: string): boolean {
  if (type.includes('maj')) return false;
  if (type.startsWith('m')) return false;
  if (type.includes('b5')) return false;
  if (type.startsWith('dim') || type.startsWith('aug')) return false;
  if (type === '6' || type === '6/9' || type === 'add9') return false;
  if (type === 'sus' || type === 'sus2' || type === 'sus4') return false;
  return /^(\d|sus\d|alt)/.test(type) || /\d/.test(type);
}
function isMajor7Chord(type: string): boolean {
  return /maj(7|9|11|13)/.test(type);
}

/** 找和弦内 pc 等于 targetPc 的实际 voice(取最高,偏 RH 张力音);无 → null。 */
function findVoiceWithPc(chord: LedgerChord, targetPc: number): number | null {
  const candidates: number[] = [...chord.notesMidi];
  if (typeof chord.bassMidi === 'number') candidates.push(chord.bassMidi);
  const matches = candidates.filter((m) => pc(m) === targetPc);
  if (matches.length === 0) return null;
  return Math.max(...matches);
}

/** 逐和弦构建声部进行义务(dom3/dom7/bass/maj7/borrowed)。 */
export function buildVoiceLeadingLedger(chords: LedgerChord[]): VoiceLeadingObligation[] {
  const out: VoiceLeadingObligation[] = [];
  let idCounter = 0;

  for (let i = 0; i < chords.length - 1; i++) {
    const src = chords[i];
    const tgt = chords[i + 1];
    const srcRootPc = pc(src.rootMidi);
    const tgtRootPc = pc(tgt.rootMidi);

    if (isDominantChord(src.type)) {
      const dom3Pc = pc(srcRootPc + 4);
      const dom3Midi = findVoiceWithPc(src, dom3Pc);
      if (dom3Midi !== null) {
        out.push({ id: `vl_${idCounter++}_dom3_${i}`, sourceChordIndex: i, sourceVoiceMidi: dom3Midi, sourceRole: 'dom3', expectedTargetPcs: [pc(dom3Midi + 1), tgtRootPc], maxMotion: 2, deadlineChordIndex: i + 1, severity: 'hard' });
      }
      const dom7Pc = pc(srcRootPc + 10);
      const dom7Midi = findVoiceWithPc(src, dom7Pc);
      if (dom7Midi !== null) {
        out.push({ id: `vl_${idCounter++}_dom7_${i}`, sourceChordIndex: i, sourceVoiceMidi: dom7Midi, sourceRole: 'dom7', expectedTargetPcs: [pc(dom7Midi - 1), pc(dom7Midi + 1)], maxMotion: 2, deadlineChordIndex: i + 1, severity: 'hard' });
      }
      const srcBass = src.bassMidi;
      if (typeof srcBass === 'number') {
        out.push({ id: `vl_${idCounter++}_bassLead_${i}`, sourceChordIndex: i, sourceVoiceMidi: srcBass, sourceRole: 'bassLeading', expectedTargetPcs: [pc(srcBass - 5), pc(srcBass - 7), tgtRootPc], maxMotion: 7, deadlineChordIndex: i + 1, severity: 'medium' });
      }
    }

    if (isMajor7Chord(src.type) && srcRootPc !== tgtRootPc) {
      const maj7Pc = pc(srcRootPc + 11);
      const maj7Midi = findVoiceWithPc(src, maj7Pc);
      if (maj7Midi !== null) {
        out.push({ id: `vl_${idCounter++}_maj7_${i}`, sourceChordIndex: i, sourceVoiceMidi: maj7Midi, sourceRole: 'maj7', expectedTargetPcs: [pc(maj7Midi - 1), pc(maj7Midi - 2), pc(maj7Midi + 1)], maxMotion: 2, deadlineChordIndex: i + 1, severity: 'soft' });
      }
    }

    if (src.borrowedFrom && src.borrowedFrom !== '') {
      const chordTriadPcs = new Set([srcRootPc, pc(srcRootPc + 3), pc(srcRootPc + 4), pc(srcRootPc + 7)]);
      for (const m of src.notesMidi) {
        if (!chordTriadPcs.has(pc(m))) {
          out.push({ id: `vl_${idCounter++}_borrow_${i}_${m}`, sourceChordIndex: i, sourceVoiceMidi: m, sourceRole: 'borrowedColor', expectedTargetPcs: [pc(m - 1), pc(m - 2), pc(m + 1), pc(m + 2)], maxMotion: 2, deadlineChordIndex: i + 1, severity: 'soft' });
        }
      }
    }
  }

  return out;
}

/**
 * 逐义务在 deadline 和弦里找距 source 最近的 voice,核对 pc 命中 + 位移 ≤ maxMotion:
 *   1.0 两者全中 · 0.5 仅 pc 中(跳进)· 0.2 仅平滑(落别处)· 0.0 都不中。按 severity 加权。
 */
export function scoreVoiceLeading(obligations: VoiceLeadingObligation[], chords: LedgerChord[]): VoiceLeadingReport {
  const resolutions: VoiceLeadingResolution[] = [];
  const severityWeight: Record<VoiceLeadingObligation['severity'], number> = { hard: 1.0, medium: 0.6, soft: 0.3 };
  let weightTotal = 0;
  let weightedScore = 0;
  const stats = { total: 0, fullyResolved: 0, pcOnlyHit: 0, pcMissing: 0 };

  for (const o of obligations) {
    const tgt = chords[o.deadlineChordIndex];
    if (!tgt) continue;
    stats.total++;

    const tgtVoices = [...tgt.notesMidi];
    if (typeof tgt.bassMidi === 'number') tgtVoices.push(tgt.bassMidi);
    if (tgtVoices.length === 0) {
      resolutions.push({ obligation: o, actualTargetMidi: null, actualMotion: null, pcHit: false, motionOk: false, score: 0 });
      stats.pcMissing++;
      continue;
    }

    let nearest = tgtVoices[0];
    let nearestDist = Math.abs(tgtVoices[0] - o.sourceVoiceMidi);
    for (const v of tgtVoices) {
      const d = Math.abs(v - o.sourceVoiceMidi);
      if (d < nearestDist) { nearest = v; nearestDist = d; }
    }

    const pcHit = o.expectedTargetPcs.includes(pc(nearest));
    const motionOk = nearestDist <= o.maxMotion;

    let perScore = 0;
    if (pcHit && motionOk) { perScore = 1.0; stats.fullyResolved++; }
    else if (pcHit) { perScore = 0.5; stats.pcOnlyHit++; }
    else if (motionOk) { perScore = 0.2; stats.pcMissing++; }
    else { perScore = 0.0; stats.pcMissing++; }

    const w = severityWeight[o.severity];
    weightTotal += w;
    weightedScore += w * perScore;
    resolutions.push({ obligation: o, actualTargetMidi: nearest, actualMotion: nearestDist, pcHit, motionOk, score: perScore });
  }

  return { obligations, resolutions, overallScore: weightTotal > 0 ? weightedScore / weightTotal : 1, stats };
}

/** build + score 一步到位。 */
export function evaluateVoiceLeading(chords: LedgerChord[]): VoiceLeadingReport {
  return scoreVoiceLeading(buildVoiceLeadingLedger(chords), chords);
}
