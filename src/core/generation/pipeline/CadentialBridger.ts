import { GeneratedChord, SectionMetadata, Tonality, CadentialBridge } from '../types';
import { StyleId } from '../config/StyleFlags';

// Pitch Space: RELATIVE — chord.root uses tonic=0 scale degrees, no keyOffset here

type BridgeStrategy = 'ii-V-I' | 'bVII-IV' | 'secondary-dom' | 'tritone-sub' | 'none';

// 风格层桥接策略：决定优先使用哪种离调手法
function getStyleBridgeStrategy(styleId: StyleId): BridgeStrategy {
    switch (styleId) {
        case StyleId.ModernPop: return 'ii-V-I';
        case StyleId.Synthwave: return 'secondary-dom';
        case StyleId.LofiChill: return 'bVII-IV';
        default: return 'none';
    }
}

// 段落层桥接触发：只在 PreChorus 末尾和 Bridge 中段注入
function shouldBridgeSection(name: string): boolean {
    return /prechorus/i.test(name) || /bridge/i.test(name);
}

function isIIFamily(numeral: string): boolean {
    return numeral === 'ii'
        || numeral === 'ii7'
        || numeral === 'iim7'
        || numeral === 'iim7b5'
        || numeral === 'ii9';
}

// 在 V 前 1 拍注入 ii 和弦（ii-V-I 骨架）
// 保守条件：前和弦时长 >= 2 拍且非 ii 家族，否则跳过
// Pitch Space: RELATIVE — 构造的 ii 和弦 root=2，不含 keyOffset
function injectIIChord(
    chords: GeneratedChord[],
    bridgeBeat: number,
    tonality: Tonality,
): GeneratedChord[] {
    let vIndex = -1;
    for (let i = 0; i < chords.length; i++) {
        if (Math.abs(chords[i].startBeat - bridgeBeat) < 1e-6) {
            vIndex = i;
            break;
        }
    }
    if (vIndex <= 0) return chords;

    const prev = chords[vIndex - 1];
    const vChord = chords[vIndex];

    if (isIIFamily(prev.numeral)) return chords;

    const prevDur = prev.endBeat - prev.startBeat;
    if (prevDur < 2 - 1e-6) return chords;

    // 小调/调式小调用 iiø（HalfDiminished），其余用 ii7（Minor7）
    const isMinorMode = tonality === Tonality.Minor
        || tonality === Tonality.Minor_Pentatonic
        || tonality === Tonality.Melodic_Minor
        || tonality === Tonality.Dorian;

    const iiChord: GeneratedChord = {
        numeral: isMinorMode ? 'iim7b5' : 'ii7',
        root: 2,
        quality: isMinorMode ? 'HalfDiminished' : 'Minor7',
        startBeat: vChord.startBeat - 1,
        endBeat: vChord.startBeat,
        keyOffset: vChord.keyOffset,
    };

    const newChords: GeneratedChord[] = new Array(chords.length + 1);
    for (let i = 0; i < vIndex - 1; i++) newChords[i] = chords[i];
    newChords[vIndex - 1] = { ...prev, endBeat: prev.endBeat - 1 };
    newChords[vIndex] = iiChord;
    for (let i = vIndex; i < chords.length; i++) newChords[i + 1] = chords[i];

    return newChords;
}

export function injectCadentialBridges(
    chords: GeneratedChord[],
    sections: SectionMetadata[],
    styleId: StyleId,
    tonality: Tonality,
): { chords: GeneratedChord[]; bridges: CadentialBridge[] } {
    const strategy = getStyleBridgeStrategy(styleId);
    const bridges: CadentialBridge[] = [];

    if (strategy === 'none') {
        return { chords, bridges };
    }

    const detectedBeats: number[] = [];
    for (const section of sections) {
        if (!shouldBridgeSection(section.name)) continue;

        const tailWindowStart = section.endBeat - 4;
        for (let i = 0; i < chords.length; i++) {
            const c = chords[i];
            if (c.startBeat < tailWindowStart - 1e-6) continue;
            if (c.startBeat > section.endBeat - 1e-6) break;

            const isDominant = c.numeral === 'V' || c.numeral === 'V7';
            const next = chords[i + 1];
            const nextIsTonic = next && (next.numeral === 'I' || next.numeral === 'Imaj7');
            if (isDominant && nextIsTonic) {
                detectedBeats.push(c.startBeat);
                bridges.push({
                    beat: c.startBeat,
                    targetNumeral: next.numeral,
                    bridgeType: strategy,
                });
            }
        }
    }

    // 当前仅 'ii-V-I' 策略真正注入；secondary-dom / bVII-IV / tritone-sub 留标记，不改和弦
    let working = chords;
    if (strategy === 'ii-V-I') {
        // 从后往前注入避免 index 位移影响前面的 bridgeBeat 查找
        for (let i = detectedBeats.length - 1; i >= 0; i--) {
            working = injectIIChord(working, detectedBeats[i], tonality);
        }
    }

    return { chords: working, bridges };
}
