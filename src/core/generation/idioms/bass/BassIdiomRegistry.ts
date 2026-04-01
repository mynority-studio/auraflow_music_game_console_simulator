import { IBassIdiom } from "./IBassIdiom";

export class BassIdiomRegistry {
  private static idioms: Map<string, IBassIdiom> = new Map();

  public static register(name: string, idiom: IBassIdiom) {
    this.idioms.set(name, idiom);
  }

  public static getIdiom(name: string): IBassIdiom | undefined {
    return this.idioms.get(name);
  }

  public static getAllIdiomNames(): string[] {
    return Array.from(this.idioms.keys());
  }
}
