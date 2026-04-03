export interface BarConfig {
  id: string;
  name: string;
  imagePath: string;
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
  },
  {
    id: 'lounge-bar',
    name: 'LOUNGE BAR',
    imagePath: '/assets/barImg/LoungeBar.png',
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
