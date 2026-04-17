import { PRNGManager } from '../../utils/PRNG';
import { EnsembleDraft, StyleConfig } from '../types';
import { AcousticEnvelope, InstrumentProfiles, getInstrumentIdByName } from '../config/InstrumentFlags';

// 🌟 F3 防御性清单：这些铃类/玩具乐器不允许做副旋律（Vibraphone/Music_Box 会产生廉价 spotlight 感，
// Glockenspiel/Celesta/Tinkle_Bell 也同样锋利）。作为主旋律保留（偶尔有风格需要）。
// 用普通字符串数组（P-1 禁 Set），线性扫描 5 项足够。
const BELL_INSTRUMENTS_BANNED_FROM_SECONDARY: string[] = [
    'Vibraphone', 'Music_Box', 'Glockenspiel', 'Celesta', 'Tinkle_Bell',
];
function isBannedFromSecondary(name: string): boolean {
    for (let i = 0; i < BELL_INSTRUMENTS_BANNED_FROM_SECONDARY.length; i++) {
        if (BELL_INSTRUMENTS_BANNED_FROM_SECONDARY[i] === name) return true;
    }
    return false;
}

export class EnsembleDrafter {
    /**
     * 配器规划：从 StyleConfig pool 中按约束选择乐器组合。
     * 材质互补：和弦优先选与旋律不同包络类型的乐器。
     * Secondary 强制 Plucked（填缝线需要打击类音色）。
     * PRNG 精确消耗 10 slot。
     */
    public static draft(style: StyleConfig): EnsembleDraft {
        const orch = style.orchestration;

        // 1. 主旋律
        const melodyPool = orch.melodyInstruments;
        const melodySound = melodyPool[Math.floor(PRNGManager.next() * melodyPool.length)]; // slot 1
        const melodyId = getInstrumentIdByName(melodySound);
        const melodyEnv = InstrumentProfiles[melodyId].envelope;

        // 2. 副旋律：强制 Plucked（填缝线是短促音）
        let secondarySound: string | null = null;
        PRNGManager.next(); // slot 2
        if (melodyPool.length > 1) {
            const candidates: string[] = [];
            for (let i = 0; i < melodyPool.length; i++) {
                const name = melodyPool[i];
                if (isBannedFromSecondary(name)) continue; // 🌟 F3: 铃类不做副旋律
                const cId = getInstrumentIdByName(name);
                if (InstrumentProfiles[cId].envelope === AcousticEnvelope.Plucked && name !== melodySound) {
                    candidates.push(name);
                }
            }
            if (candidates.length > 0) {
                secondarySound = candidates[Math.floor(PRNGManager.next() * candidates.length)]; // slot 3
                PRNGManager.next(); // slot 4
            } else {
                PRNGManager.next(); // slot 3
                const others: string[] = [];
                for (let i = 0; i < melodyPool.length; i++) {
                    const name = melodyPool[i];
                    if (name === melodySound) continue;
                    if (isBannedFromSecondary(name)) continue; // 🌟 F3: 铃类不做副旋律
                    others.push(name);
                }
                if (others.length > 0) {
                    secondarySound = others[Math.floor(PRNGManager.next() * others.length)]; // slot 4
                } else { PRNGManager.next(); } // slot 4
            }
        } else { PRNGManager.next(); PRNGManager.next(); } // slot 3+4

        // 3. 和弦：优先选与旋律不同包络的乐器
        const chordPool = orch.chordInstruments;
        let chordSound: string | null = null;
        if (chordPool.length > 0) {
            const chordCandidates: string[] = [];
            for (let ci = 0; ci < chordPool.length; ci++) {
                const cId = getInstrumentIdByName(chordPool[ci]);
                if (InstrumentProfiles[cId].envelope !== melodyEnv) chordCandidates.push(chordPool[ci]);
            }
            chordSound = chordCandidates.length > 0
                ? chordCandidates[Math.floor(PRNGManager.next() * chordCandidates.length)] // slot 5
                : chordPool[Math.floor(PRNGManager.next() * chordPool.length)];
        } else { PRNGManager.next(); } // slot 5

        // 4-5. 贝斯 + 鼓
        const bassPool = orch.bassInstruments;
        const bassSound = bassPool.length > 0 ? bassPool[Math.floor(PRNGManager.next() * bassPool.length)] : (PRNGManager.next(), null); // slot 6
        const drumPool = orch.drumInstruments;
        const drumSound = drumPool.length > 0 ? drumPool[Math.floor(PRNGManager.next() * drumPool.length)] : (PRNGManager.next(), null); // slot 7

        // 6. 副旋律/对位
        const cmPool = orch.counterMelodyInstruments || [];
        let counterMelodySound: string | null = null;
        const cmProb = orch.counterMelodyProbability ?? 0.3;
        if (PRNGManager.next() < cmProb && cmPool.length > 0) { // slot 8
            counterMelodySound = cmPool[Math.floor(PRNGManager.next() * cmPool.length)]; // slot 9
        } else { PRNGManager.next(); } // slot 9

        PRNGManager.next(); // slot 10

        return { melodySound, secondaryMelodySound: secondarySound, chordSound, bassSound, drumSound, counterMelodySound };
    }
}
