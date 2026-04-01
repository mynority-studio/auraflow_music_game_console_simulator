import { PianoIdiomRegistry } from './PianoIdiomRegistry';
import { PopPianoIdiom } from './PopPianoIdiom';
import { BossaPianoIdiom } from './BossaPianoIdiom';
import { FunkPianoIdiom } from './FunkPianoIdiom';
import { ReggaePianoIdiom } from './ReggaePianoIdiom';

export function registerAllPianoIdioms() {
  PianoIdiomRegistry.register('pop', new PopPianoIdiom());
  PianoIdiomRegistry.register('ballad', new PopPianoIdiom());
  PianoIdiomRegistry.register('neosoul', new PopPianoIdiom());
  PianoIdiomRegistry.register('jazz', new PopPianoIdiom()); // We can create a dedicated Jazz idiom later
  PianoIdiomRegistry.register('bossa', new BossaPianoIdiom());
  PianoIdiomRegistry.register('funk', new FunkPianoIdiom());
  PianoIdiomRegistry.register('reggae', new ReggaePianoIdiom());
  PianoIdiomRegistry.register('electronic', new PopPianoIdiom()); // Merged
  PianoIdiomRegistry.register('eurodance', new PopPianoIdiom()); // Merged
  PianoIdiomRegistry.register('trance', new PopPianoIdiom()); // Merged
  PianoIdiomRegistry.register('synthwave', new PopPianoIdiom()); // Merged
  PianoIdiomRegistry.register('edm', new PopPianoIdiom()); // Merged
}
