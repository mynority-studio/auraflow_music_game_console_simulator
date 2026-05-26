import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import compression from 'vite-plugin-compression';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      basicSsl(),
      // 2026-05-26 Step 8.3:build 时双压缩 .gz + .br,nginx / 静态 host 协商
      // 应用到 dist/ 全部 + public/grammars-compiled/ 静态资产
      compression({
        algorithm: 'gzip',
        ext: '.gz',
        threshold: 1024,
        filter: /\.(js|mjs|json|css|html|svg|wasm|txt)$/i,  // 加 txt(pool.txt)
        deleteOriginFile: false,
      }),
      compression({
        algorithm: 'brotliCompress',
        ext: '.br',
        threshold: 1024,
        filter: /\.(js|mjs|json|css|html|svg|wasm|txt)$/i,
        deleteOriginFile: false,
      }),
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // SharedArrayBuffer（SpessaSynth AudioWorklet 依赖）在非 localhost 源需要跨域隔离头
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
    },
  };
});
