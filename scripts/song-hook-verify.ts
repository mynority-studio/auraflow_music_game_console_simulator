/**
 * Phase 7.1 — Song Hook 锚定验证（ad-hoc）
 *
 * 跑同一首歌（固定 seed × 多种 style），dump 每个 Chorus 段的前 hook.totalBeats 区间内的
 * lead notes，验证：
 *   1. 第一个 Chorus 段产出原始 motif notes（可能有 splice 标 'MasterSplice'，也可能
 *      有 PCFG 自然标 motifName 的音）
 *   2. 后续 Chorus 段的同区间被标记为 motifName='SongHook'（即被 SongHookEncoder.project 覆盖）
 *   3. 后续 Chorus 的"度级骨架"与首次 Chorus 一致（节奏、velocity、相对结构）
 *
 * 不录黄金种子，只 dump 给人眼对账。
 *
 * 运行：npx tsx scripts/song-hook-verify.ts
 */

import { PRNGManager } from '../src/core/utils/PRNG';
import { runPipeline } from '../src/core/generation/pipeline';
import { StyleId } from '../src/core/generation/config/StyleFlags';
import {
    NoteData, SectionType, SectionTypeName,
} from '../src/core/generation/types';
import { SongHookEncoder } from '../src/core/generation/primitives/SongHookEncoder';

const SEED = 12345;
const STYLES: StyleId[] = [StyleId.ModernPop, StyleId.ChillJazz, StyleId.NeoSoul];
const STYLE_NAMES: Record<number, string> = {
    [StyleId.ModernPop]: 'ModernPop',
    [StyleId.ChillJazz]: 'ChillJazz',
    [StyleId.NeoSoul]: 'NeoSoul',
};

function notesInRange(notes: NoteData[], startBeat: number, endBeat: number): NoteData[] {
    const out: NoteData[] = [];
    for (const n of notes) {
        if (n.onset >= startBeat - 1e-6 && n.onset < endBeat - 1e-6) out.push(n);
    }
    return out;
}

function dumpNotes(label: string, notes: NoteData[]): void {
    console.log(`  ${label}  (${notes.length} notes)`);
    for (const n of notes) {
        const tag = n.motifName !== undefined ? `[${n.motifName}]` : '';
        console.log(
            `    onset=${n.onset.toFixed(2).padStart(6)}  pitch=${String(n.pitch).padStart(3)}  ` +
            `dur=${n.duration.toFixed(3)}  vel=${n.velocity.toFixed(3)}  ${tag}`,
        );
    }
}

function runStyle(styleId: StyleId): void {
    PRNGManager.setSeed(SEED);
    const { track } = runPipeline({ forcedStyleId: styleId });

    console.log(`\n══════ ${STYLE_NAMES[styleId]}  seed=${SEED} ══════`);
    console.log(`  sections=${track.sections.length}  melody=${track.melody.length}`);

    const chorusSections = track.sections.filter(s => s.sectionType === SectionType.Chorus);
    console.log(`  Chorus count: ${chorusSections.length}`);
    if (chorusSections.length < 2) {
        console.log(`  ⚠ 副歌段 < 2 — 看不到 hook 锚定效果`);
        return;
    }

    // 第一个 Chorus 算出 hook span 给出参考
    const c0 = chorusSections[0];
    const c0Notes = notesInRange(track.melody, c0.startBeat, c0.endBeat);
    const span0 = SongHookEncoder.computeHookSpan(c0Notes, c0.startBeat, c0.endBeat);
    if (span0 !== null) {
        const hookLen = span0.endBeat - span0.startBeat;
        console.log(`  Hook span (re-computed): [${span0.startBeat}, ${span0.endBeat})  ` +
            `len=${hookLen}  sectionDur=${c0.endBeat - c0.startBeat}`);
    } else {
        console.log(`  Hook span: null（首段无 motif 标记）`);
    }

    for (let i = 0; i < chorusSections.length; i++) {
        const s = chorusSections[i];
        const segStart = s.startBeat;
        const segEnd = s.endBeat;
        const segNotes = notesInRange(track.melody, segStart, segEnd);
        const label = `Chorus #${i + 1}  [${segStart.toFixed(1)}, ${segEnd.toFixed(1)})  ` +
            `energyLevel=${s.energyLevel}  name="${s.name}"`;
        dumpNotes(label, segNotes);

        // 统计带 motifName 的占比
        let withMotif = 0;
        let withSongHook = 0;
        for (const n of segNotes) {
            if (n.motifName !== undefined) withMotif++;
            if (n.motifName === 'SongHook') withSongHook++;
        }
        console.log(
            `    └ motif-tagged: ${withMotif}/${segNotes.length}  ` +
            `(SongHook: ${withSongHook})`,
        );
    }
}

for (const styleId of STYLES) {
    runStyle(styleId);
}
