# Subscription Logging Contract - Bounds and Limits Documentation

## Overview

The Subscription Logging contract enforces strict bounds and limits to prevent Denial-of-Service (DoS) attacks and unbounded resource consumption. This document specifies all hard limits and the rationale behind them.

## Range Query Limits (`get_commitments_range`)

### Maximum Range Size: 100 commitments

**Limit:** A single query can retrieve a maximum of 100 commitments.

**Calculation:** 
- Range is inclusive on both ends: `[start_index, end_index]`
- Range size = `end_index - start_index + 1`
- Constraint: `range_size <= 100`

**Off-by-One Protection:**
- Lower bound: Single commitment queries use `[i, i]` → size = 1 ✓
- Upper bound: 100-commitment query uses `[0, 99]` → size = 100 ✓
- Boundary violation: 101-commitment query `[0, 100]` → size = 101 → Panics ✓

**Validation Order:**
1. Check `start_index <= end_index` (prevents reversed ranges)
2. Calculate `range_size = end_index - start_index + 1`
3. Verify `range_size <= 100`
4. Verify `end_index < commitment_count` (prevents out-of-bounds)

**Example Queries:**

| Query | start | end | size | Valid? |
|-------|-------|-----|------|--------|
| Single | 5 | 5 | 1 | ✓ |
| Range | 0 | 99 | 100 | ✓ |
| Boundary | 0 | 100 | 101 | ✗ Panic |
| Reversed | 100 | 50 | - | ✗ Panic |
| Out-of-bounds | 0 | 999 | - | ✗ Panic |

**Performance:** With Soroban's 10M instruction limit and ~1000 instructions per commitment retrieval, 100 commitments requires ~100k instructions. Safety margin is 2 orders of magnitude.

## Per-Subscription Log Limits (`record_log`)

### Maximum Log Entries Per Subscription: 1000 entries

**Limit:** Each subscription can accumulate a maximum of 1000 log entries in the legacy plaintext logging system.

**Constraint:**
```rust
if logs.len() >= 1000 {
    panic!("Log capacity exceeded for subscription");
}
```

**Rationale:**
- Prevents unbounded growth of storage for a single subscription
- Legacy logging is deprecated; new events should use commitments
- Storage cost: ~1KB per log entry × 1000 = ~1MB per subscription
- On-chain storage fees would discourage abuse

**Migration Strategy:**
- Subscriptions reaching the cap should migrate to commitment-based logging
- Clients can call `record_commitment` instead of `record_log`
- Commitments have no per-subscription cap (global counter only)

## Merkle Root Anchor Bounds (`anchor_merkle_root`)

### Range Validation

**Constraints:**
1. `start_index <= end_index` (range must be ascending)
2. `end_index < commitment_count` (range must contain only existing commitments)
3. No explicit upper bound on range size for Merkle roots

**Rationale:**
- Merkle roots batch existing commitments, don't create new ones
- Upper bound should be enforced at batching layer, not contract
- Protocol should ensure batches don't exceed ~1000 commitments for privacy

**Example:**
- If 100 commitments exist (indices 0-99):
  - Valid: `anchor_merkle_root(root, 0, 99)` ✓
  - Valid: `anchor_merkle_root(root, 50, 75)` ✓
  - Invalid: `anchor_merkle_root(root, 0, 100)` ✗ Panic (exceeds commitment count)
  - Invalid: `anchor_merkle_root(root, 100, 50)` ✗ Panic (reversed range)

## Commitment Storage Limits

### Global Commitment Counter

**Limit:** Technically unbounded by contract logic; limited by Soroban storage fees.

**Practical Limits:**
- Ledger size: ~10GB (Stellar network limit)
- Entry storage cost: ~1 stroops (~$0.00001) per entry per 100,000 ledgers (~7 days)
- Per-subscription cap (via `record_log`): 1000 entries
- Range query cap: 100 at a time (prevents single-call DoS)

**Scaling:** To handle 1M commitments:
- Storage: ~1000 × 1000 commitment entries = ~1MB (negligible)
- Query: 1M / 100 = 10,000 queries maximum (manageable)

## Test Coverage

See `src/test.rs` for comprehensive bounds testing:

### Off-by-One Tests
- ✓ `test_get_commitments_range_off_by_one_lower` - Single commitment at boundary
- ✓ `test_get_commitments_range_off_by_one_upper` - Range ending at last valid index
- ✓ `test_get_commitments_range_exceeds_count` - Attempting out-of-bounds index
- ✓ `test_get_commitments_range_invalid_order` - Reversed range (start > end)

### Range Boundary Tests
- ✓ `test_get_commitments_range_max_exactly_100` - Query at max limit (100)
- ✓ `test_get_commitments_range_exceeds_max_101` - Query just over limit (101)
- ✓ `test_anchor_merkle_root_invalid_range` - Merkle root with reversed range
- ✓ `test_anchor_merkle_root_exceeds_count` - Merkle root index out-of-bounds
- ✓ `test_anchor_merkle_root_valid_range` - Valid Merkle root anchor

### Per-Subscription Cap Tests
- ✓ `test_record_log_within_cap` - 999 entries (valid)
- ✓ `test_record_log_exceeds_cap` - 1001st entry attempt (panics)
- ✓ `test_record_log_independent_subscription_caps` - Caps are per-subscription

## Migration Path

1. **Current Users:** Migrate from `record_log` to `record_commitment` when approaching 900 entries
2. **New Users:** Use commitment-based logging exclusively
3. **Batch Operations:** Group commitments and anchor Merkle roots in batches of ~500-1000

## Security Considerations

### DoS Prevention
- **Per-query DoS:** 100-entry limit prevents queries from monopolizing gas
- **Per-subscription DoS:** 1000-entry cap prevents single subscription from consuming all storage
- **Concurrent DoS:** Commitment count is global; adversary needs many subscriptions to exhaust storage

### Privacy
- Bounds checking doesn't leak subscription data
- Range queries are anonymous (no subscription identifiers in query)
- Commitment batching hides individual event timing

### Gas Efficiency
- 100-commitment range: ~100k instructions (well under Soroban limit)
- Merkle root anchor: ~50k instructions (no limit on range size)
- Per-subscription log cap prevents exponential growth

## Monitoring

Recommended metrics to track:
1. **Commitment count growth:** Alert if approaching 10M (arbitrary safe limit)
2. **Range query sizes:** Monitor for attempted attacks (multiple 100-entry queries)
3. **Per-subscription log sizes:** Alert if any subscription approaches 900 entries
4. **Merkle batch sizes:** Ensure batches stay within ~1000 commitments
