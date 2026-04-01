import { DrumIdiomRegistry } from "./DrumIdiomRegistry";
import { PopDrumIdiom } from "./PopDrumIdiom";
import { RockDrumIdiom } from "./RockDrumIdiom";
import { JazzDrumIdiom } from "./JazzDrumIdiom";
import { FunkDrumIdiom } from "./FunkDrumIdiom";
import { EdmDrumIdiom } from "./EdmDrumIdiom";
import { ReggaeDrumIdiom } from "./ReggaeDrumIdiom";
import { LofiDrumIdiom } from "./LofiDrumIdiom";
import { BossaDrumIdiom } from "./BossaDrumIdiom";
import { FolkDrumIdiom } from "./FolkDrumIdiom";
import { CinematicDrumIdiom } from "./CinematicDrumIdiom";
import { NeoSoulDrumIdiom } from "./NeoSoulDrumIdiom";
import { BalladDrumIdiom } from "./BalladDrumIdiom";

export function registerAllDrumIdioms() {
  DrumIdiomRegistry.register("pop", new PopDrumIdiom());
  DrumIdiomRegistry.register("rock", new RockDrumIdiom());
  DrumIdiomRegistry.register("jazz", new JazzDrumIdiom());
  DrumIdiomRegistry.register("funk", new FunkDrumIdiom());
  DrumIdiomRegistry.register("edm", new EdmDrumIdiom());
  DrumIdiomRegistry.register("electronic", new EdmDrumIdiom()); // Alias
  DrumIdiomRegistry.register("eurodance", new EdmDrumIdiom()); // Merged
  DrumIdiomRegistry.register("synthwave", new EdmDrumIdiom()); // Merged
  DrumIdiomRegistry.register("trance", new EdmDrumIdiom()); // Merged
  DrumIdiomRegistry.register("reggae", new ReggaeDrumIdiom());
  DrumIdiomRegistry.register("lofi", new LofiDrumIdiom());
  DrumIdiomRegistry.register("bossa", new BossaDrumIdiom());
  DrumIdiomRegistry.register("folk", new FolkDrumIdiom());
  DrumIdiomRegistry.register("cinematic", new CinematicDrumIdiom());
  DrumIdiomRegistry.register("neosoul", new NeoSoulDrumIdiom());
  DrumIdiomRegistry.register("ballad", new BalladDrumIdiom());
}
