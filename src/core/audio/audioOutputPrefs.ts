// ============================================================
// audioOutputPrefs — 音频输出偏好（采样率 / 声道模式，顶部导航第三行下拉）
// ------------------------------------------------------------
// 采样率：**锁定 24000（2026-07-10 用户拍板：Copych/ESP32 设备口径）**；
//         当前 SF2 样本已统一锁到 24 kHz，正式播放必须请求同采样率，避免浏览器端
//         额外重采样改变音色/响度。旧 localStorage 的 auto/22050/44100/48000 一律回落 24000。
//         ⚠️ 采样率是 AudioContext 固有属性——切换须关旧 ctx 建新并重建合成器
//         （SynthManager.setAudioSampleRate 负责）。
// 声道：**默认 'mono'（同拍板：统一设备 mono 口径）**；
//       'stereo' 直通原生输出；'mono' 末端强制下混（GainNode channelCount=1
//       explicit）。Copych 引擎原生单声道（L=R），两档听感相同。
// ============================================================

export type SampleRatePref = 24000;
export type ChannelModePref = 'stereo' | 'mono';

const RATE_KEY = 'auraflow.audioSampleRate';
const CHANNEL_KEY = 'auraflow.channelMode';

export const SAMPLE_RATE_OPTIONS: readonly SampleRatePref[] = [24000];

let _rate: SampleRatePref | null = null;
let _channel: ChannelModePref | null = null;

export function getSampleRatePref(): SampleRatePref {
    if (_rate !== null) return _rate;
    _rate = 24000;   // SF2-locked native rate; ignore stale non-24k prefs.
    try { window.localStorage.setItem(RATE_KEY, '24000'); } catch { /* 非浏览器环境 → 默认 */ }
    return _rate;
}

export function setSampleRatePref(_pref: SampleRatePref): void {
    _rate = 24000;
    try { window.localStorage.setItem(RATE_KEY, String(_rate)); } catch { /* ignore */ }
}

export function getChannelModePref(): ChannelModePref {
    if (_channel !== null) return _channel;
    let pref: ChannelModePref = 'mono';   // 默认单声道=Copych/ESP32 设备口径
    try {
        const stored = window.localStorage.getItem(CHANNEL_KEY);
        if (stored === 'stereo') pref = 'stereo';
    } catch { /* ignore */ }
    _channel = pref;
    return pref;
}

export function setChannelModePref(mode: ChannelModePref): void {
    _channel = mode;
    try { window.localStorage.setItem(CHANNEL_KEY, mode); } catch { /* ignore */ }
}
