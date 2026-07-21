// Byte-lock the provisional v7 score -> MIDI -> SoundFont render chain.

import { TAKE_FIVE_FULL_CURATION_CANDIDATE_V7 } from '../src/core/generation/newEngine/videoReplica';
import { verifyTakeFiveFullCurationRender } from './lib/verify-take-five-full-curation-render';

verifyTakeFiveFullCurationRender({
  score: TAKE_FIVE_FULL_CURATION_CANDIDATE_V7,
  artifactStem: 'take-five-full-curation-v7',
  defaultOutputDir: 'tmp/video-replica/take-five-full-curation-v7',
  temporaryPrefix: 'take-five-full-v7-render-',
});
