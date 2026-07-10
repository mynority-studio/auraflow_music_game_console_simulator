// ============================================================
// audioOutputPrefs — 音频输出偏好（采样率 / 声道模式，顶部导航第三行下拉）
// ------------------------------------------------------------
// 采样率：**默认 24000（2026-07-10 用户拍板：两后端统一设备口径）**；
//         四个显式档（22050/24000/44100/48000）对两后端都生效（'auto' 档已按
//         用户指令移除；旧 localStorage 存的 'auto' 回落默认 24000）。
//         ⚠️ 采样率是 AudioContext 固有属性——切换须关旧 ctx 建新并重建合成器
//         （SynthManager.setAudioSampleRate 负责）。
// 声道：**默认 'mono'（同拍板：统一设备 mono 口径，spessa 下混后 A/B 公平）**；
//       'stereo' 直通原生输出；'mono' 末端强制下混（GainNode channelCount=1
//       explicit）。copych 引擎原生单声道（L=R），两档听感相同。
// ============================================================

export type SampleRatePref = 22050 | 24000 | 44100 | 48000;
export type ChannelModePref = 'stereo' | 'mono';

const RATE_KEY = 'auraflow.audioSampleRate';
const CHANNEL_KEY = 'auraflow.channelMode';

export const SAMPLE_RATE_OPTIONS: readonly SampleRatePref[] = [22050, 24000, 44100, 48000];

let _rate: SampleRatePref | null = null;
let _channel: ChannelModePref | null = null;

export function getSampleRatePref(): SampleRatePref {
    if (_rate !== null) return _rate;
    let pref: SampleRatePref = 24000;   // 默认 24k=设备口径（两后端统一）
    try {
        const stored = window.localStorage.getItem(RATE_KEY);   // 旧值 'auto' 不再识别 → 回落默认
        if (stored) {
            const n = Number(stored);
            if ((SAMPLE_RATE_OPTIONS as readonly number[]).includes(n)) pref = n as SampleRatePref;
        }
    } catch { /* 非浏览器环境 → 默认 */ }
    _rate = pref;
    return pref;
}

export function setSampleRatePref(pref: SampleRatePref): void {
    _rate = pref;
    try { window.localStorage.setItem(RATE_KEY, String(pref)); } catch { /* ignore */ }
}

export function getChannelModePref(): ChannelModePref {
    if (_channel !== null) return _channel;
    let pref: ChannelModePref = 'mono';   // 默认单声道=设备口径（两后端统一）
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
