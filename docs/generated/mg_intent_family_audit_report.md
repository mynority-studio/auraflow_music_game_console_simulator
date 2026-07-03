# Intent Family Audit(Phase 3 observe)

意图 family(arranger 派生)vs 实际 texture case family。actual∈intended? + match rate。

## 0/acg
| section | intended | actual cases → families | match |
|---|---|---|---|
| intro | wash | Piano_TopVoice_P→wash | 100% |
| verse | wash | ACG_Ostinato_Hoo→ostinato, ACG_Sakamoto_LH_→arp, Piano_TopVoice_P→wash | 13% ⚠ |
| chorus | wash | ACG_Open_Broken_→broken, ACG_Quartal_Arp_→arp, ACG_Stride_Canta→stride, ACG_Pedal_Wash_C→pedal | 0% ⚠ |
| verse | wash | ACG_Quartal_Arp_→arp, ACG_Open_Broken_→broken, ACG_Ostinato_Hoo→ostinato | 0% ⚠ |
| chorus | wash | ACG_Ostinato_Hoo→ostinato, ACG_Suspended_Bl→block, ACG_Anthem_Block→block, ACG_Bass_Tremolo→pulse | 0% ⚠ |
| outro | wash | ACG_Sakamoto_LH_→arp, ACG_Suspended_Bl→block, ACG_Pedal_Wash_C→pedal, Piano_TopVoice_P→wash | 25% ⚠ |

## 42/acg
| section | intended | actual cases → families | match |
|---|---|---|---|
| intro | wash | ACG_Pedal_Wash_C→pedal, Piano_TopVoice_P→wash | 50% ⚠ |
| verse | wash | ACG_Ostinato_Hoo→ostinato, Piano_TopVoice_P→wash, ACG_Pedal_Wash_C→pedal | 25% ⚠ |
| chorus | wash | Piano_TopVoice_P→wash, ACG_Pedal_Wash_C→pedal, ACG_Ostinato_Hoo→ostinato, ACG_Quartal_Arp_→arp, ACG_Open_Broken_→broken, ACG_Stride_Canta→stride | 13% ⚠ |
| verse | wash | ACG_Quartal_Arp_→arp, ACG_Open_Broken_→broken, ACG_Stride_Canta→stride, ACG_Ostinato_Hoo→ostinato | 0% ⚠ |
| chorus | wash | ACG_Anthem_Block→block, ACG_Open_Broken_→broken, ACG_Quartal_Arp_→arp | 0% ⚠ |
| bridge | wash | ACG_Ostinato_Hoo→ostinato, ACG_Quartal_Arp_→arp, ACG_Open_Broken_→broken, ACG_Pedal_Wash_C→pedal, ACG_Anthem_Block→block | 0% ⚠ |
| chorus | wash | ACG_Bass_Tremolo→pulse, ACG_Anthem_Block→block, ACG_Suspended_Bl→block | 0% ⚠ |
| outro | wash | Piano_TopVoice_P→wash | 100% |

## 7/pop
| section | intended | actual cases → families | match |
|---|---|---|---|
| verse | arp | Pop_Wave_16ths→arp, Pop_Broken_8ths_→broken | 50% ⚠ |
| chorus | arp | Pop_Wave_16ths→arp | 100% |
| chorus | arp | Pop_Wave_16ths→arp | 100% |
| outro | arp | Pop_Wave_16ths→arp | 100% |

## 42/rnb
| section | intended | actual cases → families | match |
|---|---|---|---|
| intro | block | Pop_Rnb_Expensiv→block | 100% |
| verse | block | Pop_Rnb_Expensiv→block | 100% |
| verse | block | Pop_Rnb_Expensiv→block | 100% |
| chorus | block | RnB_Neo_Soul_Rol→roll | 0% ⚠ |
| chorus | block | RnB_Neo_Soul_Rol→roll | 0% ⚠ |
| outro | block | (空) | 100% |

## 99/lofi
| section | intended | actual cases → families | match |
|---|---|---|---|
| intro | pulse | Piano_Lofi_OneSh→wash | 0% ⚠ |
| verse | pulse | Piano_Lofi_OneSh→wash | 0% ⚠ |
| verse | pulse | Piano_Lofi_OneSh→wash | 0% ⚠ |
| outro | pulse | (空) | 100% |

## 3/jazz
| section | intended | actual cases → families | match |
|---|---|---|---|
| intro | block | Jazz_Red_Garland→block | 100% |
| verse | block | Jazz_Red_Garland→block | 100% |
| verse | block | Jazz_Red_Garland→block | 100% |
| bridge | block | Jazz_Red_Garland→block, Jazz_Charleston_→pulse | 6% ⚠ |
| chorus | block | Jazz_Charleston_→pulse | 0% ⚠ |
| outro | block | Jazz_Charleston_→pulse, Jazz_Red_Garland→block | 75% ⚠ |

## 42/jazz
| section | intended | actual cases → families | match |
|---|---|---|---|
| intro | block | Jazz_Charleston_→pulse | 0% ⚠ |
| verse | block | Jazz_Charleston_→pulse | 0% ⚠ |
| verse | block | Jazz_Charleston_→pulse | 0% ⚠ |
| bridge | block | Jazz_Charleston_→pulse, Jazz_Red_Garland→block | 94% ⚠ |
| chorus | block | Jazz_Red_Garland→block | 100% |
| outro | block | Jazz_Red_Garland→block, Jazz_Charleston_→pulse | 25% ⚠ |

## 汇总:family match rate = 40.9% (144/352)
- observe 阶段:mismatch 不改输出,只揭示"现 texture 选择"与"arranger family 意图"的对齐 gap。
- enforce(Phase 3 后续,待签字):resolver 在意图 family 内选 case → match rate 应 →100%(enforced slots)。