# Known limitations

- Git Mog uses only public GitHub evidence; unavailable or rate-limited evidence lowers coverage.
- One-time GitHub device authorization is session-only and requests no scope. Tokens are not persisted.
- The cache stores stable derived/public API data, never raw source, and is capped at 25 MiB.
- Identical source and tool versions are required for exact artifact reproduction. Platform-specific npm archive metadata can otherwise affect tarball bytes even when all six member bytes match.
