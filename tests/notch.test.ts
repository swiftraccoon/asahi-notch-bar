// SPDX-License-Identifier: MIT
/**
 * Unit tests for the pure decisions in `src/notch.ts`.
 *
 * @packageDocumentation
 */

import assert from 'node:assert/strict';
import {describe, test} from 'node:test';

import {
    MAX_NOTCH_ROWS,
    type MonitorInfo,
    findBuiltinPrimary,
    panelStageHeight,
    parseModeRows,
    parseModuleFlag,
    parseNodePath,
    parseNotchRows,
} from '../src/notch.ts';

/** Physical rows of the 15-inch MacBook Air M3 panel. */
const PANEL_ROWS = 1864;
/** Notch rows that m1n1 reports for that panel. */
const NOTCH_ROWS = 64;

/**
 * Encode text as the bytes a sysfs or device-tree read returns.
 *
 * @param text - Characters below U+0100, one byte each.
 * @returns One byte per character, as `Gio.File.load_contents_async` yields them.
 */
function ascii(text: string): Uint8Array {
    return Uint8Array.from(text, character => character.charCodeAt(0));
}

/** A `Meta.Monitor` double. */
interface FakeMonitor extends MonitorInfo {
    /** Distinguishes doubles in assertion messages. */
    readonly name: string;
}

/** The flags a {@link FakeMonitor} reports. */
interface MonitorFlags {
    /** Whether it is the laptop panel. */
    readonly builtin: boolean;
    /** Whether it is part of the primary logical monitor. */
    readonly primary: boolean;
    /** Whether it is lit. */
    readonly active: boolean;
}

/**
 * Build a `Meta.Monitor` double.
 *
 * @param name - Label used in assertion messages.
 * @param state - What the double reports; built-in doubles use connector `eDP-1`.
 * @returns A double whose methods return `state`.
 */
function monitor(name: string, state: MonitorFlags): FakeMonitor {
    return {
        name,
        is_builtin: () => state.builtin,
        is_primary: () => state.primary,
        is_active: () => state.active,
        get_connector: () => (state.builtin ? 'eDP-1' : 'DP-1'),
    };
}

await describe('parseNotchRows', async () => {
    await test('decodes one big-endian cell', () => {
        assert.equal(parseNotchRows(Uint8Array.of(0, 0, 0, NOTCH_ROWS)), NOTCH_ROWS);
        assert.equal(parseNotchRows(Uint8Array.of(0, 0, 0, 74)), 74);
    });

    await test('decodes a cell that is a view into a larger buffer', () => {
        const property = Uint8Array.of(0xff, 0, 0, 0, NOTCH_ROWS, 0xff).subarray(1, 5);
        assert.equal(parseNotchRows(property), NOTCH_ROWS);
    });

    await test('accepts heights up to the driver limit and rejects others', () => {
        assert.equal(parseNotchRows(Uint8Array.of(0, 0, 0, 0)), 0);
        assert.equal(parseNotchRows(Uint8Array.of(0x40, 0, 0, 0)), 0, 'little-endian misread');
        assert.equal(parseNotchRows(Uint8Array.of(0, 0, 0, MAX_NOTCH_ROWS)), MAX_NOTCH_ROWS);
        assert.equal(parseNotchRows(Uint8Array.of(0, 0, 0, MAX_NOTCH_ROWS + 1)), 0);
    });

    await test('rejects anything but exactly one cell', () => {
        assert.equal(parseNotchRows(Uint8Array.of(0, 0, NOTCH_ROWS)), 0);
        assert.equal(parseNotchRows(Uint8Array.of(0, 0, 0, NOTCH_ROWS, 0)), 0);
        assert.equal(parseNotchRows(null), 0);
    });
});

await describe('parseModuleFlag', async () => {
    await test('is true only for Y', () => {
        assert.equal(parseModuleFlag(ascii('Y\n')), true);
        assert.equal(parseModuleFlag(ascii('N\n')), false);
        assert.equal(parseModuleFlag(ascii('y\n')), false);
        assert.equal(parseModuleFlag(Uint8Array.of()), false);
        assert.equal(parseModuleFlag(null), false);
    });
});

await describe('parseNodePath', async () => {
    await test('decodes absolute paths with or without a terminator', () => {
        assert.equal(parseNodePath(ascii('/soc/dcp@28ec00000\0')), '/soc/dcp@28ec00000');
        assert.equal(
            parseNodePath(ascii('/soc@200000000/dcp@38bc00000')),
            '/soc@200000000/dcp@38bc00000',
        );
    });

    await test('rejects relative, traversing, non-printable and empty paths', () => {
        assert.equal(parseNodePath(ascii('soc/dcp@1\0')), null);
        assert.equal(parseNodePath(ascii('/soc/../aliases\0')), null);
        assert.equal(parseNodePath(ascii('/soc/dcp@1 x\0')), null);
        assert.equal(parseNodePath(Uint8Array.of(0x2f, 0x80)), null);
        assert.equal(parseNodePath(Uint8Array.of(0)), null);
        assert.equal(parseNodePath(null), null);
    });
});

await describe('parseModeRows', async () => {
    await test('reads the height of the first mode line', () => {
        assert.equal(parseModeRows(ascii(`2880x${String(PANEL_ROWS)}\n2880x1800\n`)), PANEL_ROWS);
        assert.equal(parseModeRows(ascii('3024x1964')), 1964);
    });

    await test('is zero for empty or malformed modes', () => {
        assert.equal(parseModeRows(ascii('\n')), 0);
        assert.equal(parseModeRows(ascii('garbage\n')), 0);
        assert.equal(parseModeRows(null), 0);
    });
});

await describe('panelStageHeight', async () => {
    await test('covers every notch row with no spare row at any common scale', () => {
        for (const scale of [1, 1.25, 4 / 3, 1.5, 1.75, 2, 2.5, 3]) {
            const monitorStageHeight = Math.floor(PANEL_ROWS / scale);
            const height = panelStageHeight({
                notchRows: NOTCH_ROWS,
                monitorStageHeight,
                panelRows: PANEL_ROWS,
                monitorScale: scale,
            });
            const rowsPerUnit = PANEL_ROWS / monitorStageHeight;
            assert.ok(height * rowsPerUnit >= NOTCH_ROWS, `scale ${String(scale)} leaves a row`);
            assert.ok(
                (height - 1) * rowsPerUnit < NOTCH_ROWS,
                `scale ${String(scale)} is too tall`,
            );
        }
    });

    await test('uses physical pixels in physical layout mode whatever the scale', () => {
        const geometry = {
            notchRows: NOTCH_ROWS,
            monitorStageHeight: PANEL_ROWS,
            panelRows: PANEL_ROWS,
            monitorScale: 2,
        };
        assert.equal(panelStageHeight(geometry), NOTCH_ROWS);
    });

    await test('falls back to the monitor scale without the panel rows', () => {
        const geometry = {notchRows: 74, monitorStageHeight: 1000, panelRows: 0, monitorScale: 2};
        assert.equal(panelStageHeight(geometry), 37);
        assert.equal(
            panelStageHeight({...geometry, monitorStageHeight: 0, panelRows: PANEL_ROWS}),
            37,
        );
    });

    await test('is zero for unusable inputs', () => {
        const geometry = {
            notchRows: NOTCH_ROWS,
            monitorStageHeight: 0,
            panelRows: 0,
            monitorScale: 0,
        };
        assert.equal(panelStageHeight(geometry), 0);
        assert.equal(panelStageHeight({...geometry, monitorScale: Number.NaN}), 0);
        assert.equal(panelStageHeight({...geometry, notchRows: 0, monitorScale: 1}), 0);
        assert.equal(panelStageHeight({...geometry, notchRows: Number.NaN, monitorScale: 1}), 0);
    });
});

await describe('findBuiltinPrimary', async () => {
    const panel = monitor('panel', {builtin: true, primary: true, active: true});

    await test('finds the lit built-in panel on the primary monitor', () => {
        assert.equal(findBuiltinPrimary([panel]), panel);
    });

    await test('finds it when mirrored with an external display', () => {
        const external = monitor('external', {builtin: false, primary: true, active: true});
        assert.equal(findBuiltinPrimary([external, panel]), panel);
    });

    await test('is null when an external display is primary', () => {
        const monitors = [
            monitor('panel', {builtin: true, primary: false, active: true}),
            monitor('external', {builtin: false, primary: true, active: true}),
        ];
        assert.equal(findBuiltinPrimary(monitors), null);
    });

    await test('is null when the lid is closed or there are no monitors', () => {
        const dark = monitor('panel', {builtin: true, primary: true, active: false});
        assert.equal(findBuiltinPrimary([dark]), null);
        assert.equal(findBuiltinPrimary([]), null);
    });
});
