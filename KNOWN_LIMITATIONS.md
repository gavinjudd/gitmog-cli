# Known limitations

- Git Mog observes public GitHub evidence only; missing evidence lowers coverage.
- The released v0.2.2 source analyzer is lexical. Parser-backed Quality Judge work remains
  preview-only until the v0.3.0 implementation and later human calibration gates are complete.
- One-time GitHub device authorization is session-only and requests no scope.
- Cache entries contain stable public metadata and derived features, never raw source.
- Architecture support is claimed only after an exact package passes the named hosted lane.
