import { StyleId } from '../../core/generation/config/StyleFlags';

export interface BarConfig {
  id: string;
  name: string;
  imagePath: string;
  styleIds: StyleId[];
}

// 7 个酒吧 × 3 风格的合理映射（每吧允许 1~3 种 styleId 加权抽取）
// 移植后只剩 ModernPop / ChillJazz / NeoSoul 三个风格，按主题分配：
//   EDM / Pop / Retro    → ModernPop
//   Jazz / Lounge / Rock → ChillJazz（rock 用 jazz 兜底，等后续 RockStyle 加入）
//   Hiphop               → NeoSoul
// 部分酒吧给两种风格池，让 EndlessRadioManager 抽到不同的氛围。
export const ALL_BARS: BarConfig[] = [
  {
    id: 'edm-bar',
    name: 'EDM CLUB',
    imagePath: '/assets/barImg/EDMBar.png',
    styleIds: [StyleId.ModernPop],
  },
  {
    id: 'jazz-bar',
    name: 'JAZZ CAFE',
    imagePath: '/assets/barImg/JazzBar.png',
    styleIds: [StyleId.ChillJazz],
  },
  {
    id: 'lounge-bar',
    name: 'LOUNGE BAR',
    imagePath: '/assets/barImg/LoungeBar.png',
    styleIds: [StyleId.ChillJazz, StyleId.NeoSoul],
  },
  {
    id: 'pop-bar',
    name: 'POP STAGE',
    imagePath: '/assets/barImg/PopBar.png',
    styleIds: [StyleId.ModernPop],
  },
  {
    id: 'rap-bar',
    name: 'HIPHOP CLUB',
    imagePath: '/assets/barImg/RapBar.png',
    styleIds: [StyleId.NeoSoul, StyleId.ModernPop],
  },
  {
    id: 'retro-bar',
    name: 'RETRO ARCADE',
    imagePath: '/assets/barImg/RetroBar.png',
    styleIds: [StyleId.ModernPop],
  },
  {
    id: 'rock-bar',
    name: 'ROCK TAVERN',
    imagePath: '/assets/barImg/RockBar.png',
    styleIds: [StyleId.ModernPop, StyleId.ChillJazz],
  },
];
