// ==========================================
// SmartDrumEngine — AI 智能鼓组引擎
// 将用户任意按键转化为合乎律动的鼓点
// ==========================================
import { AudioEngine } from '../../core/audio/AudioEngine';
import { GlobalContext } from '../../core/generation/GlobalContext';

// GM Drum Map 常用音色
const KICK = 36;
const SNARE = 38;
const SIDE_STICK = 37;
const CLOSED_HH = 42;
const OPEN_HH = 46;
const PEDAL_HH = 44;
const CRASH = 49;
const RIDE = 51;
const RIDE_BELL = 53;
const TOM_HIGH = 48;
const TOM_MID = 45;
const TOM_LOW = 41;
const TOM_FLOOR = 43;
const CHINA = 52;
const SPLASH = 55;

// 16 分音符网格上的 groove 模板（1 小节 = 16 个 slot）
// 每个 slot 存放 { note, velocity } 或 null
interface DrumHit { note: number; velocity: number }

// 基础 groove 模板：不同能量级别
const GROOVE_BASIC: (DrumHit[] | null)[] = [
    // Beat 1 (slots 0-3)
    [{ note: KICK, velocity: 110 }, { note: CLOSED_HH, velocity: 90 }],  // 1
    [{ note: CLOSED_HH, velocity: 60 }],                                  // e
    [{ note: CLOSED_HH, velocity: 80 }],                                  // &
    [{ note: CLOSED_HH, velocity: 55 }],                                  // a
    // Beat 2 (slots 4-7)
    [{ note: SNARE, velocity: 105 }, { note: CLOSED_HH, velocity: 85 }], // 2
    [{ note: CLOSED_HH, velocity: 55 }],                                  // e
    [{ note: CLOSED_HH, velocity: 75 }],                                  // &
    [{ note: CLOSED_HH, velocity: 50 }],                                  // a
    // Beat 3 (slots 8-11)
    [{ note: KICK, velocity: 100 }, { note: CLOSED_HH, velocity: 90 }],  // 3
    [{ note: CLOSED_HH, velocity: 55 }],                                  // e
    [{ note: KICK, velocity: 75 }, { note: CLOSED_HH, velocity: 80 }],   // &
    [{ note: CLOSED_HH, velocity: 50 }],                                  // a
    // Beat 4 (slots 12-15)
    [{ note: SNARE, velocity: 110 }, { note: CLOSED_HH, velocity: 85 }], // 4
    [{ note: CLOSED_HH, velocity: 55 }],                                  // e
    [{ note: CLOSED_HH, velocity: 75 }],                                  // &
    [{ note: CLOSED_HH, velocity: 50 }],                                  // a
];

// 高能量 groove（副歌级）
const GROOVE_HIGH: (DrumHit[] | null)[] = [
    [{ note: KICK, velocity: 120 }, { note: CRASH, velocity: 100 }],     // 1
    [{ note: CLOSED_HH, velocity: 70 }],
    [{ note: CLOSED_HH, velocity: 90 }],
    [{ note: KICK, velocity: 80 }, { note: CLOSED_HH, velocity: 60 }],
    [{ note: SNARE, velocity: 115 }, { note: OPEN_HH, velocity: 85 }],  // 2
    [{ note: CLOSED_HH, velocity: 60 }],
    [{ note: CLOSED_HH, velocity: 85 }],
    [{ note: CLOSED_HH, velocity: 55 }],
    [{ note: KICK, velocity: 110 }, { note: CLOSED_HH, velocity: 90 }], // 3
    [{ note: KICK, velocity: 70 }, { note: CLOSED_HH, velocity: 60 }],
    [{ note: CLOSED_HH, velocity: 85 }],
    [{ note: CLOSED_HH, velocity: 55 }],
    [{ note: SNARE, velocity: 120 }, { note: CLOSED_HH, velocity: 90 }],// 4
    [{ note: CLOSED_HH, velocity: 60 }],
    [{ note: KICK, velocity: 85 }, { note: OPEN_HH, velocity: 75 }],
    [{ note: CLOSED_HH, velocity: 60 }],
];

// 低能量 groove（verse/bridge 级）
const GROOVE_LOW: (DrumHit[] | null)[] = [
    [{ note: KICK, velocity: 80 }, { note: PEDAL_HH, velocity: 60 }],    // 1
    null,
    [{ note: PEDAL_HH, velocity: 50 }],
    null,
    [{ note: SIDE_STICK, velocity: 70 }, { note: PEDAL_HH, velocity: 55 }], // 2
    null,
    [{ note: PEDAL_HH, velocity: 50 }],
    null,
    [{ note: KICK, velocity: 70 }, { note: PEDAL_HH, velocity: 55 }],   // 3
    null,
    [{ note: PEDAL_HH, velocity: 50 }],
    null,
    [{ note: SIDE_STICK, velocity: 75 }, { note: PEDAL_HH, velocity: 55 }], // 4
    null,
    [{ note: PEDAL_HH, velocity: 50 }],
    null,
];

// 加花 (fill) 模板 — 4 拍（16 个 16 分音符）
const FILLS: (DrumHit[] | null)[][] = [
    // Fill 1: 经典 snare roll
    [
        [{ note: SNARE, velocity: 80 }], [{ note: SNARE, velocity: 85 }],
        [{ note: SNARE, velocity: 90 }], [{ note: SNARE, velocity: 90 }],
        [{ note: SNARE, velocity: 95 }], [{ note: SNARE, velocity: 95 }],
        [{ note: SNARE, velocity: 100 }], [{ note: SNARE, velocity: 100 }],
        [{ note: TOM_HIGH, velocity: 105 }], [{ note: TOM_HIGH, velocity: 100 }],
        [{ note: TOM_MID, velocity: 105 }], [{ note: TOM_MID, velocity: 100 }],
        [{ note: TOM_LOW, velocity: 110 }], [{ note: TOM_LOW, velocity: 105 }],
        [{ note: TOM_FLOOR, velocity: 115 }], [{ note: KICK, velocity: 120 }, { note: CRASH, velocity: 110 }],
    ],
    // Fill 2: Tom cascade
    [
        [{ note: KICK, velocity: 90 }], null,
        [{ note: TOM_HIGH, velocity: 95 }], [{ note: TOM_HIGH, velocity: 90 }],
        [{ note: TOM_MID, velocity: 100 }], null,
        [{ note: TOM_MID, velocity: 95 }], [{ note: TOM_LOW, velocity: 100 }],
        [{ note: TOM_LOW, velocity: 105 }], null,
        [{ note: TOM_FLOOR, velocity: 105 }], [{ note: TOM_FLOOR, velocity: 100 }],
        [{ note: KICK, velocity: 110 }], [{ note: SNARE, velocity: 110 }],
        [{ note: KICK, velocity: 115 }], [{ note: CRASH, velocity: 120 }],
    ],
    // Fill 3: Syncopated kick-snare
    [
        [{ note: KICK, velocity: 100 }], [{ note: SNARE, velocity: 85 }],
        null, [{ note: KICK, velocity: 90 }],
        [{ note: SNARE, velocity: 100 }], null,
        [{ note: KICK, velocity: 95 }], [{ note: SNARE, velocity: 90 }],
        [{ note: KICK, velocity: 100 }], [{ note: KICK, velocity: 90 }],
        [{ note: SNARE, velocity: 105 }], [{ note: SNARE, velocity: 100 }],
        [{ note: TOM_HIGH, velocity: 110 }], [{ note: TOM_MID, velocity: 110 }],
        [{ note: TOM_LOW, velocity: 115 }], [{ note: KICK, velocity: 120 }, { note: CRASH, velocity: 115 }],
    ],
    // Fill 4: 简洁 crash 强调
    [
        [{ note: KICK, velocity: 100 }, { note: CRASH, velocity: 90 }], null,
        [{ note: SNARE, velocity: 90 }], null,
        [{ note: KICK, velocity: 95 }], null,
        [{ note: SNARE, velocity: 95 }], [{ note: SNARE, velocity: 85 }],
        [{ note: TOM_HIGH, velocity: 100 }], [{ note: TOM_HIGH, velocity: 95 }],
        [{ note: TOM_MID, velocity: 100 }], [{ note: TOM_LOW, velocity: 105 }],
        [{ note: KICK, velocity: 110 }], [{ note: SNARE, velocity: 115 }],
        [{ note: KICK, velocity: 120 }], [{ note: CRASH, velocity: 120 }, { note: KICK, velocity: 120 }],
    ],
];

export class SmartDrumEngine {
    private measureCount: number = 0;      // 当前是第几小节
    private lastSlot: number = -1;         // 上一次触发的 slot（去重）
    private fillActive: boolean = false;   // 当前是否在加花
    private fillIndex: number = 0;         // 当前 fill 模板 index
    private userPressCount: number = 0;    // 用户在当前小节内按键次数
    private lastPressMeasure: number = -1; // 上次按键在第几小节

    // 获取当前拍位信息
    private getBeatInfo(): { slot: number; measureBeat: number; measure: number } {
        const currentTick = AudioEngine.getCurrentTick();
        const ppq = AudioEngine.getPpq();
        const timeSignature = GlobalContext.currentTimeSignature || [4, 4];
        const beatsPerMeasure = timeSignature[0];
        const ticksPerBeat = ppq * 4 / timeSignature[1];
        const ticksPerMeasure = beatsPerMeasure * ticksPerBeat;
        const ticksPer16th = ticksPerBeat / 4;

        const measure = Math.floor(currentTick / ticksPerMeasure);
        const tickInMeasure = currentTick % ticksPerMeasure;
        const slot = Math.round(tickInMeasure / ticksPer16th) % (beatsPerMeasure * 4);
        const measureBeat = tickInMeasure / ticksPerBeat;

        return { slot, measureBeat, measure };
    }

    // 根据段落能量选择 groove 模板
    private getGrooveTemplate(energyLevel: number): (DrumHit[] | null)[] {
        if (energyLevel >= 7) return GROOVE_HIGH;
        if (energyLevel <= 3) return GROOVE_LOW;
        return GROOVE_BASIC;
    }

    // 获取当前段落能量（从 currentTrack.sections 查询）
    private getCurrentEnergy(sections?: any[]): number {
        if (!sections) return 5;
        const currentTick = AudioEngine.getCurrentTick();
        const ppq = AudioEngine.getPpq();
        const currentBeat = currentTick / ppq;
        for (const sec of sections) {
            if (currentBeat >= sec.startBeat && currentBeat < sec.endBeat) {
                return sec.energyLevel || 5;
            }
        }
        return 5;
    }

    /**
     * 用户按下任意键时调用
     * 返回要播放的鼓点（可能是单个命中或一组命中）
     */
    public onUserPress(sections?: any[]): void {
        const { slot, measureBeat, measure } = this.getBeatInfo();
        const energy = this.getCurrentEnergy(sections);

        // 小节切换检测
        if (measure !== this.lastPressMeasure) {
            // 新小节开始，评估是否触发加花
            // 如果上一小节用户按键密集（>8次）且每4小节，触发加花
            if (this.userPressCount > 8 && this.measureCount % 4 === 3) {
                this.fillActive = true;
                this.fillIndex = Math.floor(Math.random() * FILLS.length);
            } else {
                this.fillActive = false;
            }
            this.userPressCount = 0;
            this.lastPressMeasure = measure;
            this.measureCount++;
        }

        this.userPressCount++;

        // 去重：同一个 16 分音符位置不重复触发
        if (slot === this.lastSlot) return;
        this.lastSlot = slot;

        // 选择要播放的内容
        let hits: DrumHit[] | null;

        if (this.fillActive && measure % 4 === 3) {
            // 加花模式：使用 fill 模板
            const fill = FILLS[this.fillIndex % FILLS.length];
            hits = fill[slot % fill.length];
        } else {
            // 正常 groove
            const groove = this.getGrooveTemplate(energy);
            hits = groove[slot % groove.length];
        }

        // 播放命中
        if (hits) {
            for (const hit of hits) {
                // 根据能量微调力度
                const velMul = energy >= 7 ? 1.1 : (energy <= 3 ? 0.8 : 1.0);
                const vel = Math.min(127, Math.round(hit.velocity * velMul));
                AudioEngine.playNote(9, hit.note, vel, 100);
                AudioEngine.emitVisualEvent({
                    type: 'drums', midiNote: hit.note, velocity: vel, source: 'gameplay'
                });
            }
        }

        // 用户疯狂按键时偶尔加入额外 crash/splash
        if (this.userPressCount > 6 && this.userPressCount % 4 === 0) {
            const accent = energy >= 6 ? CRASH : SPLASH;
            AudioEngine.playNote(9, accent, 85, 150);
            AudioEngine.emitVisualEvent({
                type: 'drums', midiNote: accent, velocity: 85, source: 'gameplay'
            });
        }
    }

    public reset(): void {
        this.measureCount = 0;
        this.lastSlot = -1;
        this.fillActive = false;
        this.userPressCount = 0;
        this.lastPressMeasure = -1;
    }
}
