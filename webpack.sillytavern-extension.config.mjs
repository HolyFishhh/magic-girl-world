import path from 'node:path';
import url from 'node:url';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import TerserPlugin from 'terser-webpack-plugin';

const root = path.dirname(url.fileURLToPath(import.meta.url));

export default {
  mode: 'production',
  target: ['web', 'es2020'],
  entry: {
    index: path.resolve(root, 'src/sillytavern-extension/index.ts'),
    'design-worker': path.resolve(root, 'src/sillytavern-extension/designWorker.ts'),
  },
  experiments: { outputModule: true },
  output: {
    path: path.resolve(root, 'dist/sillytavern-extension/magic-girl-design-assistant'),
    filename: '[name].js',
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
      {
        test: /\.(sa|sc|c)ss$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader', 'sass-loader'],
      },
    ],
  },
  resolve: { extensions: ['.ts', '.js'] },
  plugins: [new MiniCssExtractPlugin({ filename: 'index.css' })],
  optimization: {
    minimize: true,
    concatenateModules: false,
    splitChunks: false,
    runtimeChunk: false,
    minimizer: [new TerserPlugin({ extractComments: false })],
  },
  performance: { hints: false },
};
