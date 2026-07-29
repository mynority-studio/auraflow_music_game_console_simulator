// SPDX-License-Identifier: GPL-3.0-only
// ============================================================
// export-afe-audit-r3-lut — P2-2b 步1：R3 判定面 LUT（AR3L v1）生成器
// ------------------------------------------------------------
// 依据 afe 仓 docs/afe_p2_2b_audit_impl_design.md §1a（设计门五轮冻结）：
//   审计 R3 只消费评判器谓词 `consonance=='avoid' && urgency>=0.9`
//   （readOnlyHarmonyAuditor.ts:175），9 维离散输入空间全枚举 → 位表 blob。
//   评判器四件 KB = conservative IV-lineage（禁入 afe 引擎代码面）→ 以数据交付；
//   本产物血统 = conservative IV-lineage（NOTICE 履约随 P2-8b 打包）。
// AR3L v1 byte layout / 位表展平序 / LSB-first 位序 / FNV-1a64 digest（digest 字段
// 按 8×0x00 参与）逐条按设计 §1a 冻结表实现；typeIdx 序 = listChordTypes() 实际
// 返回序（JS Object.keys 语义，整数键升序前置）；blob 名表为唯一序真源。
// 运行: pnpm exec vitest run --config vitest.export.config.ts scripts/export-afe-audit-r3-lut.export.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mod12 } from '../src/core/generation/newEngine/foundation';
import { evaluateNoteInChordContext } from '../src/core/generation/newEngine/knowledge/melodyChordSemantics';
import { listChordTypes } from '../src/core/generation/newEngine/knowledge/chords';
import { MODAL_CHARACTERISTIC_NOTES } from '../src/core/generation/newEngine/knowledge/chordIntervalRoles';
import type { KeyMode } from '../src/core/generation/newEngine/knowledge/keyProfiles';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', 'core', 'tests', 'golden', 'afe_audit_r3_lut.json');
const SPEC_ANCHOR = 'Newengine_Demo-v5.0 (fb33e9eaa74cee6a1c882b3d710391e969e0462e)';

const FUNCS = ['T', 'S', 'D'] as const;
const MODES: KeyMode[] = ['major', 'minor'];

function fnv1a64(bytes: Uint8Array): bigint {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const b of bytes) { h ^= BigInt(b); h = (h * prime) & mask; }
  return h;
}

describe('export afe audit R3 LUT (AR3L v1)', () => {
  it('enumerates 9-dim closure and writes frozen payload', () => {
    const typeNames = listChordTypes() as readonly string[]; // 实际返回序 = 冻结 typeIdx 序
    const modalNames = Object.keys(MODAL_CHARACTERISTIC_NOTES); // 对象字面量序（无整数键）
    const T = typeNames.length;
    const M = modalNames.length;

    // charBit 派生素材：每 pc 的「含/不含」scaleName 机器选取（fail-closed）
    const containing: (string | undefined)[] = [];
    const nonContaining: (string | undefined)[] = [];
    for (let pc = 0; pc < 12; pc++) {
      containing.push(modalNames.find((n) => MODAL_CHARACTERISTIC_NOTES[n].includes(pc)));
      nonContaining.push(modalNames.find((n) => !MODAL_CHARACTERISTIC_NOTES[n].includes(pc)));
      expect(nonContaining[pc], `pc ${pc} 无不含特征音的 scaleName（不可实现 charBit=0）`).toBeDefined();
    }
    const reachable = [...new Set(modalNames.flatMap((n) => [...MODAL_CHARACTERISTIC_NOTES[n]]))].sort((a, b) => a - b);

    // ---- 位表：嵌套序 外→内 = pcFromChord, pcFromLocalKey, typeIdx, func, mode, modal, charBit, tonal, scaleState
    const bitCount = 12 * 12 * T * 3 * 2 * 2 * 2 * 2 * 3;
    const bits = new Uint8Array(Math.ceil(bitCount / 8));
    let idx = 0;
    let bitsSet = 0;
    const evalBit = (pcC: number, pcK: number, ti: number, fi: number, mi: number, modal: boolean, scaleName: string | undefined, tonal: 0 | 1, ss: 0 | 1 | 2): 0 | 1 => {
      const a = evaluateNoteInChordContext({
        notePc: pcC, chordRootPc: 0,
        chordType: typeNames[ti],
        effectiveFunc: FUNCS[fi],
        nextChordType: null, nextChordRootPc: null,
        keyRootPc: mod12(pcC - pcK),
        scaleNameForBar: scaleName,
        isModalContext: modal,
        localScalePcs: ss === 0 ? undefined : new Set([ss === 1 ? pcC : mod12(pcC + 1)]),
        tonalCharacter: tonal === 1 ? 'modal' : 'tonal',
        globalMode: MODES[mi],
      });
      return a.consonance === 'avoid' && a.urgency >= 0.9 ? 1 : 0;
    };
    for (let pcC = 0; pcC < 12; pcC++) {
      for (let pcK = 0; pcK < 12; pcK++) {
        for (let ti = 0; ti < T; ti++) {
          for (let fi = 0; fi < 3; fi++) {
            for (let mi = 0; mi < 2; mi++) {
              for (let modal = 0; modal < 2; modal++) {
                for (let cb = 0; cb < 2; cb++) {
                  // modal=0：scaleName 不参与判据 → 两 charBit 槽同值（undefined 计算）；
                  // modal=1 cb=0：不含特征音的 scaleName；cb=1：含（不可达 pc → 冻结规则填 cb=0 同值）
                  const scaleName = modal === 0 ? undefined : cb === 0 ? nonContaining[pcC] : (containing[pcC] ?? nonContaining[pcC]);
                  for (let tonal = 0; tonal < 2; tonal++) {
                    for (let ss = 0; ss < 3; ss++) {
                      // 展平公式（设计 §1a 冻结）与运行游标一致性双算
                      const formula = ((((((((pcC * 12 + pcK) * T + ti) * 3 + fi) * 2 + mi) * 2 + modal) * 2 + cb) * 2 + tonal) * 3 + ss);
                      if (formula !== idx) throw new Error(`idx 公式 ${formula} ≠ 循环游标 ${idx}`);
                      const v = evalBit(pcC, pcK, ti, fi, mi, modal === 1, scaleName, tonal as 0 | 1, ss as 0 | 1 | 2);
                      if (v) { bits[idx >> 3] |= 1 << (idx & 7); bitsSet++; }
                      idx++;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    expect(idx).toBe(bitCount);

    // ---- 定点抓手：conformance note-context-avoid trigger/nontrigger 对应位 ----
    // trigger: pc5 on maj@T, major/tonal/非modal, localScale 含 npc（audit_conformance_v5.json）
    const tiMaj = typeNames.indexOf('maj');
    const at = (pcC: number, pcK: number, ti: number, fi: number, mi: number, modal: number, cb: number, tonal: number, ss: number) => {
      const i = ((((((((pcC * 12 + pcK) * T + ti) * 3 + fi) * 2 + mi) * 2 + modal) * 2 + cb) * 2 + tonal) * 3 + ss);
      return (bits[i >> 3] >> (i & 7)) & 1;
    };
    expect(at(5, 5, tiMaj, 0, 0, 0, 0, 0, 1), 'note-context-avoid__trigger 位').toBe(1);
    expect(at(0, 0, tiMaj, 0, 0, 0, 0, 0, 1), 'note-context-avoid__nontrigger 位').toBe(0);

    // ---- AR3L v1 payload 组装（设计 §1a byte layout 冻结表）----
    const enc = new TextEncoder();
    const align4 = (n: number) => (n + 3) & ~3;
    const namesBytes: number[] = [];
    for (const n of typeNames) { namesBytes.push(...enc.encode(n), 0); }
    const modalBytes: number[] = [];
    for (const n of modalNames) {
      modalBytes.push(...enc.encode(n), 0);
      let mask = 0;
      for (const pc of MODAL_CHARACTERISTIC_NOTES[n]) mask |= 1 << pc;
      modalBytes.push(mask & 0xff, (mask >> 8) & 0xff);
    }
    const namesOff = 56;
    const namesLen = namesBytes.length;
    const modalOff = align4(namesOff + namesLen);
    const modalLen = modalBytes.length;
    const bitsOff = align4(modalOff + modalLen);
    const bitsLen = bits.length;
    const total = bitsOff + bitsLen;
    const payload = new Uint8Array(total); // 间隙自然 0 填充
    const dv = new DataView(payload.buffer);
    payload.set(enc.encode('AR3L'), 0);
    dv.setUint16(4, 1, true);
    dv.setUint16(6, 0, true);
    dv.setUint32(8, T, true);
    dv.setUint32(12, M, true);
    dv.setUint32(16, bitCount, true);
    dv.setUint32(20, namesOff, true);
    dv.setUint32(24, namesLen, true);
    dv.setUint32(28, modalOff, true);
    dv.setUint32(32, modalLen, true);
    dv.setUint32(36, bitsOff, true);
    dv.setUint32(40, bitsLen, true);
    dv.setUint32(44, 0, true);
    // digest@48 先置 0 参与计算
    payload.set(namesBytes, namesOff);
    payload.set(modalBytes, modalOff);
    payload.set(bits, bitsOff);
    const digest = fnv1a64(payload);
    dv.setBigUint64(48, digest, true);

    const json = {
      schemaVersion: 'afe_audit_r3_lut_v1',
      format: 'AR3L v1 (FourCC R3LU; docs/afe_p2_2b_audit_impl_design.md §1a 冻结 byte layout)',
      provenance: {
        specAnchor: SPEC_ANCHOR,
        generator: 'scripts/export-afe-audit-r3-lut.export.test.ts',
        lineage: 'conservative IV-lineage（melodyChordSemantics 评判器全枚举产物；GPL 数据包 afe_corpus_iv.afas R3LU 段承载，P2-8b 打包）',
        predicate: "consonance=='avoid' && urgency>=0.9 (readOnlyHarmonyAuditor.ts R3)",
        rebuild: 'pnpm exec vitest run --config vitest.export.config.ts scripts/export-afe-audit-r3-lut.export.test.ts',
      },
      typeCount: T, modalCount: M, bitCount, bitsSet,
      reachableCharPcs: reachable,
      typeNames: [...typeNames],
      modal: modalNames.map((n) => ({ name: n, pcs: [...MODAL_CHARACTERISTIC_NOTES[n]] })),
      digestHex: digest.toString(16).padStart(16, '0'),
      payloadLen: total,
      payloadBase64: Buffer.from(payload).toString('base64'),
    };
    writeFileSync(OUT, JSON.stringify(json, null, 1) + '\n');
    console.error(`AR3L v1: types=${T} modal=${M} bits=${bitCount} set=${bitsSet} payload=${total}B digest=${json.digestHex}`);
  });
});
