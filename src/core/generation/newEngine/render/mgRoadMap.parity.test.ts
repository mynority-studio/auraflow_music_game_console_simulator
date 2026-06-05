import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildChordPart, type MgChordDef } from './mgChordPart';
import { parseRoadMap, type RoadMap } from './mgRoadMapParser';

// ============================================================
// MG strict 移植 Loop 2 — RoadMap parity 锁
// ------------------------------------------------------------
// 终止判据(directive):RoadMap fixture 与 MG 精确一致。
// 把每个 oracle fixture 的真源 MG ChordDef[] 喂入【我们忠实港】的 buildChordPart →
// parseRoadMap(songKeyPc),deepEqual MG 自己跑出的 roadMap(dump-mg-oracle.ts 写入)。
// 同算法 + 同数据 ⇒ bit 级一致;任何端口偏离立刻红。
// ============================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const ORACLE_DIR = join(HERE, '__mgOracle__');

interface OracleFixture {
  seed: string;
  style: string;
  key: string;
  songKeyPc: number;
  chords: MgChordDef[];
  roadMap: RoadMap;
}

const fixtures: OracleFixture[] = readdirSync(ORACLE_DIR)
  .filter((f) => f.endsWith('.json') && f !== '_index.json')
  .sort()
  .map((f) => JSON.parse(readFileSync(join(ORACLE_DIR, f), 'utf8')) as OracleFixture);

describe('render/mgRoadMapParser · MG 移植 RoadMap parity (Loop 2)', () => {
  it('加载到 9 个 oracle fixture(含 roadMap)', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(9);
    for (const fx of fixtures) {
      expect(fx.roadMap).toBeDefined();
      expect(Array.isArray(fx.roadMap.bricks)).toBe(true);
      expect(fx.roadMap.bricks.length).toBeGreaterThan(0);
    }
  });

  for (const fx of fixtures) {
    it(`★ ${fx.seed} [${fx.style}] RoadMap 与 MG 精确一致`, () => {
      const part = buildChordPart(fx.chords);
      const ours = parseRoadMap({ part, songKeyPc: fx.songKeyPc });
      // 精确相等:bricks(name/family/startBeat/durationBeats/chordIndices/keyPc/cost)
      // + totalCost(浮点须 bit 一致)+ segments。
      expect(ours).toEqual(fx.roadMap);
    });
  }

  it('确定性:同输入重复解析结果一致', () => {
    const fx = fixtures[0];
    const a = parseRoadMap({ part: buildChordPart(fx.chords), songKeyPc: fx.songKeyPc });
    const b = parseRoadMap({ part: buildChordPart(fx.chords), songKeyPc: fx.songKeyPc });
    expect(a).toEqual(b);
  });

  it('每个 fixture 的 bricks 连续覆盖全部 chord(无缺口/重叠)', () => {
    for (const fx of fixtures) {
      const covered = fx.roadMap.bricks.flatMap((b) => b.chordIndices);
      expect(covered).toEqual(fx.chords.map((_, i) => i)); // [0..n-1] 顺序连续
    }
  });
});
