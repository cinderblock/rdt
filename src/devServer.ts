import { Target } from './config';
import esbuild from 'esbuild';
import logger from './log';

export async function doDevServer(ds: Target['devServer']) {
  if (!ds) return;

  if (typeof ds === 'string') {
    ds = { entry: ds };
  }

  if (ds.serveLocal === false) return;

  if (ds.serveLocal === true || ds.serveLocal === undefined) {
    ds.serveLocal = 'src/ui/public';
  }

  const { entry, serveLocal } = ds;

  const entryPoints = Array.isArray(entry) ? entry : [entry];

  const ctx = await esbuild.context({
    entryPoints,
    bundle: true,
    outfile: `${ds.serveLocal}/app.js`,
    // outdir: ds.serveLocal,
    sourcemap: 'inline',
    sourcesContent: false,
  });

  await ctx.watch();

  const { host, port } = await ctx.serve({
    servedir: ds.serveLocal,
  });

  logger.info(`Serving on http://localhost:${port}`);
}
