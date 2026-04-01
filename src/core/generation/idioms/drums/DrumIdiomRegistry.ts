import { IDrumIdiom } from "./IDrumIdiom";

export class DrumIdiomRegistry {
  private static idioms: Map<string, IDrumIdiom> = new Map();

  public static register(name: string, idiom: IDrumIdiom) {
    this.idioms.set(name, idiom);
  }

  public static getIdiom(name: string): IDrumIdiom {
    return this.idioms.get(name) || this.idioms.get("pop")!;
  }

  public static getAllIdiomNames(): string[] {
    return Array.from(this.idioms.keys());
  }
}
