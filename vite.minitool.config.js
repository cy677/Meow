import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const sourcePath = (relativePath) => fileURLToPath(new URL(relativePath, import.meta.url));

function minitoolHtml() {
  return {
    name: 'minitool-classic-html',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html
          .replace('<body>', '<body class="xhs-minitool">')
          .replace(/<script\s+type="module"\s+crossorigin\s+src=/g, '<script defer src=')
          .replace(/<script\s+type="module"\s+src=/g, '<script defer src=')
          .replace(/\s+crossorigin(?=[\s>])/g, '');
      },
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [minitoolHtml()],
  resolve: {
    alias: {
      '#bgm': sourcePath('./src/bgm.minitool.js'),
      '#codex-pet-preview': sourcePath('./src/codexPetPreview.minitool.js'),
      '#glb-export': sourcePath('./src/glbExport.minitool.js'),
      '#platform': sourcePath('./src/platform.minitool.js'),
    },
  },
  build: {
    outDir: 'Exports/xhs-minitool',
    emptyOutDir: true,
    target: 'es2018',
    modulePreload: false,
    sourcemap: false,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/chunk-[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
