import test from 'node:test';
import assert from 'node:assert/strict';
import { formatOneDriveSize } from '../web/onedrive-ui.mjs';

test('file sizes distinguish empty and unknown values', () => {
  assert.equal(formatOneDriveSize(0), '0 B · 空文件');
  assert.equal(formatOneDriveSize(5652), '5.5 KiB');
  assert.equal(formatOneDriveSize(42), '42 B');
  assert.equal(formatOneDriveSize(undefined), '大小未知');
});
