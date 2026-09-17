import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
export default defineConfig({
  root,base:'./',
  server:{fs:{allow:[fileURLToPath(new URL('..',import.meta.url))],deny:['**/.env','**/.env.*','**/*.{crt,pem,key,p12,pfx}','**/.git/**','**/pet/data/**','**/pet/certs/**','**/*.sqlite','**/*.sqlite-*']}},
  build:{outDir:'dist',emptyOutDir:true,rollupOptions:{input:{child:root+'index.html',parent:root+'parent.html'}}},
});
