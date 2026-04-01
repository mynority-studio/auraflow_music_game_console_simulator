import { BaseCounterMelodyIdiom } from "./BaseCounterMelodyIdiom";
import { PRNGManager } from "../../../utils/PRNG";
import { GlobalContext } from "../../GlobalContext";

export class PopCounterMelodyIdiom extends BaseCounterMelodyIdiom {
  protected getPitchOptions(isDownbeat: boolean, chordTones: number[], scalePcs: number[]): number[] {
    if (isDownbeat || PRNGManager.next() > 0.7) {
      return chordTones;
    } else {
      const root = 0;
      const pentatonicPcs = (
        GlobalContext.currentTonality === "Minor"
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
