# Asahi Notch Bar

A GNOME Shell extension that fits the top bar to the camera notch on Apple Silicon
MacBooks running [Asahi Linux](https://asahilinux.org/).

Asahi's display driver hides the display rows beside the notch by default. The
`appledrm.show_notch=1` option gives you the whole panel back, but GNOME has no idea
the notch exists. The top bar fills only part of the band, the camera housing covers
the centred clock, and maximised windows start behind the notch.

With this extension, when the notch rows are shown:

- the top bar takes exactly the notch's height, so maximised and tiled windows start
  just below it;
- the clock moves from the centre to just left of the system menu.

It changes nothing while the notch is hidden or when the machine has no notch. When
an external display is the primary monitor, GNOME's normal bar returns; the notch
bar comes back when the built-in panel is primary again. Disabling the extension
restores the original bar and clock position.

## Requirements

- A MacBook with a notch: 14- and 16-inch MacBook Pro (M1 Pro/Max and later), or
  13- and 15-inch MacBook Air (M2 and later).
- An Asahi kernel with the `appledrm` display-controller (DCP) driver, and m1n1
  1.9.9 or later, which records the notch height. M3 machines need **m1n1 2.0.1 or
  later** before DCP is enabled.
- GNOME Shell 51.

## Setup

1. Show the notch rows. If `appledrm` is a loadable module, as in Fedora Asahi
   Remix:

   ```sh
   echo 'options appledrm show_notch=1' | sudo tee /etc/modprobe.d/appledrm.conf
   ```

   If your kernel builds it in or loads it from the initramfs, set a boot argument
   instead, for example `sudo grubby --update-kernel=ALL --args=appledrm.show_notch=1`.
   Reboot, then check:

   ```sh
   cat /sys/module/appledrm/parameters/show_notch   # prints Y
   ```

2. Install the extension, from a release:

   ```sh
   gnome-extensions install --force asahi-notch-bar@swiftraccoon.github.io.shell-extension.zip
   ```

   or from a checkout of this repository with `npm ci && npm run extension:install`.

3. Log out and back in; GNOME on Wayland loads newly installed extensions at login.
   Then enable it:

   ```sh
   gnome-extensions enable asahi-notch-bar@swiftraccoon.github.io
   ```

## How it works

At boot, m1n1 compares the screen height reported by Apple's firmware with the
framebuffer it gives Linux. It stores the difference, the notch rows, as
`apple,notch-height` on the display controller node named by the `dcp` device-tree
alias (`dt_set_display` in m1n1's `src/kboot.c`); nothing else writes that
property.

When the extension is enabled it checks `/sys/module/appledrm/parameters/show_notch`
and reads the property from `/sys/firmware/devicetree/base`. Heights above the
driver's own limit of 160 rows are rejected. It then sets a fixed height on the
panel actor, in stage units, rounded up so no notch row is left uncovered. Stage
units are logical pixels in GNOME's logical layout mode and physical pixels
otherwise, so the notch rows are scaled by the primary monitor's stage height over
the panel's physical rows, which come from the connector's DRM mode; the monitor
scale is the fallback. The layout follows startup completion and every monitor
change, and any failure restores GNOME's own bar.

It deliberately leaves the panel's inline style alone. GNOME Shell's overview owns
`Main.panel.style` and clears it at startup and every time the overview hides, so
a height set there disappears at the first use of the overview. A lint rule
rejects any use of `Main.panel.style`.

All file access is asynchronous and cancellable, so the compositor never waits
on sysfs, and disabling mid-read leaves nothing behind.

| Module             | Responsibility                                                        |
| ------------------ | --------------------------------------------------------------------- |
| `src/extension.ts` | Lifecycle: enable, disable, following monitors, error recovery.       |
| `src/hardware.ts`  | The hardware boundary: device tree, `appledrm` and DRM files, Mutter. |
| `src/panel.ts`     | The only code that changes the top bar, and its exact reversal.       |
| `src/notch.ts`     | Pure decoding and sizing decisions; imports nothing from GNOME.       |

## Limitations

- Fullscreen windows, such as video and games, still extend under the notch.
- Only the clock moves. Items that other extensions place in the centre of the bar
  sit behind the notch.
- GNOME has no display-cutout support, so applications themselves do not know about
  the notch. This extension adjusts the top bar only.
- Tested so far on a 15-inch MacBook Air M3 (64 notch rows at scale 1.0) with
  GNOME Shell 51.1 on Fedora Asahi Remix 45. Reports from other models and scales
  are welcome.

## Troubleshooting

| Symptom                                  | Check                                                                                                                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The bar is unchanged                     | `cat /sys/module/appledrm/parameters/show_notch` prints `Y`, and `gnome-extensions info asahi-notch-bar@swiftraccoon.github.io` shows `State: ACTIVE`.                                 |
| The notch height is missing              | `od -An -tu4 --endian=big "/sys/firmware/devicetree/base$(tr -d '\0' < /sys/firmware/devicetree/base/aliases/dcp)/apple,notch-height"` prints the notch rows. Without it, update m1n1. |
| The panel never shows the notch rows     | DCP must drive the panel: `ls -l /sys/class/drm/` lists a card under `display-subsystem`. On M3 this needs m1n1 2.0.1 or later.                                                        |
| The bar is normal on an external display | Expected: the notch bar applies only while the built-in panel is primary.                                                                                                              |

## Development

The extension is written in TypeScript and compiled to readable ES modules, with
comments kept, for GNOME Shell. Node 24 or later is required; Node runs the unit
tests and tools from the TypeScript sources directly.

```sh
npm ci                     # locked dependencies; install scripts are disabled
npm run check              # format, lint, type-check, unit tests with coverage
npm run test:shell         # against the installed GNOME Shell (needs GNOME 51)
npm run pack               # reproducible zip in dist/ and its SHA-256
npm run extension:install  # pack, then install for the current user
```

`npm run check` enforces:

- **Types:** `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
  and the other strictness options in `tsconfig.base.json`, checked against the
  GNOME 51 type definitions (`@girs`). The extension and the Node code are
  separate projects, so GNOME code cannot use Node APIs or the reverse.
- **Lint:** typescript-eslint's `strictTypeChecked` and `stylisticTypeChecked`,
  rules that forbid synchronous file I/O and `Main.panel.style` in Shell code,
  TSDoc syntax with a comment on every declaration, and no inline suppressions.
  ShellCheck runs with every optional check enabled.
- **Format:** Prettier.
- **Tests:** 100% line, branch and function coverage of `src/notch.ts` and the
  ZIP writer.

`npm run test:shell` covers what unit tests cannot:

| Check    | What it proves                                                                                                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `api`    | The installed typelibs provide every GObject method the extension calls; the compiler checks the same names against the type definitions.                                                                                                                          |
| `smoke`  | The unmodified build reaches ACTIVE in a headless GNOME Shell with no errors.                                                                                                                                                                                      |
| `layout` | With `tests/shell/hardware.ts` standing in for the hardware module, a probe extension confirms the bar height and clock position at startup, across two overview cycles, after `disable()` (actor height released, clock back in the centre) and after `enable()`. |

Each Shell runs in a private D-Bus session with its own home, dconf and runtime
directory and a virtual monitor, so the running desktop is untouched. Set
`KEEP_WORK=DIR` to keep the logs. The final look still needs a check on real
hardware.

`npm run pack` stores files uncompressed with fixed timestamps, order and
permissions, so a commit always produces the same zip and checksum whatever the
machine. CI runs `npm audit signatures`, `npm run check` and a byte-for-byte
reproducibility check of the package on every push; its actions are pinned to
commit hashes.

## License

[MIT](LICENSE)
