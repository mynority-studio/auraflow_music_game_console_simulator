import { ICounterMelodyIdiom } from "./ICounterMelodyIdiom";

export class CounterMelodyIdiomRegistry {
  private static idioms: Record<string, ICounterMelodyIdiom> = {};

  public static getIdiom(name: string): ICounterMelodyIdiom | undefined {
    return this.idioms[name];
  }

  public static register(name: string, idiom: ICounterMelodyIdiom) {
    this.idioms[name] = idiom;
  }
}
