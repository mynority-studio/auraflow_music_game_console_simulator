// ============================================================
// Orchestrator — 编曲器（K-2 转换 + ConductorPlan 物理消音）
// ============================================================
// Pitch Space: RELATIVE → ABSOLUTE（K-2 唯一转换点）
//
// 数据驱动改造（V7.6 + Virtual Band IoC）：
//   - 编制（palette）由 pipeline 前置决定，写入 context.ensemble，含 BandRoster 花名册
//     Orchestrator 不再持有 pickInst 抽卡权，仅作为 readonly 消费方
//   - chordIdiom 由 assembleActiveIdiom(roster.comping, 'Comping') 派生（Pangea 基底 + Personnel 特质）
//     彻底解耦于乐器名 / styleId，引擎只看最终图纸
//   - 应用 context.conductorPlan：按段落 silentInstruments 物理过滤掉对应音符
//
// 鼓组 K-2 例外：drums.pitch 是 GM 物理键位，绝不加 keyOffset。
// ============================================================

import { StyleId } from '../config/StyleFlags';
import {
    ArrangedTrack,
    GeneratedTrack,
    MusicContext,
    EnsembleDraft,
    NoteData,
} from '../types';
import { TextureMapper } from './TextureMapper';
import { assembleActiveIdiom, MUSICIAN_POOL } from '../idioms/MusicianRegistry';

const ACCOMP_OCTAVE = 60;   // C4 锚点（pianoLH 已含 -24 → C2/36；pianoRH / counter 居 60/C4）
const MELODY_OCTAVE = 72;   // C5 锚点
const SECTION_EPS = 0.001;

// Bass 物理音域钳制窗口 — E1(28) ~ G2(43)，Acoustic_Bass 的核心甜区。
// K-2 转换点（相对→绝对）后逐音 fold octave 到窗口内，保证 ESP32 端 GM bass 永不跑超。
// 副作用：高能段的 root↔root+12 八度跃动会被压成同 octave 内的同音重复，由上游
// （TextureMapper 的 energy>=7 分支）权衡后接受。
const BASS_REGISTER_MIN = 28;
const BASS_REGISTER_MAX = 43;

export class Orchestrator {
    public static arrange(track: GeneratedTrack, styleId: StyleId, context: MusicContext): ArrangedTrack {
        // 1) Palette：直接读取前置生成的编制，兜底使用默认标品
        const palette: EnsembleDraft = context.ensemble ?? {
            melodySound: 'Acoustic_Grand',
            chordSound: 'Acoustic_Grand',
            bassSound: 'Acoustic_Bass',
            drumSound: 'Standard_DrumKit',
            secondaryMelodySound: 'Pad_1_NewAge',
            counterMelodySound: null,
        };

        // 直接从 roster 中提取合并好的 Comping 图纸；缺花名册时用第 0 号乐手兜底
        const chordIdiom = palette.roster && palette.roster.comping
            ? assembleActiveIdiom(palette.roster.comping, 'Comping')
            : assembleActiveIdiom(MUSICIAN_POOL[0], 'Comping');

        // 2) 织体三层（相对空间），通过 chordIdiom 驱动伴奏物理约束
        const { bass: relLH, rhythmComping: relRH, sustainedPad: relPad } =
            TextureMapper.generateAccompaniment(track.chords, track.sections, chordIdiom);

        // 3) 应用 keyOffset → 绝对 MIDI
        let melody: NoteData[] = track.melody.map(n => ({
            ...n,
            pitch: n.pitch + track.keyOffset + MELODY_OCTAVE,
        }));
        let pianoRH: NoteData[] = relRH.map(n => ({
            ...n,
            pitch: n.pitch + track.keyOffset + ACCOMP_OCTAVE,
        }));
        // K-2 转换点 + per-note 物理音域 fold：
        //   绝对 pitch = 相对 pitch + keyOffset + ACCOMP_OCTAVE，落入 [28, 43] 后输出。
        //   K-5 例外条款明确允许 keyOffset 用于"音域限制（clamp to range）"，此处合规。
        let pianoLH: NoteData[] = relLH.map(n => {
            let absPitch = n.pitch + track.keyOffset + ACCOMP_OCTAVE;
            while (absPitch > BASS_REGISTER_MAX) absPitch -= 12;
            while (absPitch < BASS_REGISTER_MIN) absPitch += 12;
            return { ...n, pitch: absPitch };
        });
        let secondaryMelody: NoteData[] = relPad.map(n => ({
            ...n,
            pitch: n.pitch + track.keyOffset + ACCOMP_OCTAVE,
        }));
        let counterMelody: NoteData[] = track.counterMelody
            ? track.counterMelody.map(n => ({
                ...n,
                pitch: n.pitch + track.keyOffset + ACCOMP_OCTAVE,
            }))
            : [];

        // 4) 鼓组绝对音高特权：直接透传
        let drums: NoteData[] = track.drums ? track.drums.map(n => ({ ...n })) : [];

        // 5) ConductorPlan 物理消音：按 silentInstruments 在该段落内过滤音符
        if (context.conductorPlan) {
            const plan = context.conductorPlan;
            for (let i = 0; i < plan.sections.length; i++) {
                const planSec = plan.sections[i];
                const filterSilence = (notes: NoteData[]): NoteData[] =>
                    notes.filter(
                        n => !(n.onset >= planSec.startBeat - SECTION_EPS &&
                               n.onset < planSec.endBeat - SECTION_EPS),
                    );
                if (planSec.silentInstruments.indexOf('melody') >= 0) melody = filterSilence(melody);
                if (planSec.silentInstruments.indexOf('counter') >= 0) counterMelody = filterSilence(counterMelody);
                if (planSec.silentInstruments.indexOf('drums') >= 0) drums = filterSilence(drums);
                if (planSec.silentInstruments.indexOf('bass') >= 0) pianoLH = filterSilence(pianoLH);
                if (planSec.silentInstruments.indexOf('chord') >= 0) pianoRH = filterSilence(pianoRH);
                if (planSec.silentInstruments.indexOf('secondary') >= 0) secondaryMelody = filterSilence(secondaryMelody);
            }
        }

        return {
            bpm: track.bpm,
            key: track.key,
            absoluteStartBeat: track.absoluteStartBeat,
            timeSignature: track.timeSignature,
            styleId,
            melody,
            pianoLH,
            pianoRH,
            drums,
            secondaryMelody,
            counterMelody,
            chords: track.chords,
            sections: track.sections,
            palette,
        };
    }

}
