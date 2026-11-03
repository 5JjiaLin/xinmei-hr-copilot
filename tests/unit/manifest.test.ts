import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve('.');
test('网站权限仅按需申请 BOSS；不申请 debugger 或所有网站', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['sidePanel', 'storage', 'scripting']);
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.optional_host_permissions, ['https://www.zhipin.com/*']);
  assert.equal(manifest.content_scripts, undefined);
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'/);
});
test('本地源页面不引用远程脚本、内联执行器和失效资源', () => {
  for (const file of ['sidepanel.html', 'mock.html']) {
    const html = readFileSync(path.join(root, 'public', file), 'utf8');
    assert.doesNotMatch(html, /<script[^>]+src="https?:|\son\w+=|javascript:/i);
    for (const [, target] of html.matchAll(/href="([^"]+)"/g)) assert.ok(existsSync(path.join(root, 'public', target!)));
  }
});
