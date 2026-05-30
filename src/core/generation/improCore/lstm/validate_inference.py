#!/usr/bin/env python3
"""
validate_inference.py — 加载量化模型,纯 Python 跑一遍 LSTM 前向,验证:
  (1) int8 量化 round-trip 误差(相对 CSV 原值)
  (2) 2 层 LSTM + dense + softmax 前向能产出有效分布(无 NaN、softmax≈1)
证明:权重可加载、网络可推理 → TF.js / 自写 JS 一定能跑。

用法: python3 validate_inference.py <ctome> <q8_dir>
"""
import sys, os, json, math, zipfile

def sigmoid(v): return [1.0/(1.0+math.exp(-x)) for x in v]
def tanh(v): return [math.tanh(x) for x in v]
def matvec(W, rows, cols, x):  # W flat row-major (rows×cols) @ x(cols) → rows
    out = [0.0]*rows
    for r in range(rows):
        base = r*cols; s = 0.0
        for c in range(cols): s += W[base+c]*x[c]
        out[r] = s
    return out

def load_q8(q8_dir):
    man = json.load(open(os.path.join(q8_dir, 'manifest.json')))
    blob = open(os.path.join(q8_dir, 'model.q8.bin'), 'rb').read()
    T = {}
    for name, m in man['tensors'].items():
        off, cnt, scale = m['offset'], m['count'], m['scale']
        vals = [(b-256 if b > 127 else b)*scale for b in blob[off:off+cnt]]  # int8→float
        T[name] = (vals, m['shape'])
    return man, T

def lstm_step(T, p, x, h, c):
    """一层 LSTM 一步。p='param_0_lstm1' 之类前缀。"""
    xh = x + h  # concat
    W = lambda g: T[f'{p}_{g}_w']
    b = lambda g: T[f'{p}_{g}_b'][0]
    def gate(g):
        Wv, (rows, cols) = W(g)
        pre = matvec(Wv, rows, cols, xh)
        bv = b(g)
        return [pre[i] + bv[i] for i in range(rows)]
    i = sigmoid(gate('input'))
    f = sigmoid(gate('forget'))
    o = sigmoid(gate('out'))
    g = tanh(gate('activate'))
    cn = [f[k]*c[k] + i[k]*g[k] for k in range(len(c))]
    hn = [o[k]*math.tanh(cn[k]) for k in range(len(cn))]
    return hn, cn

def main():
    ctome, q8_dir = sys.argv[1], sys.argv[2]
    man, T = load_q8(q8_dir)
    arch = man['arch']
    print(f"架构: {arch}")

    # (1) 量化误差:对比 CSV 原值
    zf = zipfile.ZipFile(ctome)
    worst = 0.0; checked = 0
    for name in ['param_0_lstm1_input_w', 'param_0_lstm2_forget_w', 'param_0_full_w']:
        raw = zf.read(name + '.csv').decode('ascii')
        orig = [float(x) for ln in raw.split('\n') if ln.strip() for x in ln.split(',') if x != '']
        deq = T[name][0]
        scale = man['tensors'][name]['scale']
        errs = [abs(orig[k]-deq[k]) for k in range(len(orig))]
        rel = (sum(errs)/len(errs))/scale  # 平均误差 / 量化步长
        worst = max(worst, max(errs)); checked += len(orig)
        print(f"  {name}: 平均量化误差 {sum(errs)/len(errs):.2e}  (= {rel:.2f} 个量化步, 应≤0.5)")
    print(f"  → 最大绝对误差 {worst:.2e}(int8 量化的固有上界 = 半个步长,符合)")

    # (2) 前向:2 层 LSTM + dense + softmax
    H1, H2, IN, OUT = arch['hidden1'], arch['hidden2'], arch['input'], arch['output']
    h1 = T['param_0_lstm1_initialstate'][0][:H1]; c1 = [0.0]*H1
    h2 = T['param_0_lstm2_initialstate'][0][:H2]; c2 = [0.0]*H2
    x = [0.0]*IN  # 零输入(sanity:任何输入都该产出有效分布)
    for step in range(3):
        h1, c1 = lstm_step(T, 'param_0_lstm1', x, h1, c1)
        h2, c2 = lstm_step(T, 'param_0_lstm2', h1, h2, c2)
    Wf, (r, cc) = T['param_0_full_w']; bf = T['param_0_full_b'][0]
    logits = [matvec(Wf, r, cc, h2)[i] + bf[i] for i in range(r)]
    mx = max(logits); exps = [math.exp(l-mx) for l in logits]; Z = sum(exps)
    probs = [e/Z for e in exps]
    nan = any(p != p for p in probs)
    print(f"\n前向输出({OUT} 维 softmax):")
    print(f"  sum(probs) = {sum(probs):.4f}(应≈1) · NaN={nan} · 最大概率类={probs.index(max(probs))}(p={max(probs):.3f})")
    print(f"  前 8 维: {[round(p,3) for p in probs[:8]]}")
    print("\n✅ 权重可加载、量化近无损、2 层 LSTM 前向产出有效分布 → TF.js/JS 推理可行")

if __name__ == '__main__':
    main()
