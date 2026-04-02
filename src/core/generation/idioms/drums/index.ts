import { DrumIdiomRegistry } from "./DrumIdiomRegistry";
import { SteadyDrumIdiom } from "./SteadyDrumIdiom";
import { SyncopatedDrumIdiom } from "./SyncopatedDrumIdiom";
import { AcousticSwingDrumIdiom } from "./AcousticSwingDrumIdiom";
import { HighEnergyDrumIdiom } from "./HighEnergyDrumIdiom";
import { SparseDrumIdiom } from "./SparseDrumIdiom";

export function registerAllDrumIdioms() {
  DrumIdiomRegistry.register("steady", new SteadyDrumIdiom());
  DrumIdiomRegistry.register("syncopated", new SyncopatedDrumIdiom());
  DrumIdiomRegistry.register("acoustic-swing", new AcousticSwingDrumIdiom());
  DrumIdiomRegistry.register("high-energy", new HighEnergyDrumIdiom());
  DrumIdiomRegistry.register("sparse", new SparseDrumIdiom());
}
