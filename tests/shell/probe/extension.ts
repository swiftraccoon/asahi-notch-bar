// SPDX-License-Identifier: MIT
/**
 * Probe extension that drives a headless GNOME Shell and checks the notch layout.
 *
 * @remarks
 * Loaded beside the extension under test by `tests/shell/run.sh`. It cycles the
 * overview, which clears `Main.panel.style` on every hide, then calls the
 * extension's own `disable()` and `enable()`, as the extension manager does, and
 * logs one `NOTCHPROBE` result line. It bypasses the manager because disabling
 * through it also restarts every extension enabled later, and GNOME Shell enables
 * extensions in directory order, so that could include this probe.
 *
 * @packageDocumentation
 */

import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import type {ExtensionObject} from 'resource:///org/gnome/shell/ui/extensionSystem.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/** Time for the session to start and the extension under test to apply. */
const STARTUP_MS = 4000;
/** Time for an overview transition or an extension state change to settle. */
const SETTLE_MS = 1500;
/** Overview show-and-hide cycles to run. */
const OVERVIEW_CYCLES = 2;

/** Where the clock currently sits in the panel. */
type ClockPlace = 'center' | 'right' | 'elsewhere';

/**
 * Locate the clock among the panel's private boxes.
 *
 * @returns The box that holds the clock.
 */
function clockPlace(): ClockPlace {
    const parent = Main.panel.statusArea.dateMenu?.container.get_parent() ?? null;
    if (parent !== null && parent === Reflect.get(Main.panel, '_centerBox')) {
        return 'center';
    }
    if (parent !== null && parent === Reflect.get(Main.panel, '_rightBox')) {
        return 'right';
    }
    return 'elsewhere';
}

/**
 * Read a required string from the harness environment.
 *
 * @param name - Environment variable set by `tests/shell/run.sh`.
 * @returns Its value.
 * @throws {@link Error} when the variable is unset.
 */
function requiredEnv(name: string): string {
    const value = GLib.getenv(name);
    if (value === null || value === '') {
        throw new Error(`${name} is not set`);
    }
    return value;
}

/** Runs the checks once per enable and logs the outcome. */
export default class NotchProbeExtension extends Extension {
    /** Enables so far; a second one means GNOME Shell restarted the probe mid-run. */
    static #enables = 0;
    /** Pending timeout sources, removed on disable. */
    readonly #sources = new Set<number>();

    /** Start the checks; the result arrives in the journal. */
    override enable(): void {
        NotchProbeExtension.#enables++;
        if (NotchProbeExtension.#enables > 1) {
            this.getLogger().log('NOTCHPROBE FAIL GNOME Shell restarted the probe mid-run');
            return;
        }
        this.#run().then(
            failures => {
                this.getLogger().log(
                    failures.length === 0
                        ? 'NOTCHPROBE PASS'
                        : `NOTCHPROBE FAIL ${failures.join('; ')}`,
                );
            },
            (error: unknown) => {
                this.getLogger().error('NOTCHPROBE FAIL probe error:', error);
            },
        );
    }

    /** Remove pending timeouts. */
    override disable(): void {
        for (const source of this.#sources) {
            GLib.source_remove(source);
        }
        this.#sources.clear();
    }

    /**
     * Resolve after `milliseconds` on the GLib main loop.
     *
     * @param milliseconds - Delay.
     * @returns A promise that settles when the timeout fires.
     */
    async #delay(milliseconds: number): Promise<void> {
        await new Promise<void>(resolve => {
            const source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
                this.#sources.delete(source);
                resolve();
                return GLib.SOURCE_REMOVE;
            });
            this.#sources.add(source);
        });
    }

    /**
     * Exercise the extension under test.
     *
     * @returns A description of each failed check; empty when all passed.
     * @throws {@link Error} when the harness environment is incomplete or the
     * extension under test is not loaded.
     */
    async #run(): Promise<string[]> {
        const uuid = requiredEnv('NOTCH_TEST_TARGET');
        const expected = Number(requiredEnv('NOTCH_TEST_ROWS'));
        // The typings omit that lookup() returns undefined for an unknown UUID.
        const loaded = Main.extensionManager.lookup(uuid) as ExtensionObject | undefined;
        const target = loaded?.stateObj;
        if (!target) {
            throw new Error(`${uuid} is not loaded`);
        }
        const failures: string[] = [];
        const check = (label: string, passed: boolean): void => {
            if (!passed) {
                failures.push(
                    `${label} (height=${String(Main.panel.height)} clock=${clockPlace()})`,
                );
            }
        };

        await this.#delay(STARTUP_MS);
        check('applied at startup', Main.panel.height === expected && clockPlace() === 'right');

        for (let cycle = 1; cycle <= OVERVIEW_CYCLES; cycle++) {
            Main.overview.show();
            await this.#delay(SETTLE_MS);
            Main.overview.hide();
            await this.#delay(SETTLE_MS);
            check(
                `kept after overview cycle ${String(cycle)}`,
                !Main.overview.visible &&
                    Main.panel.height === expected &&
                    clockPlace() === 'right',
            );
        }

        target.disable();
        await this.#delay(SETTLE_MS);
        check(
            'disable restores the bar',
            !Main.panel.natural_height_set &&
                Main.panel.height < expected &&
                clockPlace() === 'center',
        );

        target.enable();
        await this.#delay(SETTLE_MS);
        check(
            're-enable applies again',
            Main.panel.height === expected && clockPlace() === 'right',
        );
        return failures;
    }
}
