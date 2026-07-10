#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
IN_DIR = ROOT / "docs/generated/ep_vibes_spectral_audit"
OUT_JSON = IN_DIR / "spectral_metrics.json"
OUT_MD = IN_DIR / "README.md"
SR = 24000


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        if w.getframerate() != SR or w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise ValueError(f"unexpected wav format: {path}")
        pcm = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
    return pcm.astype(np.float64) / 32768.0


def db(v: float) -> float:
    return 10.0 * math.log10(max(v, 1e-24))


def band_power(freq: np.ndarray, power: np.ndarray, lo: float, hi: float) -> float:
    mask = (freq >= lo) & (freq < hi)
    return float(power[mask].sum())


def top_peaks(freq: np.ndarray, power_db: np.ndarray, lo: float, hi: float, n: int = 8) -> list[dict[str, float]]:
    mask = np.where((freq >= lo) & (freq <= hi))[0]
    out: list[tuple[float, float]] = []
    for idx in mask[1:-1]:
        if power_db[idx] > power_db[idx - 1] and power_db[idx] >= power_db[idx + 1]:
            out.append((float(power_db[idx]), float(freq[idx])))
    out.sort(reverse=True)
    return [{"freqHz": round(f, 1), "db": round(p, 2)} for p, f in out[:n]]


def analyze(path: Path) -> dict[str, object]:
    x = read_wav(path)
    lo = int(0.05 * SR)
    hi = min(len(x), int(0.75 * SR))
    seg = x[lo:hi]
    if seg.size < 4096:
        raise ValueError(f"too short: {path}")
    n = 8192
    if seg.size < n:
        pad = np.zeros(n)
        pad[:seg.size] = seg
        seg = pad
    else:
        seg = seg[:n]
    win = np.hanning(seg.size)
    spec = np.fft.rfft(seg * win)
    power = (spec.real * spec.real + spec.imag * spec.imag) / max(1.0, win.sum() ** 2)
    freq = np.fft.rfftfreq(seg.size, 1.0 / SR)
    total = float(power[(freq >= 40) & (freq <= 11800)].sum())
    high_5_10 = band_power(freq, power, 5000, 10000)
    air_8_11 = band_power(freq, power, 8000, 11000)
    presence_3_5 = band_power(freq, power, 3000, 5000)
    body_0_3 = band_power(freq, power, 120, 3000)
    high_mask = (freq >= 5000) & (freq <= 11000)
    high_db = 10.0 * np.log10(np.maximum(power[high_mask], 1e-24))
    peak_prom = float(high_db.max() - np.median(high_db)) if high_db.size else 0.0
    centroid = float((freq * power).sum() / max(power.sum(), 1e-24))
    return {
        "name": path.stem,
        "rmsDbfs": round(db(float(np.mean(seg * seg))), 2),
        "spectralCentroidHz": round(centroid, 1),
        "body120_3000DbOfTotal": round(db(body_0_3 / total), 2),
        "presence3000_5000DbOfTotal": round(db(presence_3_5 / total), 2),
        "high5000_10000DbOfTotal": round(db(high_5_10 / total), 2),
        "air8000_11000DbOfTotal": round(db(air_8_11 / total), 2),
        "highPeakProminenceDb": round(peak_prom, 2),
        "topHighPeaks": top_peaks(freq, 10.0 * np.log10(np.maximum(power, 1e-24)), 5000, 11000),
    }


def main() -> None:
    paths = sorted(IN_DIR.glob("*.wav"))
    metrics = [analyze(path) for path in paths]
    OUT_JSON.write_text(json.dumps(metrics, indent=2, ensure_ascii=False) + "\n")
    lines = [
        "# EP / Vibes Copych Spectral Audit",
        "",
        "| sample | RMS dBFS | centroid Hz | 5-10k / total | 8-11k / total | high peak prominence | top high peak |",
        "|---|---:|---:|---:|---:|---:|---|",
    ]
    for m in metrics:
        peak = m["topHighPeaks"][0] if m["topHighPeaks"] else {"freqHz": "-", "db": "-"}
        lines.append(
            f"| {m['name']} | {m['rmsDbfs']} | {m['spectralCentroidHz']} | "
            f"{m['high5000_10000DbOfTotal']} | {m['air8000_11000DbOfTotal']} | "
            f"{m['highPeakProminenceDb']} | {peak['freqHz']} Hz / {peak['db']} dB |"
        )
    OUT_MD.write_text("\n".join(lines) + "\n")
    print(json.dumps(metrics, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
