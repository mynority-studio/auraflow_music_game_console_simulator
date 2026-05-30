// ============================================================
// ImproCore engine — 词汇数据注入(唯一的 Vite `?raw` 触点)
// ============================================================
//
// 把 My.voc 文本喂进纯逻辑层 vocab.ts。import 本模块即完成初始化(副作用)。
// 单独成文件,使 vocab.ts / chord.ts 保持 `?raw`-free,可在 Node/tsx 下测试。
// ============================================================

import vocText from './vocab/My.voc?raw';
import { parseVocab, setActiveVocab, parseScales, setActiveScales } from './vocab';

setActiveVocab(parseVocab(vocText));
setActiveScales(parseScales(vocText)); // Phase 6:音阶表(SCALE 约束)
