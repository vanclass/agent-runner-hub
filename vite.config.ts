import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '127.0.0.1', watch: { ignored: ['**/temp/**', '**/test-results/**', '**/src-tauri/target/**', '**/local/hub-native/target/**', '**/local/native-probe/target/**', '**/.project-config/managed/**/cache/**', '**/.project-config/tools/**/.local/**'] } },
  preview: { host: '127.0.0.1' },
});
