import { ICounterMelodyIdiom } from "./ICounterMelodyIdiom";
import { PopCounterMelodyIdiom } from "./PopCounterMelodyIdiom";
import { JazzCounterMelodyIdiom } from "./JazzCounterMelodyIdiom";

export class CounterMelodyIdiomRegistry {
  private static idioms: Record<string, ICounterMelodyIdiom> = {
    pop: new PopCounterMelodyIdiom(),
    ballad: new PopCounterMelodyIdiom(),
    jazz: new JazzCounterMelodyIdiom(),
  };

  public static getIdiom(name: string): ICounterMelodyIdiom {
    return this.idioms[name] || this.idioms["pop"];
  }

  public static register(name: string, idiom: ICounterMelodyIdiom) {
    this.idioms[name] = idiom;
  }
}
