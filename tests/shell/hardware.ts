// SPDX-License-Identifier: MIT
/**
 * Test double for `src/hardware.ts`, used by the headless shell test.
 *
 * @remarks
 * A virtual monitor is never built in and has no notch, so `tests/shell/run.sh`
 * installs this module in place of the real one. Each export is typed against
 * the real module, so the double cannot drift from it. The geometry comes from
 * the environment the harness sets, keeping one source for the test values.
 *
 * @packageDocumentation
 */

import GLib from 'gi://GLib';

import type * as Hardware from '../../src/hardware.ts';
import type {MonitorInfo} from '../../src/notch.ts';

/**
 * Read a positive integer from the harness environment.
 *
 * @param name - Environment variable set by `tests/shell/run.sh`.
 * @returns Its value.
 * @throws {@link Error} when the variable is unset or not a positive integer.
 */
function positiveInteger(name: string): number {
    const value = Number(GLib.getenv(name));
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
    return value;
}

/** A lit, built-in, primary panel. */
const PANEL: MonitorInfo = {
    is_builtin: () => true,
    is_primary: () => true,
    is_active: () => true,
    get_connector: () => 'Virtual-1',
};

/**
 * Report the notch rows the harness configured.
 *
 * @returns `NOTCH_TEST_ROWS`.
 */
export const readNotchRows: typeof Hardware.readNotchRows = async () =>
    await Promise.resolve(positiveInteger('NOTCH_TEST_ROWS'));

/**
 * Report the panel rows the harness configured.
 *
 * @returns `NOTCH_TEST_PANEL_ROWS`.
 */
export const readPanelRows: typeof Hardware.readPanelRows = async () =>
    await Promise.resolve(positiveInteger('NOTCH_TEST_PANEL_ROWS'));

/**
 * Report a single built-in primary panel.
 *
 * @returns The fake panel.
 */
export const physicalMonitors: typeof Hardware.physicalMonitors = () => [PANEL];
