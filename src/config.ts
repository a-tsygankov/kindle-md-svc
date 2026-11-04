import { loadConfig } from '../scripts/host-lib.mjs';

export interface SmtpConfig {
  enabled: boolean; host: string; port: number; security: 'tls' | 'starttls' | 'none';
  from: string; to: string; user: string; passwordEnv: string; maxAttachmentBytes: number;
}
export interface Config {
  schemaVersion: 1; sourceDir: string; pandocPath: string; browserPath: string;
  listenHost: string; port: number; smtp: SmtpConfig;
}
export async function getConfig(repo: string): Promise<Config> { return await loadConfig(repo) as Config; }
