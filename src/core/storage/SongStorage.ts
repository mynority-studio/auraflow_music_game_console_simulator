export interface SongData {
  id: string;
  name: string;
  style: string;
  createdAt: number;
  trackData?: any;
}

export function saveSong(song: Omit<SongData, 'id' | 'createdAt'>): void {
  // console.log('Saving song:', song);
  // In a real app, this would save to local storage or a backend database
}

export function loadSongs(): SongData[] {
  return [];
}
