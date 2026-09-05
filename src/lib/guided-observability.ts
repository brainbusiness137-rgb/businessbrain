type GuidedOperationMetrics = {
  operation: string;
  documentGets?: number;
  queries?: number;
  documentsReturned?: number;
  writesAtLeast?: number;
  conditionalWrites?: string;
  evidenceLoads?: number;
};

export function traceGuidedOperation(metrics: GuidedOperationMetrics) {
  if (process.env.NODE_ENV !== "production") {
    console.info("Guided operation trace", metrics);
  }
}
