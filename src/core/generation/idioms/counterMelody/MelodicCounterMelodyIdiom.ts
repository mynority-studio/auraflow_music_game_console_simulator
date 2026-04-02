import { BaseCounterMelodyIdiom } from "./BaseCounterMelodyIdiom";

export class MelodicCounterMelodyIdiom extends BaseCounterMelodyIdiom {
  // S-2 合规：tonality 从 ctx 参数传入，替代 GlobalContext.currentTonality
  protected getPitchOptions(isDownbeat: boolean, chordTones: number[], scalePcs: number[], tonality: string = 'Major'): number[] {
    if (isDownbeat) {
      return chordTones;
    } else {
      const root = 0;
      const pentatonicPcs = (
        tonality === "Minor"
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
