// ============================================================
// audioOutputPrefs — 音频输出偏好（采样率 / 声道模式，顶部导航第三行下拉）
// ------------------------------------------------------------
// 采样率：'auto' = copych→24000（设备口径，24k SF2 零重采样）/ spessa→硬件默认；
//         显式值（22050/24000/44100/48000）对两后端都生效。
//         ⚠️ 采样率是 AudioContext 固有属性——切换须关旧 ctx 建新并重建合成器
//         （SynthManager.setAudioSampleRate 负责）。
// 声道：输出端模式（内容口径见各后端）——'stereo' 直通原生输出；'mono' 末端
//       强制下混（GainNode channelCount=1 explicit）。copych 引擎原生单声道
//       （L=R），两档听感相同；spessa 选 mono=下混，可消除声场差做公平 A/B。
// ============================================================

export type SampleRatePref = 'auto' | 22050 | 24000 | 44100 | 48000;
export type ChannelModePref = 'stereo' | 'mono';

const RATE_KEY = 'auraflow.audioSampleRate';
const CHANNEL_KEY = 'auraflow.channelMode';

export const SAMPLE_RATE_OPTIONS: readonly Exclude<SampleRatePref, 'auto'>[] = [22050, 24000, 44100, 48000];

let _rate: SampleRatePref | null = null;
let _channel: ChannelModePref | null = null;

export function getSampleRatePref(): SampleRatePref {
    if (_rate !== null) return _rate;
    let pref: SampleRatePref = 'auto';
    try {
        const stored = window.localStorage.getItem(RATE_KEY);
        if (stored && stored !== 'auto') {
            const n = Number(stored);
            if ((SAMPLE_RATE_OPTIONS as readonly number[]).includes(n)) pref = n as SampleRatePref;
        }
    } catch { /* 非浏览器环境 → auto */ }
    _rate = pref;
    return pref;
}

export function setSampleRatePref(pref: SampleRatePref): void {
    _rate = pref;
    try { window.localStorage.setItem(RATE_KEY, String(pref)); } catch { /* ignore */ }
}

export function getChannelModePref(): ChannelModePref {
    if (_channel !== null) return _channel;
    let pref: ChannelModePref = 'stereo';
    try {
        const stored = window.localStorage.getItem(CHANNEL_KEY);
        if (stored === 'mono') pref = 'mono';
    } catch { /* ignore */ }
    _channel = pref;
    return pref;
}

export function setChannelModePref(mode: ChannelModePref): void {
    _channel = mode;
    try { window.localStorage.setItem(CHANNEL_KEY, mode); } catch { /* ignore */ }
}
