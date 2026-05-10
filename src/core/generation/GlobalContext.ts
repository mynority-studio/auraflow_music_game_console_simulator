// ============================================================
// 🚧 STUB — 全局生成上下文占位
// ============================================================
//
// 历史功能：
//   原 GlobalContextManager 是生成管道运行时的全局可变单例，
//   存储当前 BPM / 调式 / 调号 / 时间签名 / 当前段落 / 当前和弦 / GrooveDNA 等运行时状态。
//   阶段间通过它读写共享状态。
//
// 重构期占位行为：
//   保留单例公开 API（属性 + 方法签名），全部赋默认值或返回 no-op。
//   App 层（EndlessRadioManager / JamSessionManager）仅消费 currentTimeSignature，
//   保持其默认 [4, 4] 即可让 Jam 模式的拍量算法正常工作。
//
// 重构方向：
//   新引擎应优先消除对全局可变单例的依赖（生成管道纯函数化），
//   仅在需要给 App 层暴露"当前播放上下文"时保留这一层薄包装。
// ============================================================

import { GeneratedChord, SectionMetadata, StyleConfig, Tonality } from './types';

class GlobalContextManager {
    public currentStyle: StyleConfig | null = null;
    public currentBPM: number = 120;
    public currentTimeSignature: [number, number] = [4, 4];
    public currentTonality: Tonality = Tonality.Major;
    public currentKeyOffset: number = 0;
    public globalAbsoluteBeat: number = 0;

    private currentGrooveDNA: number[] = [];
    private activeSection: SectionMetadata | null = null;
    private activeChord: GeneratedChord | null = null;

    public initializeNewEra(
        style: StyleConfig,
        bpm: number,
        keyOffset: number,
        tonality: Tonality,
        timeSignature: [number, number],
    ) {
        this.currentStyle = style;
        this.currentBPM = bpm;
        this.currentKeyOffset = keyOffset;
        this.currentTonality = tonality;
        this.currentTimeSignature = timeSignature;
    }

    public updateCurrentSlice(section: SectionMetadata, chord: GeneratedChord, grooveDNA: number[]) {
        this.activeSection = section;
        this.activeChord = chord;
        this.currentGrooveDNA = grooveDNA;
    }

    public isGrooveHit(_absoluteBeat: number): boolean { return false; }
    public isLayeringHit(_absoluteBeat: number): boolean { return false; }
    public isInterleavingHit(_absoluteBeat: number): boolean { return false; }

    public getCurrentEnergyLevel(): number {
        return this.activeSection ? this.activeSection.energyLevel : 5;
    }
    public getCurrentChord(): GeneratedChord | null { return this.activeChord; }
    public getActiveSection(): SectionMetadata | null { return this.activeSection; }

    public reset() {
        this.currentStyle = null;
        this.currentBPM = 120;
        this.currentTimeSignature = [4, 4];
        this.currentTonality = Tonality.Major;
        this.currentKeyOffset = 0;
        this.globalAbsoluteBeat = 0;
        this.currentGrooveDNA = [];
        this.activeSection = null;
        this.activeChord = null;
    }
}

export const GlobalContext = new GlobalContextManager();
