import { PRNGManager } from '../../utils/PRNG';
import { EnsembleDraft, StyleConfig } from '../types';
import { AcousticEnvelope, InstrumentProfiles, getInstrumentIdByName } from '../config/InstrumentFlags';

export class EnsembleDrafter {
    /**
     * 配器规划：从 StyleConfig 声部池中选择乐器组合。
     *
     * 5 声部架构：lead / vocal / accomp / bass / drums / pad
     * 材质互补：accomp 优先选与 lead 不同包络类型的乐器。
     *
     * PRNG 精确消耗 10 slot — 每条路径必须消耗固定数量，保证确定性对齐。
     */
    public static draft(style: StyleConfig): EnsembleDraft {
        const orch = style.orchestration;

        // ── Slot 1: Lead ──
        const leadPool = orch.leadInstruments;
        const leadSound = leadPool[Math.floor(PRNGManager.next() * leadPool.length)]; // slot 1
        const leadId = getInstrumentIdByName(leadSound);
        const leadEnv = InstrumentProfiles[leadId].envelope;

        // ── Slot 2: Vocal probability roll ──
        const vocalProb = orch.vocalProbability ?? 0;
        const vocalRoll = PRNGManager.next(); // slot 2
        const wantVocal = vocalRoll < vocalProb;

        // ── Slot 3: Vocal sound selection (or burn) ──
        let vocalSound: string | undefined;
        if (wantVocal && leadPool.length > 0) {
            vocalSound = leadPool[Math.floor(PRNGManager.next() * leadPool.length)]; // slot 3
        } else {
            PRNGManager.next(); // slot 3 burn
        }

        // ── Slot 4: Accomp — prefer different AcousticEnvelope from lead ──
        const accompPool = orch.accompInstruments;
        let accompSound: string | null = null;
        if (accompPool.length > 0) {
            // 优先选与 lead 不同包络类型的乐器
            const diffEnvCandidates: string[] = [];
            for (let i = 0; i < accompPool.length; i++) {
                const cId = getInstrumentIdByName(accompPool[i]);
                if (InstrumentProfiles[cId].envelope !== leadEnv) {
                    diffEnvCandidates.push(accompPool[i]);
                }
            }
            if (diffEnvCandidates.length > 0) {
                accompSound = diffEnvCandidates[Math.floor(PRNGManager.next() * diffEnvCandidates.length)]; // slot 4
            } else {
                accompSound = accompPool[Math.floor(PRNGManager.next() * accompPool.length)]; // slot 4 fallback
            }
        } else {
            PRNGManager.next(); // slot 4 burn
        }

        // ── Slot 5: Accomp optional roll (allowAccompless) ──
        const accompRoll = PRNGManager.next(); // slot 5
        if (orch.allowAccompless && accompRoll > 0.5) {
            accompSound = null;
        }

        // ── Slot 6: Bass ──
        const bassPool = orch.bassInstruments;
        const bassSound = bassPool.length > 0
            ? bassPool[Math.floor(PRNGManager.next() * bassPool.length)] // slot 6
            : (PRNGManager.next(), null); // slot 6 burn

        // ── Slot 7: Drums ──
        const drumPool = orch.drumInstruments;
        const drumSound = drumPool.length > 0
            ? drumPool[Math.floor(PRNGManager.next() * drumPool.length)] // slot 7
            : (PRNGManager.next(), null); // slot 7 burn

        // ── Slot 8: Pad probability roll ──
        const padProb = orch.padProbability ?? 0.3;
        const padRoll = PRNGManager.next(); // slot 8
        const wantPad = padRoll < padProb;

        // ── Slot 9: Pad sound selection (or burn) ──
        const padPool = orch.padInstruments;
        let padSound: string | null = null;
        if (wantPad && padPool.length > 0) {
            padSound = padPool[Math.floor(PRNGManager.next() * padPool.length)]; // slot 9
        } else {
            PRNGManager.next(); // slot 9 burn
        }

        // ── Slot 10: Guest instrument (reserved for future) ──
        PRNGManager.next(); // slot 10 burn

        return {
            leadSound,
            vocalSound,
            accompSound,
            bassSound,
            drumSound,
            padSound,
        };
    }
}
