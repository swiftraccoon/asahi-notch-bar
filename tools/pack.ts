// SPDX-License-Identifier: MIT
/**
 * Package the compiled extension as `dist/<uuid>.shell-extension.zip`.
 *
 * @remarks
 * Validates `metadata.json` against `package.json` first, then prints the
 * archive path and its SHA-256. Run `npm run pack`, which compiles first.
 *
 * @packageDocumentation
 */

import {createHash} from 'node:crypto';
import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

import {createZip, type ZipEntry} from './zip.ts';

/** Repository root. */
const ROOT = join(import.meta.dirname, '..');
/** Where `tsc -p tsconfig.json` writes the extension modules. */
const BUILD = join(ROOT, 'build', 'src');
/** The only GNOME Shell release the extension is tested against. */
const SHELL_VERSIONS = ['51'];
/** Extension UUIDs must be `name@domain` without path characters. */
const UUID = /^[a-z0-9-]+@[a-z0-9.-]+$/;

/** The `metadata.json` fields this script validates. */
interface Metadata {
    /** Unique extension identifier. */
    readonly uuid: string;
    /** Integer release counter used by extensions.gnome.org. */
    readonly version: number;
    /** Human-readable release, which must match `package.json`. */
    readonly 'version-name': string;
    /** Supported GNOME Shell releases. */
    readonly 'shell-version': readonly string[];
}

/**
 * Parse a JSON file into an object.
 *
 * @param path - File to read.
 * @returns The parsed object.
 * @throws {@link Error} when the file does not hold a JSON object.
 */
async function readJsonObject(path: string): Promise<Record<string, unknown>> {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${path}: expected a JSON object`);
    }
    return value as Record<string, unknown>;
}

/**
 * Read `metadata.json` and check it against `package.json`.
 *
 * @returns The validated metadata.
 * @throws {@link Error} naming the first field that is wrong.
 */
async function readMetadata(): Promise<Metadata> {
    const metadata = await readJsonObject(join(ROOT, 'metadata.json'));
    const manifest = await readJsonObject(join(ROOT, 'package.json'));
    const {uuid, version} = metadata;
    const versionName = metadata['version-name'];
    const shellVersions = metadata['shell-version'];
    if (typeof uuid !== 'string' || !UUID.test(uuid)) {
        throw new Error('metadata.json: uuid must look like name@domain');
    }
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
        throw new Error('metadata.json: version must be a positive integer');
    }
    if (typeof versionName !== 'string' || versionName !== manifest['version']) {
        throw new Error('metadata.json: version-name must equal the package.json version');
    }
    if (
        !Array.isArray(shellVersions) ||
        JSON.stringify(shellVersions) !== JSON.stringify(SHELL_VERSIONS)
    ) {
        throw new Error(`metadata.json: shell-version must be ${JSON.stringify(SHELL_VERSIONS)}`);
    }
    return {uuid, version, 'version-name': versionName, 'shell-version': SHELL_VERSIONS};
}

/**
 * Collect the archive entries in a fixed order.
 *
 * @returns Compiled modules sorted by name, then metadata and licence.
 * @throws {@link Error} when the build output is missing.
 */
async function collectEntries(): Promise<ZipEntry[]> {
    const modules = (await readdir(BUILD)).filter(name => name.endsWith('.js')).sort();
    if (!modules.includes('extension.js')) {
        throw new Error(`${BUILD}: no extension.js; run npm run build`);
    }
    const files = [
        ...modules.map(name => ({name, path: join(BUILD, name)})),
        {name: 'metadata.json', path: join(ROOT, 'metadata.json')},
        {name: 'LICENSE', path: join(ROOT, 'LICENSE')},
    ];
    return await Promise.all(
        files.map(async ({name, path}) => ({name, data: await readFile(path)})),
    );
}

/** Validate the metadata, write the archive and print its path and SHA-256. */
async function main(): Promise<void> {
    const {uuid} = await readMetadata();
    const archive = createZip(await collectEntries());
    const output = join('dist', `${uuid}.shell-extension.zip`);
    await mkdir(join(ROOT, 'dist'), {recursive: true});
    await writeFile(join(ROOT, output), archive);
    process.stdout.write(`${output}\n${createHash('sha256').update(archive).digest('hex')}\n`);
}

await main();
