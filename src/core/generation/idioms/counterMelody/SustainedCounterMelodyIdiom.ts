import { Tonality } from "../../types";
import { BaseCounterMelodyIdiom } from "./BaseCounterMelodyIdiom";
import { PRNGManager } from "../../../utils/PRNG";

export class SustainedCounterMelodyIdiom extends BaseCounterMelodyIdiom {
  // S-2 合规：tonality 从 ctx 参数传入，替代 GlobalContext.currentTonality
  protected getPitchOptions(isDownbeat: boolean, chordTones: number[], scalePcs: number[], tonality: Tonality = Tonality.Major): number[] {
    if (isDownbeat || PRNGManager.next() > 0.7) {
      return chordTones;
    } else {
      const root = 0;
      const pentatonicPcs = (
        tonality === Tonality.Minor
          ? [0, 3, 5, 7, 10]
          : [0, 2, 4, 7, 9]
      ).map((i) => (root + i) % 12);
      const safePentatonic = scalePcs.filter(
        (pc) =>
          pentatonicPcs.includes(pc % 12) ||
          chordTones.map((c) => c % 12).includes(pc % 12),
      );
      return safePentatonic.length > 0 ? safePentatonic : scalePcs;
    }
  }
}
