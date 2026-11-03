import { build, context } from 'esbuild';
import { mkdir, copyFile, readdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await mkdir('dist/third_party', { recursive: true });
await copyFile('third_party/POLARIS_LICENSE', 'dist/third_party/POLARIS_LICENSE');
await copyFile('node_modules/zod/LICENSE', 'dist/third_party/ZOD_LICENSE');
await copyFile('THIRD_PARTY_NOTICES.md', 'dist/THIRD_PARTY_NOTICES.md');
await copyFile('manifest.json', 'dist/manifest.json');
for (const file of await readdir('public')) await copyFile(`public/${file}`, `dist/${file}`);
const options = {
  entryPoints: {
    background: 'src/entries/background/index.ts',
    sidepanel: 'src/ui/sidepanel.ts',
    mock: 'src/adapters/mock/fixture.ts',
    'boss-content': 'src/adapters/boss/content.ts'
  },
  outdir: 'dist', bundle: true, format: 'esm', target: 'chrome116', sourcemap: true,
  // 保持依赖路径相对项目，避免本地软链接目录泄露到发布脚本和 source map。
  preserveSymlinks: true
};
if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('监听源码变化；请在扩展管理页重新加载扩展。');
} else await build(options);
