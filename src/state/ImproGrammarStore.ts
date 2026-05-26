// ============================================================
// ImproGrammarStore — ImproEngine 当前选中 melody grammar(2026-05-25 加)
// ============================================================
//
// Q+H UI dropdown 写入 → ImproEngineFacade 读取。模块级 singleton。
// 2026-05-26 改造:set 时 fire-and-forget 触发 prefetch(public/grammars/ lazy fetch)。
//   hardcode grammar(6 个,见 lick-gen.ts ALL_GRAMMARS_MAP)不 fetch。
//   real grammar(85 个)异步 fetch + parse + 内存 cache,二次秒开。
// ============================================================

import { loadGrammarByName } from '../core/generation/improCore/data/grammar-parser';
import { isHardcodeGrammar } from '../core/generation/improCore/algorithms/lick-gen';

let _grammarName: string = 'quarter-baseline';

export const ImproGrammarStore = {
    getGrammarName(): string {
        return _grammarName;
    },
    setGrammarName(name: string): void {
        _grammarName = name;
        if (!isHardcodeGrammar(name)) {
            // Fire-and-forget prefetch — 命中 cache 即时返回,首次 fetch ~30-200ms
            loadGrammarByName(name).catch(e => {
                console.warn(`[ImproGrammarStore] prefetch failed for "${name}"`, e);
            });
        }
    },
};
