// q8.ts — 加载 convert_ctome.py 产出的 int8 量化模型(manifest.json + model.q8.bin)。
//   per-tensor 对称量化:float ≈ int8 × scale。本模块只做纯数据加载/反量化,
//   不依赖浏览器或 Node —— 调用方传入已读好的 manifest 对象 + 字节流。

export interface TensorMeta {
    shape: [number, number];
    scale: number;
    offset: number;
    count: number;
}

export interface ModelManifest {
    tensors: Record<string, TensorMeta>;
    arch: { input: number; hidden1: number; hidden2: number; output: number; ensemble: number };
}

/** 一个反量化后的张量:扁平 float64(row-major)+ 形状 */
export interface Tensor {
    data: Float64Array;
    rows: number;
    cols: number;
}

export interface LoadedModel {
    arch: ModelManifest['arch'];
    /** 按名取张量,如 'param_0_lstm1_input_w' */
    get(name: string): Tensor;
    has(name: string): boolean;
}

/**
 * 把 int8 blob + manifest 反量化成命名张量表。
 * @param manifest 解析好的 manifest.json
 * @param blob     model.q8.bin 的字节(int8 以无符号字节存:b>127 → b-256)
 */
export function loadModel(manifest: ModelManifest, blob: Uint8Array): LoadedModel {
    const cache = new Map<string, Tensor>();

    function build(name: string): Tensor {
        const m = manifest.tensors[name];
        if (!m) throw new Error(`LSTM: tensor 缺失 ${name}`);
        const data = new Float64Array(m.count);
        const { offset, scale, count } = m;
        for (let i = 0; i < count; i++) {
            const b = blob[offset + i]!;
            const signed = b > 127 ? b - 256 : b;
            data[i] = signed * scale;
        }
        return { data, rows: m.shape[0], cols: m.shape[1] };
    }

    return {
        arch: manifest.arch,
        has: (name) => name in manifest.tensors,
        get(name) {
            let t = cache.get(name);
            if (!t) { t = build(name); cache.set(name, t); }
            return t;
        },
    };
}
