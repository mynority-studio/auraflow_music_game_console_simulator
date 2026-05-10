// ============================================================
// InstrumentRegistry — 乐器物理参数 + 能力声明
// ============================================================
// 直接移植自参考代码 manifests/InstrumentRegistry.ts + instruments/*.ts
//
//   id  name                minPitch  maxPitch  poly  antiMud  bend  slide  mono  capabilities
//   0   Grand Piano         21        108       10    48 (C3)  no    no     no    Lead/Accomp/Bass
//   1   Electric Piano      21        108       10    45 (A2)  no    no     no    Lead/Accomp/Bass
//   2   Electric Bass       28        67        4     0        yes   yes    yes   Bass/Lead
//   3   Standard Drum Kit   35        81        4     0        no    no     no    Percussion
// ============================================================

import { InstrumentConfig, MusicalRole } from '../types';

export const GrandPiano: InstrumentConfig = {
    id: 0,
    name: 'Grand Piano',
    minPitch: 21,
    maxPitch: 108,
    maxPolyphony: 10,
    antiMudThreshold: 48,
    supportsPitchBend: false,
    supportsSlide: false,
    isMonophonic: false,
    capabilities: [MusicalRole.Lead, MusicalRole.Accomp, MusicalRole.Bass],
};

export const ElectricPiano: InstrumentConfig = {
    id: 1,
    name: 'Electric Piano',
    minPitch: 21,
    maxPitch: 108,
    maxPolyphony: 10,
    antiMudThreshold: 45,
    supportsPitchBend: false,
    supportsSlide: false,
    isMonophonic: false,
    capabilities: [MusicalRole.Lead, MusicalRole.Accomp, MusicalRole.Bass],
};

export const ElectricBass: InstrumentConfig = {
    id: 2,
    name: 'Electric Bass',
    minPitch: 28,
    maxPitch: 67,
    maxPolyphony: 4,
    antiMudThreshold: 0,
    supportsPitchBend: true,
    supportsSlide: true,
    isMonophonic: true,
    capabilities: [MusicalRole.Bass, MusicalRole.Lead],
};

export const StandardDrumKit: InstrumentConfig = {
    id: 3,
    name: 'Standard Drum Kit',
    minPitch: 35,
    maxPitch: 81,
    maxPolyphony: 4,
    antiMudThreshold: 0,
    supportsPitchBend: false,
    supportsSlide: false,
    isMonophonic: false,
    capabilities: [MusicalRole.Percussion],
};

export const INSTRUMENT_REGISTRY: Record<number, InstrumentConfig> = {
    0: GrandPiano,
    1: ElectricPiano,
    2: ElectricBass,
    3: StandardDrumKit,
};

export function getInstrumentConfig(id: number): InstrumentConfig {
    return INSTRUMENT_REGISTRY[id] || GrandPiano;
}
