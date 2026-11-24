// SPDX-License-Identifier: MIT
/**
 * The hardware boundary: kernel files and Mutter's monitor list.
 *
 * @remarks
 * Every read is asynchronous and cancellable, so the compositor never blocks on
 * sysfs. The headless shell test swaps this whole module for a typed fake.
 *
 * @packageDocumentation
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    type MonitorInfo,
    parseModeRows,
    parseModuleFlag,
    parseNodePath,
    parseNotchRows,
} from './notch.ts';

Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'close_async');

/** Root of the flattened device tree. */
const DEVICE_TREE = '/sys/firmware/devicetree/base';
/** Directory of DRM connectors. */
const DRM_CLASS = '/sys/class/drm';
/** `appledrm` parameter that is `Y` when the notch rows are part of the mode. */
const SHOW_NOTCH = '/sys/module/appledrm/parameters/show_notch';
/** Directory entries fetched per enumeration round trip. */
const ENUMERATION_BATCH = 64;

/**
 * Tell cancellation, which must propagate, from an ordinary read failure.
 *
 * @param error - The rejection reason.
 * @returns Whether the operation was cancelled.
 */
function isCancellation(error: unknown): boolean {
    return error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

/**
 * Read a whole file.
 *
 * @param path - Absolute path.
 * @param cancellable - Cancels the read.
 * @returns The contents, or null when the file is absent or unreadable.
 * @throws {@link GLib.Error} `Gio.IOErrorEnum.CANCELLED` when `cancellable` is cancelled.
 */
async function readBytes(path: string, cancellable: Gio.Cancellable): Promise<Uint8Array | null> {
    try {
        const [contents] = await Gio.File.new_for_path(path).load_contents_async(cancellable);
        return contents;
    } catch (error) {
        if (isCancellation(error)) {
            throw error;
        }
        return null;
    }
}

/**
 * List the entry names of a directory.
 *
 * @param path - Absolute directory path.
 * @param cancellable - Cancels the listing.
 * @returns The names, or an empty list when the directory is unreadable.
 * @throws {@link GLib.Error} `Gio.IOErrorEnum.CANCELLED` when `cancellable` is cancelled.
 */
async function listNames(path: string, cancellable: Gio.Cancellable): Promise<string[]> {
    let enumerator: Gio.FileEnumerator;
    try {
        enumerator = await Gio.File.new_for_path(path).enumerate_children_async(
            'standard::name',
            Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT,
            cancellable,
        );
    } catch (error) {
        if (isCancellation(error)) {
            throw error;
        }
        return [];
    }
    const names: string[] = [];
    try {
        for (;;) {
            const batch = await enumerator.next_files_async(
                ENUMERATION_BATCH,
                GLib.PRIORITY_DEFAULT,
                cancellable,
            );
            if (batch.length === 0) {
                return names;
            }
            names.push(...batch.map(info => info.get_name()));
        }
    } finally {
        await enumerator.close_async(GLib.PRIORITY_DEFAULT, null);
    }
}

/**
 * Read the notch height when `appledrm` includes the notch rows in the mode.
 *
 * @remarks
 * m1n1 records the height as `apple,notch-height` on the node that the `dcp`
 * device-tree alias names.
 *
 * @param cancellable - Cancels the reads.
 * @returns The notch height in physical rows, or 0 when hidden or unknown.
 * @throws {@link GLib.Error} `Gio.IOErrorEnum.CANCELLED` when `cancellable` is cancelled.
 */
export async function readNotchRows(cancellable: Gio.Cancellable): Promise<number> {
    if (!parseModuleFlag(await readBytes(SHOW_NOTCH, cancellable))) {
        return 0;
    }
    const node = parseNodePath(await readBytes(`${DEVICE_TREE}/aliases/dcp`, cancellable));
    if (node === null) {
        return 0;
    }
    return parseNotchRows(await readBytes(`${DEVICE_TREE}${node}/apple,notch-height`, cancellable));
}

/**
 * Read the physical rows of a DRM connector's first mode.
 *
 * @param connector - Connector name, such as `eDP-1`.
 * @param cancellable - Cancels the reads.
 * @returns The rows, or 0 when the connector or its modes are unknown.
 * @throws {@link GLib.Error} `Gio.IOErrorEnum.CANCELLED` when `cancellable` is cancelled.
 */
export async function readPanelRows(
    connector: string,
    cancellable: Gio.Cancellable,
): Promise<number> {
    const entries = await listNames(DRM_CLASS, cancellable);
    const entry = entries.find(name => name.endsWith(`-${connector}`));
    if (entry === undefined) {
        return 0;
    }
    return parseModeRows(await readBytes(`${DRM_CLASS}/${entry}/modes`, cancellable));
}

/**
 * List Mutter's physical monitors.
 *
 * @returns The monitors, or an empty list before Mutter has any.
 */
export function physicalMonitors(): readonly MonitorInfo[] {
    return global.backend.get_monitor_manager().get_monitors() ?? [];
}
