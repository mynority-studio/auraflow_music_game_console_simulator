import { PianoIdiomRegistry } from './PianoIdiomRegistry';
import { BlockChordPianoIdiom } from './BlockChordPianoIdiom';
import { ArpeggiatedPianoIdiom } from './ArpeggiatedPianoIdiom';
import { RhythmicPianoIdiom } from './RhythmicPianoIdiom';
import { SparsePianoIdiom } from './SparsePianoIdiom';

export function registerAllPianoIdioms() {
  PianoIdiomRegistry.register('block-chord', new BlockChordPianoIdiom());
  PianoIdiomRegistry.register('arpeggiated', new ArpeggiatedPianoIdiom());
  PianoIdiomRegistry.register('rhythmic', new RhythmicPianoIdiom());
  PianoIdiomRegistry.register('sparse', new SparsePianoIdiom());
}
