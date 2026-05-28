// ============================================================
// MgSeedStore — mgEngine seed 字符串(2026-05-28)
// ============================================================
//
// 跟 mg App.tsx seed 输入完全对齐:接受字母 + 数字 + 下划线
// (mg 的 randomTail 是 6 字符 base36 hex 串,例 `pop_4f9a2b`)。
//
// PipelineMonitor 写入 → runPipeline 读取后传给 mgEngine adapter。
//
// 命名约定:
//   "suffix" 不含 style prefix,如 `42` / `4f9a2b` / `mySeed01`
//   runPipeline 内部会按当前 MgStyle 自动拼接:`pop_${suffix}` 等
//   若 suffix 已含下划线(用户直接输入完整 mg seed 如 `pop_42`)→ 原样使用
// ============================================================

let _suffix: string = '42';

export const MgSeedStore = {
    getSuffix(): string {
        return _suffix;
    },
    setSuffix(suffix: string): void {
        _suffix = suffix || '0';  // 防御空字符串
    },
};

/**
 * 简易字符串 → uint32 哈希(djb2 变种),用于 PRNGManager 的 numeric setSeed,
 * 跟 mg 的 Random class 字符串 hash 算法一致(`(a << 5) - a + charCode`)。
 *
 * 注意:这个 hash 只用于我们内部 PRNG snapshot 机制,**不影响** mg 输出
 * (mg 内部自己用 raw string 重新 hash)。
 */
export function hashSeedToInt(seed: string): number {
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
        h = (h << 5) - h + seed.charCodeAt(i);
        h = h & h;  // force 32-bit
    }
    return h >>> 0;
}
