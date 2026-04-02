import { IPianoIdiom } from "./IPianoIdiom";

export class PianoIdiomRegistry {
  private static idioms: Record<string, IPianoIdiom> = {};

  public static register(name: string, idiom: IPianoIdiom) {
    this.idioms[name] = idiom;
  }

  public static getIdiom(name: string): IPianoIdiom | undefined {
    return this.idioms[name];
  }

  public static getAllIdiomNames(): string[] {
    return Object.keys(this.idioms);
  }
}
