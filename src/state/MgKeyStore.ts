// ============================================================
// MgKeyStore — mgEngine 当前调(2026-05-27)
// ============================================================
//
// 对齐 mg App.tsx 的 musicKey state(12 keys C ~ B)。
// PipelineMonitor 下拉写入 → runPipeline 读取后传给 mg adapter。
// ============================================================

export type MgKey =
    | 'C' | 'Db' | 'D' | 'Eb' | 'E' | 'F'
    | 'Gb' | 'G' | 'Ab' | 'A' | 'Bb' | 'B';

export const MG_KEY_OPTIONS: ReadonlyArray<MgKey> = [
    'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B',
];

let _key: MgKey = 'C';

export const MgKeyStore = {
    getKey(): MgKey {
        return _key;
    },
    setKey(key: MgKey): void {
        _key = key;
    },
};
