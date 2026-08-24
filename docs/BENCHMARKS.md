# CLI benchmark

`pnpm benchmark:check` is an offline deterministic request-accounting gate. Schema
`2.0.0-cli-request-accounting` reports planned Quality Preview opportunity separately from actual
current-invocation calls. The exact observed fetch total must equal:

```text
canonical metadata + canonical source + quality source + quality attribution
```

Allowance reads are reported separately because the fixture injects the preflight reader rather
than issuing an HTTP request. Source, attribution, and whole-result cache hits are also separate.
The gate covers Quality Preview enabled, disabled, and insufficient states plus cold,
snapshot-warm, canonical derived/source-cache-warm, whole-quality-result-cache, fully warm,
refresh, and no-cache executions. Stable quality findings, `resultKey`, and canonical battle bytes
must match across cold, warm, refresh, and no-cache executions with identical evidence and caps.

## v0.3.1 accounting reference

The repaired fixture produced these exact calls on 2026-08-24:

| Scenario                            | Canonical | Quality source | Quality attribution | Allowance | HTTP total |
| ----------------------------------- | --------: | -------------: | ------------------: | --------: | ---------: |
| Cold                                |        32 |             27 |                  15 |         0 |         74 |
| Quality disabled                    |        32 |              0 |                   0 |         0 |         32 |
| Quality insufficient                |        32 |              0 |                   0 |         1 |         32 |
| Snapshot warm                       |         6 |             27 |                  15 |         0 |         48 |
| Canonical derived/source cache warm |         0 |             27 |                  15 |         0 |         42 |
| Whole Quality result cache          |         6 |              0 |                   0 |         0 |          6 |
| Fully warm                          |         0 |              0 |                   0 |         0 |          0 |
| Refresh                             |        32 |             27 |                  15 |         0 |         74 |
| No cache                            |        32 |             27 |                  15 |         0 |         74 |

The same run on darwin-arm64 with Node 24.19.0 recorded these wall-clock values:

| Scenario                            |       p50 |       p95 |
| ----------------------------------- | --------: | --------: |
| Cold Quality-enabled battle         | 117.08 ms | 119.68 ms |
| Snapshot warm                       | 133.17 ms | 136.48 ms |
| Canonical derived/source cache warm | 123.48 ms | 125.43 ms |
| Whole Quality result cache          |  17.01 ms |  17.64 ms |
| Fully warm                          |   6.73 ms |   7.13 ms |
| Refresh                             | 141.52 ms | 145.50 ms |
| No cache                            | 116.91 ms | 117.81 ms |

These timings establish a new accounting reference; they do not demonstrate a performance
improvement. Hosted-runner p50/p95 values remain informational because wall-clock variance is not
a substitute for request correctness.
