/**
 * Minimal, privacy-safe API metrics using CloudWatch Embedded Metric Format
 * (EMF). EMF is a plain JSON log line: CloudWatch Logs automatically extracts
 * it into real CloudWatch Metrics with no extra dependency, IAM permission,
 * or metrics SDK. Locally it is just another JSON line in the console.
 *
 * Covers exactly the metrics docs/architecture/api-conventions.md
 * "Observability" requires: API error count, API latency, and authorization
 * denials. Nothing else is aggregated here.
 */

const NAMESPACE = 'Todone/Api';

export interface ApiMetricFields {
  route: string;
  latencyMs: number;
  isError: boolean;
  isDenied: boolean;
}

export function emitApiMetrics(fields: ApiMetricFields): void {
  const document = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: NAMESPACE,
          Dimensions: [['Route']],
          Metrics: [
            { Name: 'Latency', Unit: 'Milliseconds' },
            { Name: 'ErrorCount', Unit: 'Count' },
            { Name: 'AuthorizationDenied', Unit: 'Count' },
          ],
        },
      ],
    },
    Route: fields.route,
    Latency: fields.latencyMs,
    ErrorCount: fields.isError ? 1 : 0,
    AuthorizationDenied: fields.isDenied ? 1 : 0,
  };
  console.log(JSON.stringify(document));
}

/** Aggregate policy observation deliberately excludes request identity and policy context. */
export function emitAuthorizationDecision(
  capability: import('../../shared/authorizationCapabilities').CapabilityKey,
  allowed: boolean,
): void {
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: NAMESPACE,
            Dimensions: [['Capability']],
            Metrics: [
              { Name: 'CapabilityAllowed', Unit: 'Count' },
              { Name: 'CapabilityDenied', Unit: 'Count' },
            ],
          },
        ],
      },
      Capability: capability,
      CapabilityAllowed: Number(allowed),
      CapabilityDenied: Number(!allowed),
    }),
  );
}
