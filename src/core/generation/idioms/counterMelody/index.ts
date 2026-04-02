export * from './ICounterMelodyIdiom';
export * from './CounterMelodyIdiomRegistry';
export * from './BaseCounterMelodyIdiom';
export * from './SustainedCounterMelodyIdiom';
export * from './MelodicCounterMelodyIdiom';

import { CounterMelodyIdiomRegistry } from './CounterMelodyIdiomRegistry';
import { SustainedCounterMelodyIdiom } from './SustainedCounterMelodyIdiom';
import { MelodicCounterMelodyIdiom } from './MelodicCounterMelodyIdiom';

export function registerAllCounterMelodyIdioms() {
  CounterMelodyIdiomRegistry.register('sustained', new SustainedCounterMelodyIdiom());
  CounterMelodyIdiomRegistry.register('melodic', new MelodicCounterMelodyIdiom());
}
