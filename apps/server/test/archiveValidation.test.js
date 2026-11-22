import test from 'node:test';
import assert from 'node:assert/strict';
import { findArchiveDuplicateArtifactIds, hasArchiveCandidate, inspectZipBuffer } from '../src/services/archiveValidation.js';
import { deflateRawSync } from 'node:zlib';

function makeZip(name, content) {
  const filename = Buffer.from(name);
  const data = Buffer.from(content);
  const compressed = deflateRawSync(data);
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + compressed.length, 16);
  return Buffer.concat([local, filename, compressed, central, filename, end]);
}

test('only ZIP artifacts are archive candidates', () => {
  assert.equal(hasArchiveCandidate([{ name: 'project.zip' }]), true);
  assert.equal(hasArchiveCandidate([{ name: 'index.html' }]), false);
});

test('ZIP verifier validates entries, decompression, and CRC', () => {
  const zip = inspectZipBuffer(makeZip('src/index.js', 'console.log("ok")'));
  assert.equal(zip.valid, true);
  assert.equal(zip.fileCount, 1);
  assert.equal(zip.entries[0].content.toString(), 'console.log("ok")');
  const broken = makeZip('src/index.js', 'console.log("ok")');
  broken[42] ^= 0xff;
  assert.equal(inspectZipBuffer(broken).valid, false);
});

test('archive duplicate cleanup matches exact relative paths', () => {
  assert.deepEqual(findArchiveDuplicateArtifactIds([
    { id: 'same', name: 'index.js', relativePath: 'src/index.js' },
    { id: 'other', name: 'index.js', relativePath: 'other/index.js' },
    { id: 'zip', name: 'project.zip', relativePath: 'project.zip' },
  ], [{ name: 'src/index.js' }]), ['same']);
});
