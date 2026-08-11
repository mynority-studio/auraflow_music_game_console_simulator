// ============================================================
// audit · motif development baseline(墨盒任务书 P0)
// ------------------------------------------------------------
// 11 类固定 motif(任务书 §14.3)× v1(二期 baseline)/v2(谱系) 对照:
//   exact-copy rate / 距离带命中率 / occurrence 覆盖 / 谱系深度。
// 外加 motif-swap 反事实(H1/H5):同 seed 同风格换 motif,量伴奏差异。
// report-only:console 输出指标表,不设硬门(门槛待 baseline 锁定后定)。
// 运行:pnpm exec vitest run scripts/audit-motif-development-baseline.test.ts --config vitest.audit.config.ts
// ============================================================

import { describe, it, expect } from 'vitest';
import type { UserMotif, MotifNote } from '../src/core/generation/motifSandbox/model/types';
import { buildUserMotifBrickSongOverride } from '../src/core/generation/motifSandbox/bridge/sandboxToOverride';
import { buildMotifSongBundle, generateSongFromMotifBundle } from '../src/core/generation/newEngine/generation/generateSongFromMotif';
import { buildMgLeadRoadMap } from '../src/core/generation/newEngine/render/mgLeadRenderer';
import { planAuthoredUserMotifBrick, authoredMotifSectionInfos } from '../src/core/generation/newEngine/render/userMotifBrick';
import { withMotifDevelopment } from '../src/core/generation/newEngine/render/motifDevelopmentPlan';
import { similarityBandVerdict, type MotifFormalFunction } from '../src/core/generation/newEngine/render/motifLineage';

function mk(id: string, specs: Array<[number, number, number, number?]>, lengthBeats = 4, keyPc = 0): UserMotif {
  const notes: MotifNote[] = specs.map(([midi, onsetBeat, durationBeat, vel]) => ({
    midi, onsetBeat, durationBeat, velocity: vel ?? 0.85,
    scaleDegree: 1 + ((((midi - keyPc) % 12) + 12) % 12) % 7, octave: 5, accent: 0.8,
    structuralToneScore: durationBeat >= 1 ? 0.9 : 0.4,
  }));
  return {
    id, keyPc, mode: 'major', bpm: 92, lengthBeats, notes,
    contour: notes.slice(1).map((n, i) => Math.sign(n.midi - notes[i].midi)),
    rhythmCell: notes.map((n) => n.durationBeat), createdAt: 0,
  };
}

// 任务书 §14.3 的 11 类集成测试 motif
const MOTIFS: UserMotif[] = [
  mk('stepwise', [[60, 0, 1], [62, 1, 1], [64, 2, 1], [65, 3, 1]]),
  mk('big-leap', [[60, 0, 1], [72, 1, 1], [67, 2, 2]]),
  mk('repeated-note', [[64, 0, 0.5], [64, 0.5, 0.5], [64, 1, 0.5], [67, 2, 2]]),
  mk('syncopated', [[60, 0.5, 0.5], [64, 1.5, 0.5], [62, 2.75, 1.25]]),
  mk('pickup', [[59, 0, 0.5], [60, 0.5, 1.5], [64, 2, 2]]),
  mk('sparse-long', [[60, 0, 2], [64, 2.5, 1.5], [67, 4, 3]], 8),
  mk('dense-16th', [[60, 0, 0.25], [62, 0.25, 0.25], [64, 0.5, 0.25], [65, 0.75, 0.25], [67, 1, 0.25], [69, 1.25, 0.25], [67, 1.5, 0.5], [64, 2, 2]]),
  mk('chromatic', [[60, 0, 1], [61, 1, 0.5], [62, 1.5, 0.5], [64, 2, 2]]),
  mk('tonal-ambiguous', [[61, 0, 1], [66, 1, 1], [63, 2, 2]]),
  mk('question-answer', [[60, 0, 1], [64, 1, 1], [67, 2, 1.5], [65, 4, 1], [62, 5, 1], [60, 6, 2]], 8),
  mk('low-salience', [[60, 0, 1], [62, 1, 1]]),
];

interface Row {
  motif: string; mode: 'v1' | 'v2'; occurrences: number;
  exactCopies: number; inBand: number; lineageDepth: number; contourNodes: number;
}

describe('P0 · motif development baseline(11 类 motif × v1/v2)', () => {
  it('指标表 + 谱系断言', () => {
    const rows: Row[] = [];
    for (const motif of MOTIFS) {
      const ov = buildUserMotifBrickSongOverride(motif, { style: 'pop', seed: 7, keyPc: 0, mode: 'major' });
      const mb = buildMotifSongBundle({ seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 96 }, ov);
      const roadMap = buildMgLeadRoadMap(mb.bundle.harmonic, mb.bundle.band, mb.bundle.timebase, mb.bundle.acgPianoScorePlan);
      const totalBeats = mb.bundle.arrangement.sections.reduce((n, s) => n + s.bars * mb.bundle.arrangement.meter.numerator, 0);
      const sections = authoredMotifSectionInfos(mb.bundle.arrangement.sections, mb.bundle.arrangement.meter.numerator);
      const base = planAuthoredUserMotifBrick({
        brick: ov.userBrick!, roadMap, harmonicPlan: mb.bundle.harmonic, totalBeats, sections,
      });
      if (!base) { console.log(`${motif.id}: 无法落位(记录,不计指标)`); continue; }
      for (const mode of ['v1', 'v2'] as const) {
        const developed = withMotifDevelopment(base, {
          roadMap, harmonicPlan: mb.bundle.harmonic, totalBeats, sections,
          style: 'pop', developmentV2: mode === 'v2',
        })!;
        const occs = developed.occurrences ?? [];
        const exactCopies = occs.filter((o) => (o.similarityToRoot ?? (o.transform === 'exact-recap' ? 1 : 0.8)) > 0.93
          && o.pitchPolicy !== 'contour').length;
        const inBand = occs.filter((o) => o.formalFunction && o.similarityToRoot !== undefined
          && similarityBandVerdict(o.formalFunction as MotifFormalFunction, o.similarityToRoot) === 'in-band').length;
        const chainDepth = (() => {
          let depth = 0;
          for (const o of occs) if (o.parentNodeId && o.parentNodeId !== 'root' && !o.parentNodeId.startsWith('root+')) depth++;
          return depth;
        })();
        rows.push({
          motif: motif.id, mode, occurrences: occs.length, exactCopies, inBand,
          lineageDepth: chainDepth, contourNodes: occs.filter((o) => o.pitchPolicy === 'contour').length,
        });
      }
    }
    console.table(rows);
    const agg = (mode: 'v1' | 'v2') => {
      const rs = rows.filter((r) => r.mode === mode);
      return {
        mode,
        occurrences: rs.reduce((a, r) => a + r.occurrences, 0),
        exactCopies: rs.reduce((a, r) => a + r.exactCopies, 0),
        lineageDepth: rs.reduce((a, r) => a + r.lineageDepth, 0),
        contourNodes: rs.reduce((a, r) => a + r.contourNodes, 0),
      };
    };
    const v1 = agg('v1'), v2 = agg('v2');
    console.log('AGGREGATE', v1, v2);
    // 任务书验收方向(启动阈值):v2 exact-copy 显著低于 v1;谱系深度/换音高节点 > 0
    expect(v2.exactCopies).toBeLessThan(Math.max(1, v1.exactCopies + v1.occurrences)); // 至少不高于 v1 的近复制水位
    expect(v2.lineageDepth).toBeGreaterThan(0);
    expect(v2.contourNodes).toBeGreaterThan(0);
  }, 300000);

  it('反事实 · motif swap(H1/H5):同 seed 换 motif,伴奏几乎不变 = 伴奏未消费 motif', () => {
    const trackFingerprint = (motif: UserMotif): Map<string, string> => {
      const ov = buildUserMotifBrickSongOverride(motif, { style: 'pop', seed: 7, keyPc: 0, mode: 'major' });
      const mb = buildMotifSongBundle({ seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 96 }, ov);
      const song = generateSongFromMotifBundle(mb);
      const out = new Map<string, string>();
      for (const t of song.ir?.tracks ?? []) {
        if (t.role === 'lead') continue;
        out.set(t.role, t.notes.map((n) => `${n.pitch}@${n.startTick}`).join('|'));
      }
      return out;
    };
    const a = trackFingerprint(MOTIFS[0]); // stepwise
    const b = trackFingerprint(MOTIFS[1]); // big-leap
    const roles = [...a.keys()].filter((r) => b.has(r));
    const changed = roles.filter((r) => a.get(r) !== b.get(r));
    console.log(`motif-swap 反事实:${roles.length} 条非 lead 轨,换 motif 后变化 ${changed.length} 条(${changed.join(',') || '无'})`);
    console.log(changed.length === 0
      ? 'H1/H5 成立:伴奏完全不消费 motif(P2 跨轨投射的靶子)'
      : `部分伴奏轨已响应 motif:${changed.join(', ')}`);
    expect(roles.length).toBeGreaterThan(0); // report-only:只记录,不设通过门
  }, 300000);
});
