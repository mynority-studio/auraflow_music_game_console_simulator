// lstm-cell.ts — imp/lstm/architecture/LSTM.java 的忠实移植。
//   step(x):  xh = concat(x, h_prev)
//             forget/input/out = sigmoid(W·xh + b),  activate = tanh(W·xh + b)
//             cell = forget*cell_prev + input*activate
//             h    = out * tanh(cell)
//   门权重 W 形状 hidden×(input+hidden);initialstate[2H] = [cell(H), hidden(H)]。

import type { LoadedModel, Tensor } from './q8';

function sigmoid(x: number): number { return 1 / (1 + Math.exp(-x)); }

/** W(rows×cols, row-major) · x(cols) + b(rows) → out(rows),门激活 act 逐元素施加 */
function affine(W: Tensor, b: Tensor, x: Float64Array, act: (v: number) => number, out: Float64Array): void {
    const { data, rows, cols } = W;
    const bias = b.data;
    for (let r = 0; r < rows; r++) {
        let s = bias[r]!;
        const base = r * cols;
        for (let c = 0; c < cols; c++) s += data[base + c]! * x[c]!;
        out[r] = act(s);
    }
}

export class LstmCell {
    private readonly Wf: Tensor; private readonly bf: Tensor;
    private readonly Wi: Tensor; private readonly bi: Tensor;
    private readonly Wo: Tensor; private readonly bo: Tensor;
    private readonly Wa: Tensor; private readonly ba: Tensor;
    private readonly hidden: number;
    private readonly inputLen: number;
    private readonly cell0: Float64Array;
    private readonly h0: Float64Array;

    cell: Float64Array;
    result: Float64Array; // = hidden output h

    // 复用缓冲,避免每步分配
    private readonly xh: Float64Array;
    private readonly fg: Float64Array;
    private readonly ig: Float64Array;
    private readonly og: Float64Array;
    private readonly ag: Float64Array;

    constructor(model: LoadedModel, prefix: string /* 如 'param_0_lstm1' */) {
        this.Wf = model.get(`${prefix}_forget_w`); this.bf = model.get(`${prefix}_forget_b`);
        this.Wi = model.get(`${prefix}_input_w`); this.bi = model.get(`${prefix}_input_b`);
        this.Wo = model.get(`${prefix}_out_w`); this.bo = model.get(`${prefix}_out_b`);
        this.Wa = model.get(`${prefix}_activate_w`); this.ba = model.get(`${prefix}_activate_b`);
        this.hidden = this.Wf.rows;
        this.inputLen = this.Wf.cols - this.hidden;

        const init = model.get(`${prefix}_initialstate`).data; // 长 2H = [cell(H), hidden(H)]
        this.cell0 = init.slice(0, this.hidden);
        this.h0 = init.slice(this.hidden, this.hidden * 2);

        this.cell = this.cell0.slice();
        this.result = this.h0.slice();
        this.xh = new Float64Array(this.Wf.cols);
        this.fg = new Float64Array(this.hidden);
        this.ig = new Float64Array(this.hidden);
        this.og = new Float64Array(this.hidden);
        this.ag = new Float64Array(this.hidden);
    }

    /** 复位到训练好的初始状态(每次重新生成一段旋律前调用) */
    reset(): void {
        this.cell.set(this.cell0);
        this.result.set(this.h0);
    }

    /** 喂入 input(长 inputLen),返回 hidden 输出 result(长 hidden);内部更新 cell/result */
    step(x: Float64Array): Float64Array {
        const H = this.hidden;
        // xh = concat(x, h_prev)
        this.xh.set(x, 0);
        this.xh.set(this.result, this.inputLen);
        const xh = this.xh;

        affine(this.Wf, this.bf, xh, sigmoid, this.fg);
        affine(this.Wi, this.bi, xh, sigmoid, this.ig);
        affine(this.Wo, this.bo, xh, sigmoid, this.og);
        affine(this.Wa, this.ba, xh, Math.tanh, this.ag);

        const cell = this.cell;
        const res = this.result; // 原地写回 result
        for (let k = 0; k < H; k++) {
            const c = this.fg[k]! * cell[k]! + this.ig[k]! * this.ag[k]!;
            cell[k] = c;
            res[k] = this.og[k]! * Math.tanh(c);
        }
        return res;
    }
}

/** 一个 expert = 2 层 LSTM + Dense 输出层 */
export class Expert {
    private readonly lstm1: LstmCell;
    private readonly lstm2: LstmCell;
    private readonly Wfull: Tensor;
    private readonly bfull: Tensor;
    private readonly out: Float64Array;

    constructor(model: LoadedModel, paramPrefix: string /* 'param_0' */) {
        this.lstm1 = new LstmCell(model, `${paramPrefix}_lstm1`);
        this.lstm2 = new LstmCell(model, `${paramPrefix}_lstm2`);
        this.Wfull = model.get(`${paramPrefix}_full_w`);
        this.bfull = model.get(`${paramPrefix}_full_b`);
        this.out = new Float64Array(this.Wfull.rows);
    }

    reset(): void { this.lstm1.reset(); this.lstm2.reset(); }

    /** input → activations(Dense 原始 logits,长 output)。注意:不在此 softmax。 */
    process(input: Float64Array): Float64Array {
        const h1 = this.lstm1.step(input);
        const h2 = this.lstm2.step(h1);
        const { data, rows, cols } = this.Wfull;
        const bias = this.bfull.data;
        for (let r = 0; r < rows; r++) {
            let s = bias[r]!;
            const base = r * cols;
            for (let c = 0; c < cols; c++) s += data[base + c]! * h2[c]!;
            this.out[r] = s;
        }
        return this.out;
    }
}
