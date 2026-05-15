# Cost Optimization for Vinamilk-scale Production

**Project:** ProvenLedgerVN — FMCG Provenance & Anti-Counterfeit Ledger
**Contract:** `contracts/ProvenLedgerVN.sol` (Solidity 0.8.24, optimizer 200 runs)
**Script:** `scripts/benchmark.js`
**Date:** 2026-05-16
**Network:** Hardhat in-process EVM (Polygon-equivalent execution semantics)

This report addresses the lecturer's feedback on *blockchain economics and fees at scale* and the
assignment requirement for a *scaling-simulation cost table*. It empirically validates that a
batch-level on-chain data model keeps the operating cost of authenticating Vinamilk's daily
output well within commercial viability on Polygon.

## 1. Pricing assumptions

| Parameter | Value | Note |
|---|---|---|
| Polygon gas price | 30 gwei | Conservative steady-state value on Polygon mainnet. |
| MATIC / POL price | USD 0.40 | Conservative reference price. |
| Vinamilk daily output | 1,500,000 units / day | Conservative midpoint for premium dairy lines. |

All USD costs scale linearly with these inputs; the script accepts `GAS_PRICE_GWEI` and
`MATIC_USD` env vars for sensitivity analysis.

## 2. Raw measurements

### 2.1 One-time deployment

| Operation | Gas used | Polygon cost |
|---|---:|---:|
| Deploy `ProvenLedgerVN` | 1,586,823 | $0.0190 |

Deployment is a one-time cost amortised over the entire production lifetime of the contract.

### 2.2 `registerBatch` — gas is O(1) in `unitCount`

| Units in batch | Gas used | USD / batch | USD / unit |
|---:|---:|---:|---:|
| 100 | 121,971 | $0.001464 | $0.0000146 |
| 1,000 | 121,983 | $0.001464 | $0.0000015 |
| 10,000 | 121,983 | $0.001464 | $0.00000015 |

**Gas variance across the full 100 → 10,000 range: 0.010 %.** The 12-gas delta between the 100-
and 1,000-unit cases comes from one additional non-zero calldata byte in the `uint32` ABI
encoding — it is not storage growth. From 1,000 to 10,000 units the gas is *identical*.

This is the load-bearing result of the entire architectural argument: **a batch of 10,000
bottles costs the same to register on-chain as a batch of 100.**

### 2.3 `recordScan` — per-unit storage is lazy-allocated

| Scenario | Gas used | USD / scan |
|---|---:|---:|
| First scan of a unit (cold SSTORE — new storage slot) | 72,792 | $0.000874 |
| Subsequent scan of the same unit (warm SSTORE) | 38,345 | $0.000460 |

Storage for unit-level scan counters is allocated **only when a consumer actually scans that
unit**, not at registration time. A batch of 10,000 units whose consumers scan only 6,000 of
them pays storage gas for 6,000 slots, not 10,000.

## 3. Vinamilk-scale extrapolation

Annual on-chain cost for registering 1.5 million units / day (547.5 M units / year), as a
function of batch-size policy:

| Batch size | Batches / day | Cost / day | Cost / year |
|---:|---:|---:|---:|
| 100 | 15,000 | $21.95 | $8,013 |
| 1,000 | 1,500 | $2.20 | $801 |
| **10,000** | **150** | **$0.22** | **$80** |

At a 10,000-unit batch size, the *entire annual blockchain registration cost for Vinamilk's
premium dairy output is roughly USD 80* — well under one minute of a junior engineer's salary.
Even at the conservative 100-unit batch policy, the annual cost ($8,013) is two orders of
magnitude smaller than the equivalent counterfeiting loss for a single brand-damaging incident.

Scan costs are paid per consumer interaction, not per produced unit. At $0.0009 per cold scan,
1 million consumer scans per day costs approximately $874 / day. In production this cost is
typically absorbed by a relayer wallet operated by the dApp backend, or sponsored by the
manufacturer as a marketing line item.

## 4. Why this works — architectural mechanics

The cost profile above is not an accident of optimization; it falls directly out of three
intentional design choices in `ProvenLedgerVN.sol`:

1. **`Batch` is one struct, not a `Unit[unitCount]` array.** `registerBatch` performs a
   constant number of SSTOREs (≈ 5 storage slots: packed batch struct + two string blobs +
   existence flag) regardless of `unitCount`. There is no loop over units. The `unitCount`
   field is metadata only — it is consulted at scan time to range-check `unitIndex`, but it
   does not drive any allocation.

2. **`mapping(bytes32 => mapping(uint32 => UnitScan))` instead of an array of fixed-size
   per-unit records.** Solidity mappings allocate storage lazily: a unit's scan slot only
   materialises on its first `recordScan` call. The factory never pays for storage of unscanned
   units. This is the difference between "10,000 SSTOREs at registration" and "n SSTOREs at
   scan time, where n is the number of units actually scanned in the wild."

3. **Anti-counterfeit detection is split between on-chain ledger and off-chain analytics.**
   The contract records four primitives per unit: `count`, `firstScanAt`, `lastScanAt`,
   `lastLocationHash`. Anomaly detection (count exceeding plausible thresholds, locationHash
   jumping inconsistent distances) runs off-chain against the `UnitScanned` event stream.
   On-chain cost stays at one SSTORE update per scan; analytical logic can be arbitrarily
   sophisticated without any gas implication.

## 5. Conclusion

The benchmark empirically validates the scaling argument made in our response to the
lecturer's proposal feedback. Three concrete claims now have measured backing:

- Batch-level registration cost is constant in unit count (gas variance < 0.01 %).
- Per-unit storage is paid only when a unit is actually scanned, not at registration.
- Annual Polygon cost for Vinamilk-scale registration is in the order of **USD 80–8,000**
  depending on batch-size policy — economically negligible relative to counterfeiting losses.

The 10,000-unit batch policy is recommended as the default for the final deployment.

## Appendix A — How to reproduce

```bash
npm install
npx hardhat compile
npx hardhat run scripts/benchmark.js
```

Override pricing assumptions via env vars:

```bash
GAS_PRICE_GWEI=50 MATIC_USD=0.60 npx hardhat run scripts/benchmark.js
```

## Appendix B — Raw JSON summary

```json
{
  "network": "hardhat",
  "assumptions": {
    "gasPriceGwei": 30,
    "maticUsd": 0.4,
    "vinamilkDailyUnits": 1500000
  },
  "deployment": {
    "gasUsed": "1586823",
    "costUsd": 0.019041876
  },
  "registerBatch": [
    { "unitCount": 100,    "gasUsed": "121971", "costUsdPerBatch": 0.001463652, "costUsdPerUnit": 0.0000146365 },
    { "unitCount": 1000,   "gasUsed": "121983", "costUsdPerBatch": 0.001463796, "costUsdPerUnit": 0.0000014638 },
    { "unitCount": 10000,  "gasUsed": "121983", "costUsdPerBatch": 0.001463796, "costUsdPerUnit": 0.0000001464 }
  ],
  "recordScan": {
    "cold": { "gasUsed": "72792", "costUsd": 0.000873504 },
    "warm": { "gasUsed": "38345", "costUsd": 0.000460140 }
  },
  "gasVariancePctRegisterBatch": 0.009838404210837003
}
```
