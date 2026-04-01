import { IPianoIdiom } from "./IPianoIdiom";
import { PopPianoIdiom } from "./PopPianoIdiom";
import { BossaPianoIdiom } from "./BossaPianoIdiom";
import { FunkPianoIdiom } from "./FunkPianoIdiom";
import { ReggaePianoIdiom } from "./ReggaePianoIdiom";

export class PianoIdiomRegistry {
  private static idioms: Record<string, IPianoIdiom> = {
    pop: new PopPianoIdiom(),
    ballad: new PopPianoIdiom(),
    rock: new PopPianoIdiom(),
    neosoul: new PopPianoIdiom(), // NeoSoul is handled inside PopPianoIdiom for now
    bossa: new BossaPianoIdiom(),
    funk: new FunkPianoIdiom(),
    electronic: new PopPianoIdiom(),
    eurodance: new PopPianoIdiom(),
    trance: new PopPianoIdiom(),
    synthwave: new PopPianoIdiom(),
    edm: new PopPianoIdiom(),
    reggae: new ReggaePianoIdiom(),
  };

  public static register(name: string, idiom: IPianoIdiom) {
    this.idioms[name] = idiom;
  }

  public static getIdiom(name: string): IPianoIdiom {
    return this.idioms[name] || this.idioms["pop"];
  }

  public static getAllIdiomNames(): string[] {
    return Object.keys(this.idioms);
  }
}
