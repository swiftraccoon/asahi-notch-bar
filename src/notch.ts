// SPDX-License-Identifier: MIT
/**
 * Pure decisions: decoding kernel data and sizing the bar.
 *
 * @remarks
 * Nothing here imports GNOME, so Node runs the unit tests against this file
 * directly and enforces full line, branch and function coverage.
 *
 * @packageDocumentation
 */

/**
 * Largest plausible notch height in physical rows.
 *
 * @remarks
 * Matches `MAX_NOTCH_HEIGHT` in the Asahi `appledrm` driver (`dcp-internal.h`).
 */
export const MAX_NOTCH_ROWS = 160;

/** Size in bytes of one big-endian device-tree cell. */
const CELL_BYTES = 4;

/** Byte values used while decoding sysfs and device-tree text. */
const ASCII = {
    newline: 0x0a,
    yes: 0x59,
    firstPrintable: 0x21,
    lastPrintable: 0x7e,
} as const;

/** The subset of `Meta.Monitor` that the extension relies on. */
export interface MonitorInfo {
    /** Whether the monitor is the laptop's own panel. */
    is_builtin(): boolean;
    /** Whether the monitor belongs to the primary logical monitor. */
    is_primary(): boolean;
    /** Whether the monitor is lit. */
    is_active(): boolean;
    /** DRM connector name, such as `eDP-1`. */
    get_connector(): string;
}

/** Inputs for {@link panelStageHeight}. */
export interface PanelGeometry {
    /** Notch height in physical rows. */
    readonly notchRows: number;
    /** Height of the primary monitor in stage units. */
    readonly monitorStageHeight: number;
    /** Physical rows of the built-in panel's mode, or 0 when unknown. */
    readonly panelRows: number;
    /** Scale of the primary monitor, used when `panelRows` is unknown. */
    readonly monitorScale: number;
}

/**
 * Decode the big-endian `apple,notch-height` cell that m1n1 writes.
 *
 * @param cell - Raw property value.
 * @returns The notch height in rows, or 0 unless the value is one cell of 1 to {@link MAX_NOTCH_ROWS}.
 */
export function parseNotchRows(cell: Uint8Array | null): number {
    if (cell?.length !== CELL_BYTES) {
        return 0;
    }
    const rows = new DataView(cell.buffer, cell.byteOffset, CELL_BYTES).getUint32(0);
    return rows > 0 && rows <= MAX_NOTCH_ROWS ? rows : 0;
}

/**
 * Decode a boolean kernel module parameter.
 *
 * @param value - Contents of `/sys/module/<module>/parameters/<name>`.
 * @returns Whether the parameter reads `Y`.
 */
export function parseModuleFlag(value: Uint8Array | null): boolean {
    return value?.[0] === ASCII.yes;
}

/**
 * Decode a device-tree alias value such as `/soc/dcp@28ec00000`.
 *
 * @param value - Raw alias property, optionally NUL-terminated.
 * @returns The node path, or null unless it is an absolute, traversal-free path.
 */
export function parseNodePath(value: Uint8Array | null): string | null {
    if (!value) {
        return null;
    }
    const end = value.indexOf(0);
    const bytes = end < 0 ? value : value.subarray(0, end);
    if (
        bytes.length === 0 ||
        bytes.some(byte => byte < ASCII.firstPrintable || byte > ASCII.lastPrintable)
    ) {
        return null;
    }
    const path = String.fromCharCode(...bytes);
    return path.startsWith('/') && !path.split('/').includes('..') ? path : null;
}

/**
 * Read the height of a DRM connector's first mode line, such as `2880x1864`.
 *
 * @param modes - Contents of `/sys/class/drm/<connector>/modes`.
 * @returns The mode height in physical rows, or 0 when unreadable.
 */
export function parseModeRows(modes: Uint8Array | null): number {
    if (!modes) {
        return 0;
    }
    const end = modes.indexOf(ASCII.newline);
    const line = String.fromCharCode(...(end < 0 ? modes : modes.subarray(0, end)));
    const rows = /^\d+x(\d+)/.exec(line)?.[1];
    return rows === undefined ? 0 : Number(rows);
}

/**
 * Compute the top bar height, in stage units, that covers every notch row.
 *
 * @remarks
 * Stage units are logical pixels in GNOME's logical layout mode and physical
 * pixels in physical layout mode, so rows convert by the monitor's stage height
 * over the panel's physical rows. Without the physical rows the monitor scale is
 * used instead.
 *
 * @param geometry - Notch and monitor measurements.
 * @returns The height rounded up, or 0 when the inputs are unusable.
 */
export function panelStageHeight(geometry: PanelGeometry): number {
    const {notchRows, monitorStageHeight, panelRows, monitorScale} = geometry;
    if (!(notchRows > 0)) {
        return 0;
    }
    if (monitorStageHeight > 0 && panelRows > 0) {
        return Math.ceil((notchRows * monitorStageHeight) / panelRows);
    }
    return monitorScale > 0 ? Math.ceil(notchRows / monitorScale) : 0;
}

/**
 * Select the built-in panel when it is a lit part of the primary monitor.
 *
 * @remarks
 * The top bar lives on the primary monitor, so an external primary display keeps
 * GNOME's normal bar.
 *
 * @param monitors - Mutter's physical monitors.
 * @returns The built-in primary monitor, or null.
 */
export function findBuiltinPrimary<T extends MonitorInfo>(monitors: readonly T[]): T | null {
    return (
        monitors.find(
            monitor => monitor.is_builtin() && monitor.is_primary() && monitor.is_active(),
        ) ?? null
    );
}
