/**
 * Run a single case and exit. Used by mg-engine-isolated-test.sh
 * to run each case in a fresh node process.
 */
import { Engine as MgEngine, Random as MgRandom } from '../../melodygenerative/src/lib/musicEngine';

const seed = process.argv[2];
const style = process.argv[3];
const bars = parseInt(process.argv[4], 10);

const cfg: any = { seed: `${seed}::harmony`, style, key: 'C', mode: 'Major', emotion: 'auto', barsOverride: bars };
const eng = new MgEngine(new MgRandom(cfg.seed));
const chords = eng.generateProgressions(cfg);
const events = eng.generateArrangement(chords, cfg).events;

console.log(`${chords.length}/${events.length}`);
