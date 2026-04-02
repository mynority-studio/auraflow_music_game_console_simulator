import { IDrumIdiom } from "./IDrumIdiom";

export class DrumIdiomRegistry {
  private static idioms: Record<string, IDrumIdiom> = {};

  public static register(name: string, idiom: IDrumIdiom) {
    this.idioms[name] = idiom;
  }

  public static getIdiom(name: string): IDrumIdiom | undefined {
    return this.idioms[name];
  }

  public static getAllIdiomNames(): string[] {
    return Object.keys(this.idioms);
  }
}
