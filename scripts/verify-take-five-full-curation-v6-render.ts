// Byte-lock the v6 score -> MIDI -> SoundFont render chain.

import { TAKE_FIVE_FULL_CURATION_CANDIDATE_V6 } from '../src/core/generation/newEngine/videoReplica';
import { verifyTakeFiveFullCurationRender } from './lib/verify-take-five-full-curation-render';

verifyTakeFiveFullCurationRender({
  score: TAKE_FIVE_FULL_CURATION_CANDIDATE_V6,
  artifactStem: 'take-five-full-curation-v6',
  defaultOutputDir: 'tmp/video-replica/take-five-full-curation-v6',
  temporaryPrefix: 'take-five-full-v6-render-',
});
