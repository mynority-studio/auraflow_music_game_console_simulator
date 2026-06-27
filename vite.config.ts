import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), basicSsl()],
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
      // ⚠️ 2026-06-28:移除 COOP/COEP 跨域隔离头。当前 spessasynth(lib 4.2.10 / core 4.2.8)的
      //   AudioWorklet 处理器【不再依赖 SharedArrayBuffer】(全仓 grep SharedArrayBuffer = 0)。
      //   COEP 'credentialless' 是已知会让 AudioWorklet.addModule 失败("Unable to load a worklet's module"
      //   AbortError)的诱因。既然无 SAB 依赖,这两个头是历史残留 → 删除以恢复音频 worklet 加载。
      //   (若将来某 spessasynth 版本重新需要 SAB,再按需加回 COOP same-origin + COEP require-corp。)
    },
  };
});
