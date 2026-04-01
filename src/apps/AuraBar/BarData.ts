import { StyleId } from '../../core/generation/config/StyleFlags';

export interface BarConfig {
  id: string;
  name: string;
  imagePath: string;
  styleIds: StyleId[];
}

export const ALL_BARS: BarConfig[] = [
  {
    id: 'edm-bar',
    name: 'EDM CLUB',
    imagePath: '/assets/barImg/EDMBar.png',
    styleIds: [StyleId.Trance, StyleId.Eurodance],
  },
  {
    id: 'jazz-bar',
    name: 'JAZZ CAFE',
    imagePath: '/assets/barImg/JazzBar.png',
    styleIds: [StyleId.Lofi],
  },
  {
    id: 'lounge-bar',
    name: 'LOUNGE BAR',
    imagePath: '/assets/barImg/LoungeBar.png',
    styleIds: [StyleId.GhibliOrchestral],
  },
  {
    id: 'pop-bar',
    name: 'POP STAGE',
    imagePath: '/assets/barImg/PopBar.png',
    styleIds: [StyleId.ModernPop, StyleId.ClassicJPop, StyleId.ModernJPop],
  },
  {
    id: 'rap-bar',
    name: 'HIPHOP CLUB',
    imagePath: '/assets/barImg/RapBar.png',
    styleIds: [StyleId.Lofi],
  },
  {
    id: 'retro-bar',
    name: 'RETRO ARCADE',
    imagePath: '/assets/barImg/RetroBar.png',
    styleIds: [StyleId.Synthwave],
  },
  {
    id: 'rock-bar',
    name: 'ROCK TAVERN',
    imagePath: '/assets/barImg/RockBar.png',
    styleIds: [StyleId.PopRock, StyleId.PowerBallad],
  }
];
