// SPDX-License-Identifier: MIT
/**
 * Round-trip tests for the reproducible ZIP writer in `tools/zip.ts`.
 *
 * @remarks
 * The reader below follows the ZIP application note independently of the
 * writer, so a field written at the wrong offset fails here.
 *
 * @packageDocumentation
 */

import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {crc32} from 'node:zlib';

import {
    createZip,
    DOS_DATE_1980_01_01,
    RECORD_BYTES,
    SIGNATURE,
    type ZipEntry,
} from '../tools/zip.ts';

/** One entry as recorded in the central directory and its local header. */
interface ReadEntry {
    /** Entry path. */
    readonly name: string;
    /** Stored bytes. */
    readonly data: Uint8Array;
    /** Unix mode from the external attributes. */
    readonly mode: number;
    /** MS-DOS date field. */
    readonly dosDate: number;
    /** MS-DOS time field. */
    readonly dosTime: number;
}

/**
 * Encode text as UTF-8.
 *
 * @param text - Text to encode.
 * @returns The bytes.
 */
function utf8(text: string): Uint8Array {
    return new TextEncoder().encode(text);
}

/**
 * Parse an archive through its end record and central directory.
 *
 * @param archive - Bytes produced by `createZip`.
 * @returns The entries, verified against their local headers and checksums.
 */
function readZip(archive: Uint8Array): ReadEntry[] {
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    const endOffset = archive.length - RECORD_BYTES.endOfCentralDirectory;
    assert.equal(
        view.getUint32(endOffset, true),
        SIGNATURE.endOfCentralDirectory,
        'end record signature',
    );
    const count = view.getUint16(endOffset + 10, true);
    assert.equal(view.getUint16(endOffset + 8, true), count, 'entries on this disk');
    const directorySize = view.getUint32(endOffset + 12, true);
    let cursor = view.getUint32(endOffset + 16, true);
    assert.equal(cursor + directorySize, endOffset, 'directory ends at the end record');
    const decoder = new TextDecoder('utf-8', {fatal: true});
    const entries: ReadEntry[] = [];
    for (let index = 0; index < count; index++) {
        assert.equal(
            view.getUint32(cursor, true),
            SIGNATURE.centralDirectory,
            'central header signature',
        );
        assert.equal(view.getUint16(cursor + 10, true), 0, 'stored');
        const checksum = view.getUint32(cursor + 16, true);
        const size = view.getUint32(cursor + 20, true);
        assert.equal(view.getUint32(cursor + 24, true), size, 'stored size equals size');
        const nameLength = view.getUint16(cursor + 28, true);
        const extraLength = view.getUint16(cursor + 30, true);
        const commentLength = view.getUint16(cursor + 32, true);
        const localOffset = view.getUint32(cursor + 42, true);
        const name = decoder.decode(
            archive.subarray(
                cursor + RECORD_BYTES.centralDirectory,
                cursor + RECORD_BYTES.centralDirectory + nameLength,
            ),
        );

        assert.equal(
            view.getUint32(localOffset, true),
            SIGNATURE.localFile,
            'local header signature',
        );
        assert.equal(view.getUint32(localOffset + 14, true), checksum, 'local checksum');
        const localNameLength = view.getUint16(localOffset + 26, true);
        const localExtraLength = view.getUint16(localOffset + 28, true);
        const start = localOffset + RECORD_BYTES.localFile + localNameLength + localExtraLength;
        const data = archive.subarray(start, start + size);
        assert.equal(crc32(data), checksum, `${name} checksum`);

        entries.push({
            name,
            data,
            mode: view.getUint32(cursor + 38, true) >>> 16,
            dosTime: view.getUint16(cursor + 12, true),
            dosDate: view.getUint16(cursor + 14, true),
        });
        cursor += RECORD_BYTES.centralDirectory + nameLength + extraLength + commentLength;
    }
    return entries;
}

/** A representative extension payload. */
const ENTRIES: readonly ZipEntry[] = [
    {name: 'extension.js', data: utf8('export default class {}\n')},
    {name: 'metadata.json', data: utf8('{"uuid": "example@example.org"}\n')},
    {name: 'empty', data: new Uint8Array()},
    {name: 'schemas/org.example.gschema.xml', data: Uint8Array.of(0, 0xff, 0x80, 0x0a)},
];

await describe('createZip', async () => {
    await test('round-trips names, bytes and order', () => {
        const entries = readZip(createZip(ENTRIES));
        assert.deepEqual(
            entries.map(({name, data}) => ({name, data: [...data]})),
            ENTRIES.map(({name, data}) => ({name, data: [...data]})),
        );
    });

    await test('records mode 0644 and a fixed 1980-01-01 timestamp', () => {
        for (const entry of readZip(createZip(ENTRIES))) {
            assert.equal(entry.mode, 0o100644, entry.name);
            assert.equal(entry.dosDate, DOS_DATE_1980_01_01, entry.name);
            assert.equal(entry.dosTime, 0, entry.name);
        }
    });

    await test('is byte-identical for identical input', () => {
        assert.deepEqual(createZip(ENTRIES), createZip(ENTRIES.map(entry => ({...entry}))));
    });

    await test('writes a valid empty archive', () => {
        assert.deepEqual(readZip(createZip([])), []);
    });

    await test('rejects unsafe and duplicate names', () => {
        const data = new Uint8Array();
        for (const name of ['', '/abs', 'a/../b', './a', 'a//b', 'a\\b', 'café', 'a b']) {
            assert.throws(() => createZip([{name, data}]), /unsafe/, JSON.stringify(name));
        }
        assert.throws(
            () =>
                createZip([
                    {name: 'a', data},
                    {name: 'a', data},
                ]),
            /duplicate/,
        );
    });

    await test('refuses archives that would need ZIP64', () => {
        const data = new Uint8Array();
        const many = Array.from({length: 0x10000}, (_, index) => ({
            name: `f${String(index)}`,
            data,
        }));
        assert.throws(() => createZip(many), /ZIP64/);
    });
});
