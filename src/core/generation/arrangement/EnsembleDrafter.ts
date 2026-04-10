import { PRNGManager } from '../../utils/PRNG';
import { EnsembleDraft, StyleConfig } from '../types';
import { AcousticEnvelope, InstrumentProfiles, getInstrumentIdByName } from '../config/InstrumentFlags';

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
                const cId = getInstrumentIdByName(melodyPool[i]);
                if (InstrumentProfiles[cId].envelope === AcousticEnvelope.Plucked && melodyPool[i] !== melodySound) {
                    candidates.push(melodyPool[i]);
                }
            }
            if (candidates.length > 0) {
                secondarySound = candidates[Math.floor(PRNGManager.next() * candidates.length)]; // slot 3
                PRNGManager.next(); // slot 4
            } else {
                PRNGManager.next(); // slot 3
                const others: string[] = [];
                for (let i = 0; i < melodyPool.length; i++) {
                    if (melodyPool[i] !== melodySound) others.push(melodyPool[i]);
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
