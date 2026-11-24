// SPDX-License-Identifier: MIT
/**
 * A minimal, byte-reproducible ZIP writer.
 *
 * @remarks
 * Entries are stored uncompressed with a fixed 1980-01-01 timestamp and mode
 * 0644, so the archive depends only on the entry names and bytes, never on the
 * clock, the file system or the zlib build. The extension is small enough that
 * compression would gain nothing worth that guarantee. Field offsets follow
 * sections 4.3.7, 4.3.12 and 4.3.16 of the ZIP application note (APPNOTE.TXT).
 *
 * @packageDocumentation
 */

import {crc32} from 'node:zlib';

/** One file in the archive. */
export interface ZipEntry {
    /** Path inside the archive: portable ASCII, relative and without dot segments. */
    readonly name: string;
    /** File contents. */
    readonly data: Uint8Array;
}

/** Record signatures. */
export const SIGNATURE = {
    localFile: 0x04034b50,
    centralDirectory: 0x02014b50,
    endOfCentralDirectory: 0x06054b50,
} as const;

/** Fixed sizes of the records, before their variable-length fields. */
export const RECORD_BYTES = {
    localFile: 30,
    centralDirectory: 46,
    endOfCentralDirectory: 22,
} as const;

/** MS-DOS date for 1980-01-01, the earliest a ZIP timestamp can express. */
export const DOS_DATE_1980_01_01 = (1 << 5) | 1;

/** ZIP 1.0, the minimum version for stored entries. */
const VERSION_NEEDED = 10;
/** Unix host (3) in the high byte, ZIP 1.0 in the low byte. */
const VERSION_MADE_BY = (3 << 8) | VERSION_NEEDED;
/** Compression method 0: stored. */
const METHOD_STORED = 0;
/** Unix regular file with mode 0644, in the high 16 bits of the external attributes. */
const EXTERNAL_ATTRIBUTES = (0o100644 << 16) >>> 0;
/** Largest size or offset a classic, non-ZIP64 archive records. */
const MAX_ARCHIVE_BYTES = 0xffffffff;
/** Largest entry count a classic, non-ZIP64 archive records. */
const MAX_ENTRIES = 0xffff;
/** Portable path characters, one or more segments. */
const SAFE_NAME = /^[\w.-]+(?:\/[\w.-]+)*$/;

/** The per-entry fields shared by the local and central headers. */
interface EntryFields {
    /** Entry name as ASCII bytes. */
    readonly name: Uint8Array;
    /** CRC-32 of the contents. */
    readonly checksum: number;
    /** Contents size; stored, so compressed and uncompressed sizes are equal. */
    readonly size: number;
}

/**
 * Reject names that are not portable, relative and free of dot segments.
 *
 * @param entries - The entries to check.
 * @throws {@link Error} for an unsafe or duplicate name.
 */
function assertSafeNames(entries: readonly ZipEntry[]): void {
    const seen = new Set<string>();
    for (const {name} of entries) {
        if (!SAFE_NAME.test(name) || name.split('/').some(part => part === '..' || part === '.')) {
            throw new Error(`unsafe ZIP entry name: ${JSON.stringify(name)}`);
        }
        if (seen.has(name)) {
            throw new Error(`duplicate ZIP entry name: ${name}`);
        }
        seen.add(name);
    }
}

/**
 * Write a local file header followed by the name and contents.
 *
 * @param fields - Shared entry fields.
 * @param data - Entry contents.
 * @returns The header, name and contents, ready to concatenate.
 */
function localRecord(fields: EntryFields, data: Uint8Array): Uint8Array {
    const record = new Uint8Array(RECORD_BYTES.localFile + fields.name.length + data.length);
    const view = new DataView(record.buffer);
    view.setUint32(0, SIGNATURE.localFile, true);
    view.setUint16(4, VERSION_NEEDED, true);
    view.setUint16(8, METHOD_STORED, true);
    view.setUint16(12, DOS_DATE_1980_01_01, true);
    view.setUint32(14, fields.checksum, true);
    view.setUint32(18, fields.size, true);
    view.setUint32(22, fields.size, true);
    view.setUint16(26, fields.name.length, true);
    record.set(fields.name, RECORD_BYTES.localFile);
    record.set(data, RECORD_BYTES.localFile + fields.name.length);
    return record;
}

/**
 * Write a central directory header followed by the name.
 *
 * @param fields - Shared entry fields.
 * @param localOffset - Offset of the entry's local header.
 * @returns The header and name, ready to concatenate.
 */
function centralRecord(fields: EntryFields, localOffset: number): Uint8Array {
    const record = new Uint8Array(RECORD_BYTES.centralDirectory + fields.name.length);
    const view = new DataView(record.buffer);
    view.setUint32(0, SIGNATURE.centralDirectory, true);
    view.setUint16(4, VERSION_MADE_BY, true);
    view.setUint16(6, VERSION_NEEDED, true);
    view.setUint16(10, METHOD_STORED, true);
    view.setUint16(14, DOS_DATE_1980_01_01, true);
    view.setUint32(16, fields.checksum, true);
    view.setUint32(20, fields.size, true);
    view.setUint32(24, fields.size, true);
    view.setUint16(28, fields.name.length, true);
    view.setUint32(38, EXTERNAL_ATTRIBUTES, true);
    view.setUint32(42, localOffset, true);
    record.set(fields.name, RECORD_BYTES.centralDirectory);
    return record;
}

/**
 * Write the end of central directory record.
 *
 * @param count - Number of entries.
 * @param directorySize - Size of the central directory in bytes.
 * @param directoryOffset - Offset of the central directory.
 * @returns The 22-byte trailer that ends the archive.
 */
function endRecord(count: number, directorySize: number, directoryOffset: number): Uint8Array {
    const record = new Uint8Array(RECORD_BYTES.endOfCentralDirectory);
    const view = new DataView(record.buffer);
    view.setUint32(0, SIGNATURE.endOfCentralDirectory, true);
    view.setUint16(8, count, true);
    view.setUint16(10, count, true);
    view.setUint32(12, directorySize, true);
    view.setUint32(16, directoryOffset, true);
    return record;
}

/**
 * Build a ZIP archive whose bytes depend only on the entries.
 *
 * @param entries - Files in archive order.
 * @returns The archive.
 * @throws {@link Error} for unsafe or duplicate names, or when the archive would need ZIP64.
 */
export function createZip(entries: readonly ZipEntry[]): Uint8Array {
    assertSafeNames(entries);
    const archiveBytes = entries.reduce<number>(
        (total, {name, data}) =>
            total +
            RECORD_BYTES.localFile +
            RECORD_BYTES.centralDirectory +
            2 * name.length +
            data.length,
        RECORD_BYTES.endOfCentralDirectory,
    );
    if (entries.length > MAX_ENTRIES || archiveBytes > MAX_ARCHIVE_BYTES) {
        throw new Error('ZIP archive would need ZIP64');
    }

    const encoder = new TextEncoder();
    const locals: Uint8Array[] = [];
    const centrals: Uint8Array[] = [];
    let offset = 0;
    for (const {name, data} of entries) {
        const fields = {name: encoder.encode(name), checksum: crc32(data), size: data.length};
        const local = localRecord(fields, data);
        centrals.push(centralRecord(fields, offset));
        locals.push(local);
        offset += local.length;
    }
    const directorySize = centrals.reduce((total, record) => total + record.length, 0);
    const parts = [...locals, ...centrals, endRecord(entries.length, directorySize, offset)];

    const archive = new Uint8Array(archiveBytes);
    let cursor = 0;
    for (const part of parts) {
        archive.set(part, cursor);
        cursor += part.length;
    }
    return archive;
}
