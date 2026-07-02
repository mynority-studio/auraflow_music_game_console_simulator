// ============================================================
// newEngine · knowledge · Final-Event Style Profile(non_acg_mg_final_event_fidelity_directive §7.1)
// ------------------------------------------------------------
// 架构铁律:arranger → 器配 → render 至高无上。本 profile 是【render 层数据】—— 不碰 arranger/harmony/form/section,
//   只在 render 层给每个 style 的 bass/comp/lead final events 一个【集中的 MG-like 形态契约】(不散落 if)。
//   directive §11:MG 中间生成已接上,问题在 SIM 主链 render/section/energy/post-process 把 final events 改掉了 →
//   在 render 层建每风格 final-event contract,让 bass/comp/lead 在完整成曲结构里仍保持 MG-like 听感形态。
// pad/drum 不参与(SIM 产品层);ACG 有独立 acgRenderProfile,不走这里。
// ============================================================

export interface FinalEventStyleProfile {
  // ★ bass 密度地板:该拍位无 bass event → 补 root anchor(达 MG-like 支撑)。空 = 不补(POP bass 本就够密)。
  //   directive §3.3.C/§4.3.A/§5.3.A:bass 是 groove/支撑角色,主体段不能长期低于 MG 50%;低能量降 velocity 不删 event。
  bassFloorBeats: readonly number[];
  // 后续增量(directive §7.1):compDensityCap · leadCoverage 范围 · leadRegisterTol · textureSwitching · onsetFormPolicy。
}

// MG bass/bar 参考(audit,seed 间波动):LOFI ~2.6 · RNB ~3.8 · JAZZ ~3.75 · POP ~1.06。
// 地板拍位取【强拍 root pulse】—— 补在纹理稀疏 bass 的空拍上,不删纹理 bass,不碰 comp/lead。
const PROFILES: Record<string, FinalEventStyleProfile> = {
  lofi: { bassFloorBeats: [0, 2] },        // 半拍 root pulse(1&3)—— laid-back,1/bar → ~2/bar
  rnb: { bassFloorBeats: [0, 2, 3] },      // neo-soul pocket:root 撑 1&3&4(MG~3.8 密)→ ~2.5-3/bar(≥50% MG)
  jazz: { bassFloorBeats: [0, 1, 2, 3] },  // walking anchor(四分 root 支撑),~2/bar → ~4/bar 贴 MG walk
  pop: { bassFloorBeats: [] },             // POP bass 本就够密(MG~1.06 · SIM~2)→ 不补(避免翻倍)
};

export function finalEventProfile(style: string): FinalEventStyleProfile {
  return PROFILES[style.toLowerCase()] ?? { bassFloorBeats: [] };
}
