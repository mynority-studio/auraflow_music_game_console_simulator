import { IRiffIdiom } from "./IRiffIdiom";
import { DefaultRiffIdiom } from "./DefaultRiffIdiom";

export class RiffIdiomRegistry {
  private static idioms: Record<string, IRiffIdiom> = {
    default: new DefaultRiffIdiom(),
  };

  public static getIdiom(name: string): IRiffIdiom {
    return this.idioms[name] || this.idioms["default"];
  }

  public static register(name: string, idiom: IRiffIdiom) {
    this.idioms[name] = idiom;
  }
}
