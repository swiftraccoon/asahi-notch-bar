// SPDX-License-Identifier: MIT
/**
 * Runtime check that the installed GNOME libraries provide every GObject method
 * the extension calls.
 *
 * @remarks
 * The compiler checks the same names against the `@girs` type definitions; this
 * checks them against the typelibs actually installed, which is what GNOME Shell
 * loads. Run with `npm run test:api` on a GNOME machine.
 *
 * @packageDocumentation
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import St from 'gi://St';
import system from 'system';

/**
 * Report which of `names` are not functions on `prototype`.
 *
 * @param owner - Type name used in the report, such as `Meta.Monitor`.
 * @param prototype - The type's prototype.
 * @param names - Method names, checked against the type definitions at compile time.
 * @returns Qualified names of the missing methods.
 */
function missingMethods<T extends object>(
    owner: string,
    prototype: T,
    names: readonly (keyof T & string)[],
): string[] {
    return names
        .filter(name => typeof prototype[name] !== 'function')
        .map(name => `${owner}.${name}`);
}

/** Required methods that the installed typelibs lack. */
const missing = [
    ...missingMethods('Meta.Backend', Meta.Backend.prototype, ['get_monitor_manager']),
    ...missingMethods('Meta.MonitorManager', Meta.MonitorManager.prototype, ['get_monitors']),
    ...missingMethods('Meta.Monitor', Meta.Monitor.prototype, [
        'is_builtin',
        'is_primary',
        'is_active',
        'get_connector',
    ]),
    ...missingMethods('Clutter.Actor', Clutter.Actor.prototype, [
        'set_height',
        'get_parent',
        'get_children',
        'get_n_children',
        'remove_child',
        'insert_child_at_index',
    ]),
    ...missingMethods('Gio.File', Gio.File.prototype, [
        'load_contents_async',
        'enumerate_children_async',
    ]),
    ...missingMethods('Gio.FileEnumerator', Gio.FileEnumerator.prototype, [
        'next_files_async',
        'close_async',
    ]),
    ...(St.BoxLayout.prototype instanceof Clutter.Actor ? [] : ['St.BoxLayout as Clutter.Actor']),
];

if (missing.length > 0) {
    printerr(`api: missing from the installed typelibs: ${missing.join(', ')}`);
    system.exit(1);
}
print('api: every GObject method the extension calls is present');
