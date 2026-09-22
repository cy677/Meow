import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { studioBuild } from './studioBuild.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
export default defineConfig({
  root,base:'./',publicDir:fileURLToPath(new URL('../public',import.meta.url)),
  plugins:[studioBuild()],
  server:{fs:{allow:[fileURLToPath(new URL('..',import.meta.url))],deny:['**/.env','**/.env.*','**/*.{crt,pem,key,p12,pfx}','**/.git/**','**/pet/data/**','**/pet/certs/**','**/*.sqlite','**/*.sqlite-*']}},
  // Keep the reusable renderer independent of app.js's page initialization.
  build:{outDir:'dist',emptyOutDir:true,rollupOptions:{input:{child:root+'index.html',parent:root+'parent.html',studio:root+'studio.html'},output:{manualChunks(id){if(['/pet/environment.css','/pet/environmentSchema.mjs','/pet/environmentRewards.mjs','/pet/motionPrograms.mjs','/pet/presetSchema.mjs','/pet/catalog.mjs','/src/coats.js','/pet/motion.css'].some(path=>id.endsWith(path)))return 'pet-domain';}}}},
});
