export const VIEW_MATRIX_BUDGETS = {
  latencyRatio: 1.5,
  clientApplyTaskMs: 50,
  startupHeapGrowthBytes: 32 * 1_024 * 1_024,
  persistedStateBytes: 32 * 1_024 * 1_024,
} as const;

export type ViewMatrixGateMeasurement = {
  latency: {
    perPageMedianRatio: number;
    perPageP95Ratio: number;
    fullMatrixMedianRatio: number;
    fullMatrixP95Ratio: number;
  };
  client: {
    maximumApplyTaskMs: number;
    startupHeapGrowthBytes: number;
    persistedStateBytes: number;
  };
};

export function evaluateViewMatrixGate(measurement: ViewMatrixGateMeasurement) {
  const violations: string[] = [];
  const maximum = (label: string, measured: number, budget: number) => {
    if (measured > budget) {
      violations.push(`${label}: ${measured} > ${budget}`);
    }
  };

  maximum(
    "per-page median latency ratio",
    measurement.latency.perPageMedianRatio,
    VIEW_MATRIX_BUDGETS.latencyRatio,
  );
  maximum(
    "per-page p95 latency ratio",
    measurement.latency.perPageP95Ratio,
    VIEW_MATRIX_BUDGETS.latencyRatio,
  );
  maximum(
    "full-matrix median latency ratio",
    measurement.latency.fullMatrixMedianRatio,
    VIEW_MATRIX_BUDGETS.latencyRatio,
  );
  maximum(
    "full-matrix p95 latency ratio",
    measurement.latency.fullMatrixP95Ratio,
    VIEW_MATRIX_BUDGETS.latencyRatio,
  );
  maximum(
    "maximum incremental client application task (ms)",
    measurement.client.maximumApplyTaskMs,
    VIEW_MATRIX_BUDGETS.clientApplyTaskMs,
  );
  maximum(
    "startup heap growth (bytes)",
    measurement.client.startupHeapGrowthBytes,
    VIEW_MATRIX_BUDGETS.startupHeapGrowthBytes,
  );
  maximum(
    "serialized persisted state (bytes)",
    measurement.client.persistedStateBytes,
    VIEW_MATRIX_BUDGETS.persistedStateBytes,
  );
  return violations;
}
