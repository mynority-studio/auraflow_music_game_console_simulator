import { IVocalHarmonyIdiom } from "./IVocalHarmonyIdiom";
import { PopVocalHarmonyIdiom } from "./PopVocalHarmonyIdiom";
import { RnBVocalHarmonyIdiom } from "./RnBVocalHarmonyIdiom";
import { GospelVocalHarmonyIdiom } from "./GospelVocalHarmonyIdiom";
import { DynamicChoirIdiom } from "./DynamicChoirIdiom";

export class VocalHarmonyIdiomRegistry {
  private static idioms: Record<string, IVocalHarmonyIdiom> = {
    pop: new PopVocalHarmonyIdiom(),
    ballad: new PopVocalHarmonyIdiom(),
    neosoul: new RnBVocalHarmonyIdiom(),
    rnb: new RnBVocalHarmonyIdiom(),
    gospel: new GospelVocalHarmonyIdiom(),
    choir: new DynamicChoirIdiom(),
  };

  public static getIdiom(name: string): IVocalHarmonyIdiom {
    return this.idioms[name] || this.idioms["pop"];
  }

  public static register(name: string, idiom: IVocalHarmonyIdiom) {
    this.idioms[name] = idiom;
  }
}
