import { IBassIdiom } from "./IBassIdiom";

export class BassIdiomRegistry {
  private static idioms: Record<string, IBassIdiom> = {};

  public static register(name: string, idiom: IBassIdiom) {
    this.idioms[name] = idiom;
  }

  public static getIdiom(name: string): IBassIdiom | undefined {
    return this.idioms[name];
  }

  public static getAllIdiomNames(): string[] {
    return Object.keys(this.idioms);
  }
}
