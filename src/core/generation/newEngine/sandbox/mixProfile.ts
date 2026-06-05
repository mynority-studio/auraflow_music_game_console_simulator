// ============================================================
// newEngine · sandbox · MixProfile(混响 = render 层【下面】的音频混音参数)
// ------------------------------------------------------------
// ★ 混响不是乐谱(不进 IR / render 层),是【共享房间】的音频输出层参数。按风格给一个全局房间湿度。
//   方案:一个共享房间(全局混响)+ bass/低频 high-pass(钉前、不浑)+ pre-delay(音头清);
//   深度主要靠编曲(响短=前 / 软长=后),不靠 per-channel 混响。
//   设备端 = 一个全局 Freeverb-lite(ESP32 C 固件,high-pass+pre-delay);此处给 web 模拟器同款房间湿度。
// ============================================================

// per-genre 共享房间湿度(CC91 0-127):LOFI 大湿房间 / JAZZ·BLUES 小干房间(清晰) / POP·RNB 中。
const ROOM_WET: Record<string, number> = {
  lofi: 72, pop: 52, rnb: 55, jazz: 30, blues: 28, modal: 60,
};

/** 该风格的共享房间湿度(给 irToMidi 当 roomWet)。未知风格回退中等房间。 */
export function roomWetFor(style: string): number {
  return ROOM_WET[style.toLowerCase()] ?? 48;
}
