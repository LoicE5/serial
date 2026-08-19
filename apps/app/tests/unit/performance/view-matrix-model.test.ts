import { describe, expect, it } from "vitest";
import {
  evaluateViewMatrixGate,
  VIEW_MATRIX_BUDGETS,
} from "../../../scripts/performance/view-matrix-model";

function passingMeasurement() {
  return {
    latency: {
      perPageMedianRatio: 1,
      perPageP95Ratio: 1,
      fullMatrixMedianRatio: 1,
      fullMatrixP95Ratio: 1,
    },
    client: {
      maximumApplyTaskMs: 10,
      startupHeapGrowthBytes: 10 * 1_024 * 1_024,
      persistedStateBytes: 10 * 1_024 * 1_024,
    },
  };
}

describe("View matrix benchmark gate", () => {
  it("accepts measurements within every required budget", () => {
    expect(evaluateViewMatrixGate(passingMeasurement())).toEqual([]);
  });

  it("reports every latency, task, heap, and persistence violation", () => {
    expect(
      evaluateViewMatrixGate({
        latency: {
          perPageMedianRatio: VIEW_MATRIX_BUDGETS.latencyRatio + 0.01,
          perPageP95Ratio: VIEW_MATRIX_BUDGETS.latencyRatio + 0.01,
          fullMatrixMedianRatio: VIEW_MATRIX_BUDGETS.latencyRatio + 0.01,
          fullMatrixP95Ratio: VIEW_MATRIX_BUDGETS.latencyRatio + 0.01,
        },
        client: {
          maximumApplyTaskMs: VIEW_MATRIX_BUDGETS.clientApplyTaskMs + 0.01,
          startupHeapGrowthBytes:
            VIEW_MATRIX_BUDGETS.startupHeapGrowthBytes + 1,
          persistedStateBytes: VIEW_MATRIX_BUDGETS.persistedStateBytes + 1,
        },
      }),
    ).toHaveLength(7);
  });
});
