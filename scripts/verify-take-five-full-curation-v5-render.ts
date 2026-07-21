// Byte-lock the v5 score -> MIDI -> SoundFont render chain.

import { TAKE_FIVE_FULL_CURATION_CANDIDATE_V5 } from '../src/core/generation/newEngine/videoReplica';
import { verifyTakeFiveFullCurationRender } from './lib/verify-take-five-full-curation-render';

verifyTakeFiveFullCurationRender({
  score: TAKE_FIVE_FULL_CURATION_CANDIDATE_V5,
  artifactStem: 'take-five-full-curation-v5',
  defaultOutputDir: 'tmp/video-replica/take-five-full-curation-v5',
  temporaryPrefix: 'take-five-full-v5-render-',
});
