// ==========================================
// instruments.ts — Instrument schema + polyphony / range constraints.
//
// 目的: 给 bass / chord / melody 三轨打乐器标签,引擎据此约束排列:
//   - 单音乐器 (synth_lead / vocals / acoustic_bass): polyphony=1,
//     melody 不能整出和弦, bass 不能整出双音
//   - 弦乐 (guitar polyphony=6 + 演奏 span 限制): 不能同时响 8 个音
//   - pad / strings_section / piano: 高 polyphony,正常排列
//
// 引擎调用 enforceInstrumentConstraints(events, instrumentBindings) 在
// generateArrangement 末尾过滤:
//   1. 按 part 分组
//   2. 对单音乐器: 重叠 note 只保留 priority 最高的一个
//   3. 对低 polyphony 乐器: 保留 top N voice (按 velocity 优先)
//   4. 所有 events: clamp pitch 到乐器 range 内
//
// 默认值 (bass=acoustic_bass / chord=piano / melody=piano) — 保留
// 现在钢琴-only 美学. 用户切换乐器后,排列自动适配.
// ==========================================

import { NoteEvent } from './musicEngine';

export interface InstrumentSpec {
  id: string;
  displayName: string;
  category: 'keys' | 'strings' | 'bass' | 'lead' | 'pad' | 'voice' | 'percussion';
  // 同时能发声的最大音数. 1 = 单音乐器.
  polyphony: number;
  // [low, high] MIDI pitch range
  range: [number, number];
  // 是否需要踏板支持 (键盘类 = 是,其它 = 否)
  pedalCapable?: boolean;
  // 显示标签短形式 (UI 用)
  shortLabel?: string;
}

export const INSTRUMENTS: Record<string, InstrumentSpec> = {
  // 键盘
  piano: {
    id: 'piano',
    displayName: 'Piano',
    category: 'keys',
    polyphony: 10,
    range: [21, 108],
    pedalCapable: true,
    shortLabel: 'Pno',
  },
  rhodes: {
    id: 'rhodes',
    displayName: 'Electric Piano (Rhodes)',
    category: 'keys',
    polyphony: 10,
    range: [28, 96],
    pedalCapable: true,
    shortLabel: 'Rhd',
  },

  // 贝斯
  acoustic_bass: {
    id: 'acoustic_bass',
    displayName: 'Upright Bass',
    category: 'bass',
    polyphony: 1,
    range: [28, 55],
    pedalCapable: false,
    shortLabel: 'UpBs',
  },
  electric_bass: {
    id: 'electric_bass',
    displayName: 'Electric Bass',
    category: 'bass',
    polyphony: 1,
    range: [28, 62],
    pedalCapable: false,
    shortLabel: 'EBs',
  },

  // 弦乐
  guitar: {
    id: 'guitar',
    displayName: 'Acoustic Guitar',
    category: 'strings',
    polyphony: 6,
    range: [40, 88],
    pedalCapable: false,
    shortLabel: 'Gtr',
  },
  electric_guitar: {
    id: 'electric_guitar',
    displayName: 'Electric Guitar',
    category: 'strings',
    polyphony: 6,
    range: [40, 86],
    pedalCapable: false,
    shortLabel: 'EGtr',
  },
  strings_section: {
    id: 'strings_section',
    displayName: 'Strings Section',
    category: 'strings',
    polyphony: 8,
    range: [36, 96],
    pedalCapable: false,
    shortLabel: 'Str',
  },

  // 主旋律乐器
  synth_lead: {
    id: 'synth_lead',
    displayName: 'Synth Lead',
    category: 'lead',
    polyphony: 1,
    range: [48, 96],
    pedalCapable: false,
    shortLabel: 'Ld',
  },
  vocals: {
    id: 'vocals',
    displayName: 'Vocals',
    category: 'voice',
    polyphony: 1,
    range: [48, 84],
    pedalCapable: false,
    shortLabel: 'Voc',
  },

  // Pad / 合成器
  pad: {
    id: 'pad',
    displayName: 'Pad / Synth Wash',
    category: 'pad',
    polyphony: 8,
    range: [36, 96],
    pedalCapable: false,
    shortLabel: 'Pad',
  },
};

/**
 * 三轨乐器绑定. 默认全 piano — 保持现在钢琴-only 美学.
 * 用户切换某轨乐器后, enforceInstrumentConstraints 自动重排.
 */
export interface InstrumentBindings {
  bass: string;       // INSTRUMENTS key
  chord: string;
  melody: string;
}

export const DEFAULT_INSTRUMENT_BINDINGS: InstrumentBindings = {
  bass: 'piano',
  chord: 'piano',
  melody: 'piano',
};

/**
 * 在 timeline 末尾跑一遍约束过滤. 不重新生成事件,只:
 *   1. clamp 每个 event 的 pitch 到乐器 range
 *   2. 同时发声的 event 数超过 polyphony 时,按 velocity 保留 top-N
 *   3. 给每个 event 打 instrument 标签
 *
 * 返回新数组 (不 mutate 输入).
 */
export function enforceInstrumentConstraints(
  events: NoteEvent[],
  bindings: InstrumentBindings,
): NoteEvent[] {
  // 给每个 event 打 instrument 标签
  const tagged = events.map(e => {
    const instrumentId = e.part === 'bass'   ? bindings.bass
                       : e.part === 'chord'  ? bindings.chord
                       : bindings.melody;
    return { ...e, instrument: instrumentId };
  });

  // 按 part 分组,对每组应用约束
  const partGroups: Record<string, NoteEvent[]> = {};
  for (const e of tagged) {
    (partGroups[e.part] ??= []).push(e);
  }

  const out: NoteEvent[] = [];
  for (const [part, evts] of Object.entries(partGroups)) {
    const inst = INSTRUMENTS[bindings[part as keyof InstrumentBindings]] ?? INSTRUMENTS.piano;
    // 1. clamp pitch range
    const clamped = evts.map(e => {
      let pitch = e.noteNumber;
      while (pitch < inst.range[0]) pitch += 12;
      while (pitch > inst.range[1]) pitch -= 12;
      return { ...e, noteNumber: pitch };
    });
    // 2. polyphony cap — 时间重叠时只留 top-N (按 velocity)
    if (inst.polyphony >= 8) {
      // 高 polyphony 直接放行
      out.push(...clamped);
      continue;
    }
    // 按时间分桶 (50ms 容差 = 0.05 beat at common bpm)
    const TIME_BUCKET = 0.06;
    const sorted = clamped.slice().sort((a, b) => a.time - b.time);
    const groups: NoteEvent[][] = [];
    for (const e of sorted) {
      const last = groups[groups.length - 1];
      if (last && Math.abs(e.time - last[0].time) < TIME_BUCKET) {
        last.push(e);
      } else {
        groups.push([e]);
      }
    }
    // 每桶留 top-polyphony 个 (velocity desc)
    for (const g of groups) {
      g.sort((a, b) => b.velocity - a.velocity);
      out.push(...g.slice(0, inst.polyphony));
    }
  }

  return out.sort((a, b) => a.time - b.time);
}
