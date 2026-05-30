// smartGen.ts — Q+I 沙盒的"SmartGen"桥:调 mg engine 生成一条和弦进行,
//   转成 ImproCore 能解析的和弦 token 串,填进和弦输入框。
//   mg 与 ImproCore(Impro-Visor 体系)和弦词汇不同 —— 这里做映射 + 用 ImproCore
//   自己的解析器兜底,保证每个 token 都合法(实测全 5 风格 0% 降级)。

// 直接从 chord 模块取(不走 ../engine barrel,避开其 vocab-rom ?raw 副作用,便于 Node 测试);
// 浏览器侧 vocab 由面板的 barrel import 在加载时初始化。
import { makeChordSymbol } from '../engine/chord';
import { Engine, Random, type GenerationConfig } from '../../mgEngine/musicEngine';
import { STYLE_DICTIONARY, type StyleName } from '../../mgEngine/styleDictionary';

// mg type → ImproCore type 的少数不一致(其余直接通用)
const MG_TYPE_MAP: Record<string, string> = {
    maj: '',     // 大三和弦:ImproCore 'C' 即 C 大三
    min: 'm',
    min7: 'm7',
    dom7: '7',
};

/** mg ChordDef(root 字符串 + type 字符串)→ 合法 ImproCore token */
export function mgChordToToken(root: string, rawType: string): string {
    const mapped = MG_TYPE_MAP[rawType] ?? rawType.replace('/', ''); // '6/9' → '69'
    if (makeChordSymbol(root + mapped)) return root + mapped;
    // 兜底:按大小三降级,保证可解析
    const minor = /^(m|min|-)/.test(rawType) && !/maj/i.test(rawType);
    for (const fb of [minor ? 'm7' : '7', minor ? 'm' : '']) {
        if (makeChordSymbol(root + fb)) return root + fb;
    }
    return root; // 最后兜底:裸大三
}

/** SmartGen 用的调池(避免极端升降号) */
const KEY_POOL = ['C', 'F', 'G', 'D', 'A', 'Bb', 'Eb', 'Ab'];

export interface SmartGenResult {
    tokens: string;     // 空格分隔的 ImproCore 和弦串
    style: StyleName;
    key: string;
    count: number;
}

const BEATS_PER_BAR = 4; // mg duration 以 beats 计,4/4

/**
 * 把 mg 和弦序列(带 duration beats)排成 Impro-Visor leadsheet 文本:
 *   `|` 分小节,小节内多和弦空格分隔(经过和弦)。
 * mg 的进行总拍数是 4 的倍数且和弦不跨小节,故按累计拍数在 4 的边界插 `|`。
 */
function toLeadsheet(chords: { root: string; type: string; duration: number }[]): string {
    const bars: string[][] = [];
    let cur: string[] = [];
    let acc = 0;
    for (const c of chords) {
        cur.push(mgChordToToken(c.root, c.type));
        acc += c.duration;
        if (acc >= BEATS_PER_BAR) { bars.push(cur); cur = []; acc = 0; }
    }
    if (cur.length) bars.push(cur); // 尾巴(理论上不会有,兜底)
    return bars.map(b => b.join(' ')).join(' | ');
}

/** 随机风格 + 随机调 + 随机种子,生成一条和弦进行 */
export function smartGen(): SmartGenResult {
    const styles = Object.keys(STYLE_DICTIONARY) as StyleName[];
    const style = styles[Math.floor(Math.random() * styles.length)]!;
    const key = KEY_POOL[Math.floor(Math.random() * KEY_POOL.length)]!;
    const seed = 'smartgen_' + Math.random().toString(36).slice(2, 10);

    const config: GenerationConfig = { seed, style, key, emotion: 'auto' };
    const engine = new Engine(new Random(seed));
    const chords = engine.generateProgressions(config);

    const tokens = toLeadsheet(chords);
    return { tokens, style, key, count: chords.length };
}
