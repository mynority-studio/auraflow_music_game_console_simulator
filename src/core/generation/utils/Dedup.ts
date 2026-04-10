/**
 * Dedup — C 可移植的数组去重工具
 *
 * 取代生成管道中所有 `Array.from(new Set(...))` 调用，避免使用 Set 数据结构。
 * C 移植时直接翻译为 qsort + 线性扫描去重，零额外内存开销。
 *
 * 算法：sort + 线性扫描，保持升序输出。
 * 时间复杂度 O(n log n)，与 Set 方案相当但满足 P-1 (no Map/Set) 约束。
 */

/**
 * 数字数组去重并升序排列。返回新数组，不修改原数组。
 * max_length: 与输入相同
 */
export function sortAndDedupNumbers(arr: number[]): number[] {
    if (arr.length === 0) return [];
    const sorted = arr.slice().sort((a, b) => a - b);
    const result: number[] = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
        // 整数比较使用 ===；浮点比较应使用 epsilon（本函数仅用于 MIDI pitch 等整数）
        if (sorted[i] !== result[result.length - 1]) {
            result.push(sorted[i]);
        }
    }
    return result;
}
