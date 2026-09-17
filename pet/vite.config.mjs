import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
export default defineConfig({
  root,base:'./',
  server:{fs:{allow:[fileURLToPath(new URL('..',import.meta.url))],deny:['**/.env','**/.env.*','**/*.{crt,pem,key,p12,pfx}','**/.git/**','**/pet/data/**','**/pet/certs/**','**/*.sqlite','**/*.sqlite-*']}},
  // Keep the reusable renderer independent of app.js's page initialization.
  build:{outDir:'dist',emptyOutDir:true,rollupOptions:{input:{child:root+'index.html',parent:root+'parent.html'},output:{manualChunks(id){if(['/pet/environmentSchema.mjs','/pet/environmentRewards.mjs','/pet/motionPrograms.mjs','/pet/presetSchema.mjs','/pet/catalog.mjs','/src/coats.js','/pet/motion.css'].some(path=>id.endsWith(path)))return 'pet-domain';}}}},
});
