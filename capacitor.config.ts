import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'local.xiaoka.diary',
  appName: '行食记',
  webDir: process.env.XINGSHIJI_WEB_DIR || process.env.XIAOKA_WEB_DIR || 'dist',
  ios: { contentInset: 'never', backgroundColor: '#F7F7FC' },
};
export default config;
