import { BassIdiomRegistry } from "./BassIdiomRegistry";
import { PopBassIdiom } from "./PopBassIdiom";
import { FunkBassIdiom } from "./FunkBassIdiom";
import { JazzBassIdiom } from "./JazzBassIdiom";
import { BossaBassIdiom } from "./BossaBassIdiom";
import { ReggaeBassIdiom } from "./ReggaeBassIdiom";
import { LatinBassIdiom } from "./LatinBassIdiom";
import { CinematicBassIdiom } from "./CinematicBassIdiom";
import { BassSoloIdiom } from "./BassSoloIdiom";
import { NeoSoulBassIdiom } from "./NeoSoulBassIdiom";
import { RiffDrivenBassIdiom } from "./RiffDrivenBassIdiom";

export function registerAllBassIdioms() {
  BassIdiomRegistry.register("pop", new PopBassIdiom());
  BassIdiomRegistry.register("rock", new PopBassIdiom());
  BassIdiomRegistry.register("eurodance", new PopBassIdiom()); // Merged
  BassIdiomRegistry.register("trance", new PopBassIdiom()); // Merged
  BassIdiomRegistry.register("synthwave", new PopBassIdiom()); // Merged
  BassIdiomRegistry.register("funk", new FunkBassIdiom());
  BassIdiomRegistry.register("jazz", new JazzBassIdiom());
  BassIdiomRegistry.register("bossa", new BossaBassIdiom());
  BassIdiomRegistry.register("reggae", new ReggaeBassIdiom());
  BassIdiomRegistry.register("latin", new LatinBassIdiom());
  BassIdiomRegistry.register("cinematic", new CinematicBassIdiom());
  BassIdiomRegistry.register("ballad", new CinematicBassIdiom());
  BassIdiomRegistry.register("folk", new CinematicBassIdiom());
  BassIdiomRegistry.register("neosoul", new NeoSoulBassIdiom());
  BassIdiomRegistry.register("riff", new RiffDrivenBassIdiom());
  BassIdiomRegistry.register("solo", new BassSoloIdiom());
}
