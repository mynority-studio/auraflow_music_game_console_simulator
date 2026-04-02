import { BassIdiomRegistry } from "./BassIdiomRegistry";
import { SteadyBassIdiom } from "./SteadyBassIdiom";
import { SyncopatedBassIdiom } from "./SyncopatedBassIdiom";
import { MelodicBassIdiom } from "./MelodicBassIdiom";
import { SparseBassIdiom } from "./SparseBassIdiom";
import { BassSoloIdiom } from "./BassSoloIdiom";
import { RiffDrivenBassIdiom } from "./RiffDrivenBassIdiom";

export function registerAllBassIdioms() {
  BassIdiomRegistry.register("steady", new SteadyBassIdiom());
  BassIdiomRegistry.register("syncopated", new SyncopatedBassIdiom());
  BassIdiomRegistry.register("melodic", new MelodicBassIdiom());
  BassIdiomRegistry.register("sparse", new SparseBassIdiom());
  BassIdiomRegistry.register("riff-driven", new RiffDrivenBassIdiom());
  BassIdiomRegistry.register("solo", new BassSoloIdiom());
}
