# Supported platforms

The package engine is Node `^22.23.2 || >=24.16.0 <25 || ^26.7.0`. Canonical development and
builds use Node 24.19.0. Public CI exercises the same exact packed artifact on standard hosted
Ubuntu 24.04 x64 and ARM64, Windows 2025 x64, Windows 11 ARM64, macOS 15 ARM64, and macOS 15
Intel lanes. A platform is claimed for a release only after that acceptance passes. The v0.2.2 historical
claim remains native Apple Silicon macOS and Windows x64.

Private Context uses the same pure-Node package and parser worker on each supported lane. Platform
acceptance is synthetic and offline; public CI never receives a GitHub App token or private
repository identifier. Live selected-repository acceptance is a separate release-candidate gate.

Browser-opening acceptance has two layers. Hosted lanes verify the exact macOS, Windows, and Linux
command construction against the packed candidate; they do not prove that a GUI appeared. Native
GUI acceptance is recorded separately in each release packet. Linux uses `/usr/bin/xdg-open` only
when a graphical session is present and otherwise keeps the validated manual link visible.
