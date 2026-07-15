import { shouldPersistApplyResult } from "../lib/upboSupabase";

function assertEqual(actual: boolean, expected: boolean, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

assertEqual(
  shouldPersistApplyResult({
    totalResults: 213,
    recordCount: 0,
    effectiveRecordCount: 0,
    ignoreCount: 207,
    duplicateCount: 6,
    needsReviewCount: 0,
    modifierCount: 0,
    multiplierAppliedCount: 0,
  }),
  false,
  "duplicate/ignore-only apply should be treated as no-op",
);

assertEqual(
  shouldPersistApplyResult({
    totalResults: 10,
    recordCount: 1,
    effectiveRecordCount: 1,
    ignoreCount: 9,
    duplicateCount: 0,
    needsReviewCount: 0,
    modifierCount: 0,
    multiplierAppliedCount: 0,
  }),
  true,
  "new records must still be persisted",
);

assertEqual(
  shouldPersistApplyResult({
    totalResults: 10,
    recordCount: 0,
    effectiveRecordCount: 0,
    ignoreCount: 9,
    duplicateCount: 0,
    needsReviewCount: 1,
    modifierCount: 0,
    multiplierAppliedCount: 0,
  }),
  true,
  "needs_review rows must still be persisted for verification",
);

assertEqual(
  shouldPersistApplyResult({
    totalResults: 10,
    recordCount: 0,
    effectiveRecordCount: 0,
    ignoreCount: 10,
    duplicateCount: 0,
    needsReviewCount: 0,
    modifierCount: 1,
    multiplierAppliedCount: 0,
  }),
  true,
  "modifier grants must still be persisted because they change future state",
);

assertEqual(
  shouldPersistApplyResult({
    totalResults: 10,
    recordCount: 0,
    effectiveRecordCount: 0,
    ignoreCount: 10,
    duplicateCount: 0,
    needsReviewCount: 0,
    modifierCount: 0,
    multiplierAppliedCount: 1,
  }),
  true,
  "multiplier applications must still be persisted for auditability",
);
