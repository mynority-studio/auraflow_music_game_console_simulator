/**
 * MasterPersonas — Flash 区大师 Persona 加载层
 *
 * 把 flash/personas/*.json（由 scripts/compile-grammars.mjs 离线编译生成）
 * 在编译期静态导入，运行时通过 getMasterManifest(id) 查询。
 *
 * 与 SRAM 区 COMMON_GRAMMAR_ROOTS 的协作：
 *   manifest.customRootIds: number[] → COMMON_GRAMMAR_ROOTS[id].tokens: AbstractToken[]
 *   MasterPhraseRenderer 按 baseWeight 抽样并展开为 TerminalSymbol[]，喂给 ToplineEngine。
 *
 * ESP32 移植说明：
 *   Web 端走 ES 模块静态导入（bundle 进 JS）；ESP32 端走 SPI Flash 文件系统按需读取
 *   `/flash/personas/<id>.json`。本模块是 Web 适配，C 移植时换成 fopen+jsmn 解析即可。
 *
 * 约束遵从：
 *   P-1: MASTER_MANIFESTS 是扁平数组，getMasterManifest 走线性扫描（6 条记录，O(n) 可接受）
 *   T-3: 无 any —— JSON 通过 PersonaManifest 接口断言
 *   S-1: 模块级常量，无副作用
 */
import type { PersonaManifest } from '../types';

import BillEvansJson from '../../../../flash/personas/BillEvans.json';
import CharlieParkerJson from '../../../../flash/personas/CharlieParker.json';
import ChetBakerJson from '../../../../flash/personas/ChetBaker.json';
import DexterGordonJson from '../../../../flash/personas/DexterGordon.json';
import JohnColtraneJson from '../../../../flash/personas/JohnColtrane.json';
import MilesDavisJson from '../../../../flash/personas/MilesDavis.json';

/**
 * 全 6 张大师 manifest（按字母序）。
 * 顺序仅用于 UI 展示与调试，不影响生成确定性（PRNG 路径不依赖此数组顺序）。
 */
export const MASTER_MANIFESTS: PersonaManifest[] = [
    BillEvansJson as PersonaManifest,
    CharlieParkerJson as PersonaManifest,
    ChetBakerJson as PersonaManifest,
    DexterGordonJson as PersonaManifest,
    JohnColtraneJson as PersonaManifest,
    MilesDavisJson as PersonaManifest,
];

/**
 * 按 id 查询大师 manifest。
 * 找不到返回 undefined —— Stage5Layering 的 takeover 分支据此回退到 PCFGGrammarEngine。
 */
export function getMasterManifest(id: string): PersonaManifest | undefined {
    for (let i = 0; i < MASTER_MANIFESTS.length; i++) {
        if (MASTER_MANIFESTS[i].id === id) return MASTER_MANIFESTS[i];
    }
    return undefined;
}
