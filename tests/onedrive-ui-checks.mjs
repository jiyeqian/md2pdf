import test from 'node:test';
import assert from 'node:assert/strict';
import { formatOneDriveSize, orderOneDriveItems } from '../web/onedrive-ui.mjs';

test('merged pages deduplicate and order folders and files by time then natural name', () => {
  const older = '2026-11-18T10:00:00Z', newer = '2026-11-19T10:00:00Z';
  const page = orderOneDriveItems([
    {id:'10', name:'第10章.md', lastModifiedDateTime:newer},
    {id:'unknown', name:'A.md', lastModifiedDateTime:'invalid'},
    {id:'folder-old', name:'目录1', folder:{}, lastModifiedDateTime:older},
  ]);
  const merged = orderOneDriveItems([...page,
    {id:'folder-new', name:'目录2', folder:{}, lastModifiedDateTime:newer},
    {id:'folder-unknown', name:'目录0', folder:{}},
    {id:'old', name:'第1章.md', lastModifiedDateTime:older},
    {id:'2', name:'第2章.md', lastModifiedDateTime:newer},
    page[0],
  ]);
  assert.deepEqual(merged.map(item => item.id), ['folder-new', 'folder-old', 'folder-unknown', '2', '10', 'old', 'unknown']);
});

test('file sizes distinguish empty and unknown values', () => {
  assert.equal(formatOneDriveSize(0), '0 B · 空文件');
  assert.equal(formatOneDriveSize(5652), '5.5 KiB');
  assert.equal(formatOneDriveSize(42), '42 B');
  assert.equal(formatOneDriveSize(undefined), '大小未知');
});
