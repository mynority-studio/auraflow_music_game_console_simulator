// motifSandbox — Q+R 旋律续写沙盒入口(独立于 newEngine 生产链)
export { MotifWeaverSandboxPanel } from './ui/MotifWeaverSandboxPanel';
export { generateMotifWeave } from './model/motifWeaver';
export { analyzeAndNormalize, generateSampleCaptured } from './model/motifAnalysis';
export { buildLeadOnlyIr } from './model/leadOnlyIr';
export type { UserMotif, MotifWeaverResult, MotifWeaverInput, SandboxStyle } from './model/types';
