// ============================================================
// newEngine · render · TextureRenderer(rich textureCase → comp 事件)
// ------------------------------------------------------------
// 忠实 port 自 melodygenerative/src/lib/musicEngine.ts 的 rich textureCase 渲染分发
// (源 case 'Lyrical_Felt_Piano_Sparse' … 'Piano_CommonTone_Soft_Roll')。
// ★ 边界:源每个 texture 同时出 bass + chord 事件;newEngine bass 由 bassRenderer 独立渲染,
//   此处【只出 chord 部分】(voiced = comp 的真 voicing,对应源 cM)。
// 返回相对 span 起点的 hit(tRel/dur 单位=拍,vel=0..1);comp renderer 落 NoteIR。
// 纯函数无 rng → 确定性。
// ============================================================

export interface TextureChordHit {
  tRel: number; // 相对 span 起点的拍偏移
  dur: number; // 时值(拍)
  midis: number[]; // 该 hit 的 voice 子集
  vel: number; // 0..1(comp renderer 映射到 0..127)
}

// ★ 纹理的 bass 声部 = 节奏 only(onset/dur/vel + voice 提示);音高由 bassRenderer 按 bassRole/anchor 填。
//   忠实源:同一 textureCase 的 bass 与 chord 合谱 → bass+comp 对拍/复调由作者写死在相对拍 t 上。
export interface TextureBassHit {
  tRel: number;
  dur: number;
  vel: number; // 0..1(bassRenderer 映射)
  voice: 'root' | 'fifth' | 'tenth'; // root=anchor pc / fifth=五度 / tenth=三度(bass 区)
}

/** 纹理的律动口袋(给 drum 跟):halftime=半拍重 / sparse=留白多 / normal。 */
export type TexturePocket = 'normal' | 'halftime' | 'sparse';
const POCKET_BY_CASE: Record<string, TexturePocket> = {
  HalfTime_Emotional_Pulse: 'halftime', Piano_HalfTime_Soft_Pulse: 'halftime',
  Ambient_Pad_Breath: 'sparse', Low_Pedal_Color_Wash: 'sparse', Ambient_Reverse_Swell: 'sparse',
  Lyrical_Felt_Piano_Sparse: 'sparse', Piano_Lofi_OneShot_Space: 'sparse', Piano_Ambient_Sustain_Wash: 'sparse',
};
export function texturePocket(textureCase: string): TexturePocket {
  return POCKET_BY_CASE[textureCase] ?? 'normal';
}

/** modern(POP/RNB/JAZZ)rich textureCase。 */
const MODERN_TEXTURE_CASES = new Set<string>([
  'Lyrical_Felt_Piano_Sparse', 'Lyrical_10th_Broken', 'Ambient_Pad_Breath', 'Ambient_Reverse_Swell',
  'Soft_Guitar_Pluck_8ths', 'Piano_Question_Answer', 'Low_Pedal_Color_Wash', 'HalfTime_Emotional_Pulse',
]);
/** LOFI rich textureCase(+ wide_color_motion 兼归此)。 */
const LOFI_TEXTURE_CASES = new Set<string>([
  'Piano_Lofi_OneShot_Space', 'Piano_Lofi_Late_Chord_Answer', 'Piano_Emo_Broken_10th', 'Piano_Ambient_Sustain_Wash',
  'Piano_HalfTime_Soft_Pulse', 'Piano_Lofi_Dusty_Chops', 'Piano_Lofi_Tape_Wobble_Arp', 'Piano_Wide_Color_Motion',
  'Piano_CommonTone_Soft_Roll',
]);

/** 该 textureCase 有 render 实现吗(否则 comp 回退 compPattern)。 */
export function hasTextureRenderer(textureCase: string): boolean {
  return MODERN_TEXTURE_CASES.has(textureCase) || LOFI_TEXTURE_CASES.has(textureCase);
}

/** 全部已实现的 rich textureCase(测试遍历用)。 */
export const RENDERED_TEXTURE_CASES: readonly string[] = [...MODERN_TEXTURE_CASES, ...LOFI_TEXTURE_CASES];

/**
 * rich textureCase → chord hit 序列(忠实源每个 case 的 chord pushEvent)。
 * @param voicedRaw comp 真 voicing(= 源 cM);内部按升序处理(slice 语义依赖低→高)。
 * @param durationBeats span 时值(= 源 duration,拍)。
 */
export function renderTextureChordHits(
  textureCase: string,
  voicedRaw: readonly number[],
  durationBeats: number,
): TextureChordHit[] {
  const cM = [...voicedRaw].sort((a, b) => a - b);
  if (cM.length === 0) return [];
  const dur = durationBeats;
  const hits: TextureChordHit[] = [];
  const push = (midis: number[], tRel: number, d: number, vel: number) => {
    const ms = midis.filter((m) => Number.isFinite(m));
    if (ms.length === 0 || tRel >= dur) return;
    hits.push({ tRel, dur: d, midis: ms, vel });
  };
  const arpAt = (i: number) => {
    const arp = [cM[0], cM[1] ?? cM[0], cM[2] ?? cM[cM.length - 1], cM[1] ?? cM[0]];
    return arp[i % arp.length];
  };

  switch (textureCase) {
    // ——— modern lyrical / ambient ———
    case 'Lyrical_Felt_Piano_Sparse':
      push(cM, 0.15, 1.2, 0.42);
      if (dur >= 4) { push(cM.slice(-2), 2.25, 0.45, 0.36); push(cM.slice(0, 2), 3.25, 0.35, 0.30); }
      break;
    case 'Lyrical_10th_Broken':
      for (let i = 0; i < dur * 2; i++) push([arpAt(i)], i * 0.5 + 0.05, 0.32, 0.34 + (i % 4 === 0 ? 0.08 : 0));
      break;
    case 'Ambient_Pad_Breath':
      push(cM, 0.05, Math.min(dur, 2.8), 0.34);
      if (dur >= 4) push(cM.slice(1), 2.6, 1.2, 0.28);
      break;
    case 'Ambient_Reverse_Swell':
      [1.75, 2.5, 3.0, 3.5].filter((t) => t < dur).forEach((t, i) => push(cM, t, 0.35, 0.22 + i * 0.08));
      break;
    case 'Soft_Guitar_Pluck_8ths': {
      const notes = [cM[0], cM[1], cM[2], cM[1], cM[3] ?? cM[2], cM[1]];
      [0.0, 0.5, 1.0, 1.5, 2.5, 3.0].forEach((t, i) => push([notes[i % notes.length]], t + 0.02, 0.28, 0.34));
      break;
    }
    case 'Piano_Question_Answer':
      if (dur >= 4) { push(cM, 2.0, 0.5, 0.45); push(cM.slice(-2), 3.0, 0.35, 0.34); }
      else push(cM, dur * 0.5, 0.35, 0.38);
      break;
    case 'Low_Pedal_Color_Wash': // 源用 bMLow 过滤上层;comp 无 bass,voiced 即上层
      push(cM, 0.25, Math.min(dur, 3.2), 0.30);
      if (dur >= 4) push(cM.slice(1), 3.0, 0.8, 0.24);
      break;
    case 'HalfTime_Emotional_Pulse':
      push(cM, 0.0, 0.75, 0.48);
      if (dur >= 4) push(cM, 2.0, 0.75, 0.42);
      break;

    // ——— LOFI piano-only ———
    case 'Piano_Lofi_OneShot_Space':
      push(cM, 0.025, Math.min(dur * 0.5, 2.0), 0.38);
      break;
    case 'Piano_Lofi_Late_Chord_Answer':
      if (dur >= 4) { push(cM, 2.04, 0.65, 0.42); push(cM.slice(-2), 3.03, 0.4, 0.32); }
      else push(cM, dur * 0.55, 0.4, 0.38);
      break;
    case 'Piano_Emo_Broken_10th':
      for (let i = 0; i < dur * 2; i++) push([arpAt(i)], i * 0.5 + 0.02, 0.30, 0.32 + (i % 4 === 0 ? 0.06 : 0));
      break;
    case 'Piano_Ambient_Sustain_Wash':
      push(cM, 0.02, Math.min(dur, 3.5), 0.30);
      if (dur >= 4) push(cM.slice(1), 3.0, 0.95, 0.24);
      break;
    case 'Piano_HalfTime_Soft_Pulse':
      push(cM, 0.025, 0.75, 0.42);
      if (dur >= 4) push(cM, 2.025, 0.75, 0.38);
      break;
    case 'Piano_Lofi_Dusty_Chops':
      [0.58, 1.58, 2.58, 3.58].filter((t) => t < dur).forEach((t, i) => push(cM, t, 0.30, 0.35 + (i % 2 === 0 ? 0.08 : 0)));
      break;
    case 'Piano_Lofi_Tape_Wobble_Arp': {
      const arp = cM.slice(0, Math.min(cM.length, 4));
      for (let i = 0; i < dur * 2 && i < 8; i++) push([arp[i % arp.length]], i * 0.5 + 0.02, 0.35, i % 2 === 0 ? 0.32 : 0.24);
      break;
    }
    case 'Piano_Wide_Color_Motion': // 源 roll widePianoVoicing;voiced 即宽排列 → 强拍轻 roll
    case 'Piano_CommonTone_Soft_Roll':
      [0, 2].forEach((beat) => {
        if (beat >= dur) return;
        cM.forEach((m, idx) => push([m], beat + 0.05 + idx * 0.03, Math.min(1.6, dur - beat - 0.1), 0.36 + idx * 0.02));
      });
      break;
  }
  return hits;
}

/**
 * rich textureCase → bass hit 序列(忠实源每个 case 的 bass pushEvent)。节奏 only,音高 bassRenderer 填。
 * 多数 = 根音持音;HalfTime 系列在 0+2 双脉冲;10th 系列中段补三度(tenth)。
 */
export function renderTextureBassHits(textureCase: string, durationBeats: number): TextureBassHit[] {
  const dur = durationBeats;
  const hits: TextureBassHit[] = [];
  const b = (tRel: number, d: number, vel: number, voice: TextureBassHit['voice'] = 'root') => {
    if (tRel < dur) hits.push({ tRel, dur: Math.min(d, dur - tRel), vel, voice });
  };
  switch (textureCase) {
    case 'Lyrical_Felt_Piano_Sparse': b(0, Math.min(dur, 3.8), 0.62); break;
    case 'Lyrical_10th_Broken': b(0, 1.5, 0.72); if (dur > 2) b(1.5, 0.6, 0.45, 'tenth'); break;
    case 'Ambient_Pad_Breath': b(0, dur, 0.48); break;
    case 'Ambient_Reverse_Swell': b(0, dur, 0.45); break;
    case 'Soft_Guitar_Pluck_8ths': b(0, 1.8, 0.58); break;
    case 'Piano_Question_Answer': b(0, Math.min(dur, 2.0), 0.65); break;
    case 'Low_Pedal_Color_Wash': b(0, dur, 0.58); break;
    case 'HalfTime_Emotional_Pulse': b(0, 2.0, 0.82); if (dur >= 4) b(2.0, 2.0, 0.70); break;
    case 'Piano_Lofi_OneShot_Space': b(0, dur, 0.55); break;
    case 'Piano_Lofi_Late_Chord_Answer': b(0, Math.min(dur, 2.0), 0.60); break;
    case 'Piano_Emo_Broken_10th': b(0, 1.5, 0.68); if (dur > 2) b(1.5, 0.55, 0.42, 'tenth'); break;
    case 'Piano_Ambient_Sustain_Wash': b(0, dur, 0.42); break;
    case 'Piano_HalfTime_Soft_Pulse': b(0, 1.85, 0.72); if (dur >= 4) b(2.0, 1.85, 0.62); break;
    case 'Piano_Lofi_Dusty_Chops': b(0, dur, 0.62); break;
    case 'Piano_Lofi_Tape_Wobble_Arp': b(0, dur, 0.55); break;
    case 'Piano_Wide_Color_Motion': b(0, Math.min(dur, 2.4), 0.58); break;
    case 'Piano_CommonTone_Soft_Roll': b(0, dur, 0.65); break;
  }
  return hits;
}
