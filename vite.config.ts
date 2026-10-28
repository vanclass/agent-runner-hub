import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '127.0.0.1', watch: { ignored: ['**/temp/**', '**/test-results/**', '**/src-tauri/target/**'] } },
  preview: { host: '127.0.0.1' },
});
