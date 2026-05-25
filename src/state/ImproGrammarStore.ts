// ============================================================
// ImproGrammarStore — ImproEngine 当前选中 melody grammar(2026-05-25 加)
// ============================================================
//
// Q+H UI dropdown 写入 → ImproEngineFacade 读取。模块级 singleton。
// Step B 第一版:6 个 hardcode grammar(见 improCore/algorithms/lick-gen.ts):
//   quarter-baseline / jazz-bebop / bach-chord-tone /
//   chromatic-color / long-sparse / swing-syncopated
// ============================================================

let _grammarName: string = 'quarter-baseline';

export const ImproGrammarStore = {
    getGrammarName(): string {
        return _grammarName;
    },
    setGrammarName(name: string): void {
        _grammarName = name;
    },
};
