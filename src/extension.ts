// SPDX-License-Identifier: MIT
/**
 * Asahi Notch Bar: fits GNOME Shell's top bar to the Apple Silicon MacBook notch.
 *
 * @packageDocumentation
 */

import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {physicalMonitors, readNotchRows, readPanelRows} from './hardware.ts';
import {findBuiltinPrimary, panelStageHeight} from './notch.ts';
import {PanelLayout} from './panel.ts';

/** Sizes the top bar to the notch while the built-in panel is the primary monitor. */
export default class AsahiNotchBarExtension extends Extension {
    /** Cancels the reads started while enabled. */
    #cancellable: Gio.Cancellable | null = null;
    /** The bar changes made while enabled. */
    #layout: PanelLayout | null = null;
    /** Notch height in physical rows; 0 until read. */
    #notchRows = 0;
    /** Physical rows of each connector's mode, read when first needed; 0 when unknown. */
    readonly #panelRows = new Map<string, number>();

    /** Read the notch height, then size the bar and follow monitor changes. */
    override enable(): void {
        const cancellable = new Gio.Cancellable();
        this.#cancellable = cancellable;
        this.#layout = new PanelLayout();
        this.#run(this.#start(cancellable), cancellable);
    }

    /** Cancel pending reads and restore GNOME's own bar. */
    override disable(): void {
        this.#cancellable?.cancel();
        this.#cancellable = null;
        Main.layoutManager.disconnectObject(this);
        this.#layout?.restore();
        this.#layout = null;
        this.#notchRows = 0;
        this.#panelRows.clear();
    }

    /**
     * Read the notch height once and, when there is a notch, start following monitors.
     *
     * @param cancellable - Cancelled by {@link AsahiNotchBarExtension.disable}.
     * @throws {@link GLib.Error} `Gio.IOErrorEnum.CANCELLED` when disabled mid-read.
     */
    async #start(cancellable: Gio.Cancellable): Promise<void> {
        const notchRows = await readNotchRows(cancellable);
        if (notchRows === 0 || cancellable.is_cancelled()) {
            return;
        }
        this.#notchRows = notchRows;
        // Monitors can still be settling while the session starts.
        Main.layoutManager.connectObject(
            'monitors-changed',
            () => {
                this.#run(this.#update(cancellable), cancellable);
            },
            'startup-complete',
            () => {
                this.#run(this.#update(cancellable), cancellable);
            },
            this,
        );
        await this.#update(cancellable);
    }

    /**
     * Read the built-in panel's rows if they are not known yet, then sync the bar.
     *
     * @param cancellable - Cancelled by {@link AsahiNotchBarExtension.disable}.
     * @throws {@link GLib.Error} `Gio.IOErrorEnum.CANCELLED` when disabled mid-read.
     */
    async #update(cancellable: Gio.Cancellable): Promise<void> {
        const connector = findBuiltinPrimary(physicalMonitors())?.get_connector();
        if (connector !== undefined && !this.#panelRows.has(connector)) {
            const rows = await readPanelRows(connector, cancellable);
            if (cancellable.is_cancelled()) {
                return;
            }
            this.#panelRows.set(connector, rows);
        }
        this.#sync();
    }

    /** Apply the layout on the built-in primary panel, or restore GNOME's own bar. */
    #sync(): void {
        const layout = this.#layout;
        if (!layout) {
            return;
        }
        const builtin = findBuiltinPrimary(physicalMonitors());
        const monitor = Main.layoutManager.primaryMonitor;
        if (!builtin || !monitor) {
            layout.restore();
            return;
        }
        const height = panelStageHeight({
            notchRows: this.#notchRows,
            monitorStageHeight: monitor.height,
            panelRows: this.#panelRows.get(builtin.get_connector()) ?? 0,
            monitorScale: monitor.geometry_scale,
        });
        if (height > 0) {
            layout.apply(height);
        }
    }

    /**
     * Run asynchronous work; on failure, log it and leave GNOME's own bar in place.
     *
     * @param work - The started work.
     * @param cancellable - Its cancellable; a cancelled run ends quietly.
     */
    #run(work: Promise<void>, cancellable: Gio.Cancellable): void {
        work.catch((error: unknown) => {
            if (cancellable.is_cancelled()) {
                return;
            }
            Main.layoutManager.disconnectObject(this);
            this.#layout?.restore();
            this.getLogger().error('Disabled the notch layout after an error:', error);
        });
    }
}
