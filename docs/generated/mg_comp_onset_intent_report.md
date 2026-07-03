# Comp Onset-Form Intent Audit(Phase 4)

意图 comp onset-form vs 实际 single/block ratio。enforced(ACG rollHeavy)须满足,observe 只报告。

## 0/acg
| section | intended form | actual single/block | ok |
|---|---|---|---|
| intro | rollHeavy(E) | 1.00/0.00 (n8) | ✓ |
| verse | rollHeavy(E) | 1.00/0.00 (n25) | ✓ |
| chorus | rollHeavy(E) | 1.00/0.00 (n34) | ✓ |
| verse | rollHeavy(E) | 1.00/0.00 (n25) | ✓ |
| chorus | rollHeavy(E) | 1.00/0.00 (n35) | ✓ |
| outro | rollHeavy(E) | 1.00/0.00 (n22) | ✓ |

## 42/acg
| section | intended form | actual single/block | ok |
|---|---|---|---|
| intro | rollHeavy(E) | 1.00/0.00 (n5) | ✓ |
| verse | rollHeavy(E) | 1.00/0.00 (n25) | ✓ |
| chorus | rollHeavy(E) | 1.00/0.00 (n29) | ✓ |
| verse | rollHeavy(E) | 1.00/0.00 (n26) | ✓ |
| chorus | rollHeavy(E) | 1.00/0.00 (n29) | ✓ |
| bridge | rollHeavy(E) | 1.00/0.00 (n40) | ✓ |
| chorus | rollHeavy(E) | 1.00/0.00 (n30) | ✓ |
| outro | rollHeavy(E) | 1.00/0.00 (n11) | ✓ |

## 7/pop
| section | intended form | actual single/block | ok |
|---|---|---|---|
| verse | singleLine | 0.53/0.47 (n120) | — |
| chorus | singleLine | 1.00/0.00 (n101) | — |
| chorus | singleLine | 1.00/0.00 (n101) | — |
| outro | singleLine | 0.00/0.00 (n0) | — |

## 42/rnb
| section | intended form | actual single/block | ok |
|---|---|---|---|
| intro | rollHeavy(E) | 0.60/0.40 (n10) | ✓ |
| verse | rollHeavy(E) | 0.03/0.97 (n36) | ✗ |
| verse | rollHeavy(E) | 0.03/0.97 (n36) | ✗ |
| chorus | rollHeavy(E) | 0.92/0.08 (n74) | ✓ |
| chorus | rollHeavy(E) | 0.93/0.07 (n75) | ✓ |
| outro | rollHeavy(E) | 0.00/0.00 (n0) | ✓ |

## 99/lofi
| section | intended form | actual single/block | ok |
|---|---|---|---|
| intro | singleLine | 0.00/1.00 (n4) | — |
| verse | singleLine | 0.00/1.00 (n16) | — |
| verse | singleLine | 0.00/1.00 (n16) | — |
| outro | singleLine | 0.00/0.00 (n0) | — |

## 3/jazz
| section | intended form | actual single/block | ok |
|---|---|---|---|
| intro | mixed | 0.00/1.00 (n16) | — |
| verse | mixed | 0.00/1.00 (n48) | — |
| verse | mixed | 0.00/1.00 (n48) | — |
| bridge | mixed | 0.00/1.00 (n48) | — |
| chorus | mixed | 0.00/1.00 (n48) | — |
| outro | mixed | 0.00/1.00 (n16) | — |

## 汇总:enforced(ACG rollHeavy)slot 18/20 满足 single≥0.6。observe slot 只报告不判。