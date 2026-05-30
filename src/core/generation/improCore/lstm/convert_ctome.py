#!/usr/bin/env python3
"""
convert_ctome.py — 把 Impro-Visor 的 .ctome(ZIP of CSV float64 权重)转成
紧凑的 int8 量化模型(.bin + manifest.json),供浏览器 TF.js/自写推理加载。

可行性验证:25MB CSV ensemble → 单模型 int8 ~1MB,推理精度近无损。
量化:per-tensor 对称 int8(scale = max|w| / 127)。

用法: python3 convert_ctome.py <input.ctome> <out_dir> [--ensemble]
  默认只导 param_0 单模型;--ensemble 导全部 param_N。
"""
import sys, os, io, json, zipfile, struct

def read_csv_floats(data: bytes):
    """CSV 文本 → (flat float list, rows, cols)"""
    text = data.decode('ascii')
    rows = [ln for ln in text.replace('\r', '').split('\n') if ln.strip()]
    mat = [[float(x) for x in ln.split(',') if x != ''] for ln in rows]
    flat = [v for r in mat for v in r]
    return flat, len(mat), (len(mat[0]) if mat else 0)

def quantize_int8(flat):
    """per-tensor 对称量化 → (bytes, scale)"""
    maxabs = max((abs(v) for v in flat), default=0.0) or 1e-8
    scale = maxabs / 127.0
    inv = 1.0 / scale
    out = bytearray(len(flat))
    for i, v in enumerate(flat):
        q = int(round(v * inv))
        out[i] = (max(-127, min(127, q))) & 0xFF  # int8 → 无符号字节存
    return bytes(out), scale

def main():
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    ctome, out_dir = sys.argv[1], sys.argv[2]
    ensemble = '--ensemble' in sys.argv
    os.makedirs(out_dir, exist_ok=True)

    zf = zipfile.ZipFile(ctome)
    names = [n for n in zf.namelist() if n.endswith('.csv')]
    if not ensemble:
        names = [n for n in names if n.startswith('param_0_')]

    manifest = {'tensors': {}, 'arch': {}}
    blob = io.BytesIO()
    csv_bytes = 0
    for n in sorted(names):
        raw = zf.read(n)
        csv_bytes += len(raw)
        flat, rows, cols = read_csv_floats(raw)
        qbytes, scale = quantize_int8(flat)
        key = n[:-4]  # 去 .csv
        manifest['tensors'][key] = {
            'shape': [rows, cols], 'scale': scale,
            'offset': blob.tell(), 'count': len(flat),
        }
        blob.write(qbytes)

    # 记录架构(从 lstm1/lstm2/full 的形状推)
    t = manifest['tensors']
    def shp(k): return t[k]['shape'] if k in t else None
    if 'param_0_lstm1_input_w' in t:
        h1 = shp('param_0_lstm1_input_w')[0]
        in_dim = shp('param_0_lstm1_input_w')[1] - h1
        h2 = shp('param_0_lstm2_input_w')[0]
        out_dim = shp('param_0_full_w')[0]
        manifest['arch'] = {'input': in_dim, 'hidden1': h1, 'hidden2': h2, 'output': out_dim,
                            'ensemble': len({n.split('_')[1] for n in names})}

    bin_path = os.path.join(out_dir, 'model.q8.bin')
    with open(bin_path, 'wb') as f:
        f.write(blob.getvalue())
    with open(os.path.join(out_dir, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=2)

    int8_bytes = len(blob.getvalue())
    print(f"架构: {manifest['arch']}")
    print(f"张量数: {len(manifest['tensors'])}")
    print(f"CSV 原始(本次导出部分): {csv_bytes/1048576:.1f} MB")
    print(f"int8 量化后:            {int8_bytes/1048576:.2f} MB  ({csv_bytes/max(1,int8_bytes):.0f}× 缩小)")
    print(f"→ {bin_path}")

if __name__ == '__main__':
    main()
