import { GenerationParams } from '../../core/generation/types';
import { LofiPreset } from '../../core/generation/presets/LofiPreset';

export interface BarConfig {
  id: string;
  name: string;
  imagePath: string;
  preset?: Partial<GenerationParams>;
}

export const ALL_BARS: BarConfig[] = [
  {
    id: 'edm-bar',
    name: 'EDM CLUB',
    imagePath: '/assets/barImg/EDMBar.png',
  },
  {
    id: 'jazz-bar',
    name: 'JAZZ CAFE',
    imagePath: '/assets/barImg/JazzBar.png',
    preset: LofiPreset,
  },
  {
    id: 'lounge-bar',
    name: 'LOUNGE BAR',
    imagePath: '/assets/barImg/LoungeBar.png',
    preset: LofiPreset,
  },
  {
    id: 'pop-bar',
    name: 'POP STAGE',
    imagePath: '/assets/barImg/PopBar.png',
  },
  {
    id: 'rap-bar',
    name: 'HIPHOP CLUB',
    imagePath: '/assets/barImg/RapBar.png',
    preset: LofiPreset,
  },
  {
    id: 'retro-bar',
    name: 'RETRO ARCADE',
    imagePath: '/assets/barImg/RetroBar.png',
  },
  {
    id: 'rock-bar',
    name: 'ROCK TAVERN',
    imagePath: '/assets/barImg/RockBar.png',
  }
];
