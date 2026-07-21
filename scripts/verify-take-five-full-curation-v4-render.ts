// Byte-lock the historical v4 score -> MIDI -> SoundFont render chain.

import { TAKE_FIVE_FULL_CURATION_CANDIDATE_V4 } from '../src/core/generation/newEngine/videoReplica';
import { verifyTakeFiveFullCurationRender } from './lib/verify-take-five-full-curation-render';

verifyTakeFiveFullCurationRender({
  score: TAKE_FIVE_FULL_CURATION_CANDIDATE_V4,
  artifactStem: 'take-five-full-curation-v4',
  defaultOutputDir: 'tmp/video-replica/take-five-full-curation-v4',
  temporaryPrefix: 'take-five-full-v4-render-',
});
