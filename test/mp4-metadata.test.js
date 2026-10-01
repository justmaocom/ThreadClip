import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { injectMetadata } from '../src/mp4-metadata.js';

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const dir = mkdtempSync(join(tmpdir(), 'threadclip-'));
const METADATA = { comment: 'https://justmao.com', freeform: { source: 'https://justmao.com' } };

function makeVideo(name, movflags) {
  const file = join(dir, name);
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=2:size=160x120:rate=15',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    ...(movflags ? ['-movflags', movflags] : []),
    file,
  ]);
  return file;
}

function probeTags(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', file]);
  return JSON.parse(out).format.tags ?? {};
}

// 解碼所有影音封包並計算雜湊；若位移錯誤，雜湊會不同或解碼失敗
function decodedHash(file) {
  return execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0', '-f', 'md5', '-']).toString().trim();
}

const cases = [
  ['moov 在檔頭（faststart）', 'faststart.mp4', '+faststart'],
  ['moov 在檔尾', 'moov-end.mp4', null],
  ['fragmented MP4（絕對 base-data-offset）', 'fragmented.mp4', 'frag_keyframe+empty_moov'],
  ['fragmented MP4（default-base-is-moof）', 'fragmented-moof.mp4', 'frag_keyframe+empty_moov+default_base_moof'],
];

for (const [label, name, movflags] of cases) {
  test(`寫入來源中繼資料：${label}`, { skip: !hasFfmpeg && '需要 ffmpeg' }, () => {
    const input = makeVideo(name, movflags);
    const output = join(dir, `tagged-${name}`);
    writeFileSync(output, injectMetadata(new Uint8Array(readFileSync(input)), METADATA));

    const tags = probeTags(output);
    assert.equal(tags.comment, 'https://justmao.com');
    assert.equal(tags.source, 'https://justmao.com');
    assert.ok(tags.encoder, '原有的 encoder 標籤應保留');
    assert.equal(decodedHash(output), decodedHash(input));
  });
}

test('重複寫入不會產生重複標籤', { skip: !hasFfmpeg && '需要 ffmpeg' }, () => {
  const input = makeVideo('twice.mp4', '+faststart');
  const once = injectMetadata(new Uint8Array(readFileSync(input)), METADATA);
  const twice = injectMetadata(once, { comment: 'https://justmao.com/2', freeform: { source: 'https://justmao.com/2' } });
  const output = join(dir, 'tagged-twice.mp4');
  writeFileSync(output, twice);

  const tags = probeTags(output);
  assert.equal(tags.comment, 'https://justmao.com/2');
  assert.equal(tags.source, 'https://justmao.com/2');
  assert.equal(decodedHash(output), decodedHash(input));
});

test('非 MP4 檔案會拋出錯誤', () => {
  assert.throws(() => injectMetadata(new TextEncoder().encode('not a video at all'), METADATA));
});
