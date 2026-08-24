import path from 'node:path';
import url from 'node:url';
import TerserPlugin from 'terser-webpack-plugin';

const root = path.dirname(url.fileURLToPath(import.meta.url));

export default {
  mode: 'production',
  target: ['web', 'es2020'],
  entry: {
    'magic-girl-core': path.resolve(root, 'src/portable/index.ts'),
    'card-backend': path.resolve(root, 'src/portable/cardBackend.ts'),
    'battle-backend': path.resolve(root, 'src/portable/battleBackend.ts'),
  },
  experiments: { outputModule: true },
  output: {
    path: path.resolve(root, 'dist/portable'),
    filename: '[name].mjs',
    library: { type: 'module' },
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: { loader: 'ts-loader', options: { transpileOnly: true } },
      },
    ],
  },
  resolve: { extensions: ['.ts', '.js'] },
  optimization: {
    minimize: true,
    splitChunks: false,
    runtimeChunk: false,
    minimizer: [new TerserPlugin({ extractComments: false })],
  },
  performance: { hints: false },
};
