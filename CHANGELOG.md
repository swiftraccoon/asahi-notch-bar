# Changelog

## 1.0.0 (extensions.gnome.org version 1), unreleased

First release.

- Sizes the top bar to the notch height that m1n1 records as
  `apple,notch-height` on the `dcp` device-tree node, when `appledrm show_notch`
  is on.
- Converts notch rows to stage units from the panel's physical DRM mode, so the
  height is exact in logical and physical layout modes and at fractional scales.
- Moves the clock from the centre to just left of the system menu.
- Applies only while the built-in panel is a lit part of the primary monitor,
  and follows startup completion and monitor changes.
- Sets the height on the panel actor; the overview clears the panel's inline
  style on every hide.
- Reads every file asynchronously and cancellably; disabling, or any error,
  restores the original bar and clock position.
- Ships with strict TypeScript, type-aware linting, TSDoc on every declaration,
  unit tests at full coverage, headless GNOME Shell tests and a byte-reproducible
  package.
