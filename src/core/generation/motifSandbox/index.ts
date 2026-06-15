// motifSandbox — Q+R 旋律续写沙盒入口(独立于 newEngine 生产链)
export { MotifWeaverSandboxPanel } from './ui/MotifWeaverSandboxPanel';
export { generateMotifWeave } from './model/motifWeaver';
export { analyzeAndNormalize, generateSampleCaptured } from './model/motifAnalysis';
export { buildLeadOnlyIr, buildSandboxIr } from './model/leadOnlyIr';
export { buildAccompaniment } from './model/accompaniment';
export type { UserMotif, MotifWeaverResult, MotifWeaverInput, SandboxStyle } from './model/types';
