import { lstat } from 'node:fs/promises';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readLimited } from './library.js';
import { writeJson } from '../scripts/host-lib.mjs';

export const SESSION_SECONDS = 365 * 24 * 60 * 60;
const lifetime = SESSION_SECONDS * 1000;
const renewalInterval = 24 * 60 * 60 * 1000;
const maximumDevices = 200;

export class DeviceSessions {
  private readonly sessions = new Map<string, number>();
  private readonly tokenHash: string;
  private constructor(private readonly file: string, private readonly token: string, private readonly now: () => number) {
    this.tokenHash = createHash('sha256').update(token).digest('hex');
  }
  static async open(file: string, token: string, now: () => number = Date.now): Promise<DeviceSessions> {
    const store = new DeviceSessions(file, token, now);
    try {
      if ((await lstat(file)).isSymbolicLink()) throw new Error('Remembered-browser state must not be redirected.');
      const data = JSON.parse((await readLimited(file, 128 * 1024)).toString('utf8'));
      if (data?.schemaVersion !== 1 || !Array.isArray(data.sessions) || data.sessions.length > maximumDevices || !/^[a-f0-9]{64}$/.test(data.tokenHash)) throw new Error('Invalid remembered-browser state.');
      if (data.tokenHash === store.tokenHash) {
        for (const entry of data.sessions) {
          if (typeof entry?.hash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.hash) || !Number.isSafeInteger(entry.expires) || entry.expires > now() + lifetime) throw new Error('Invalid remembered-browser session.');
          if (entry.expires > now()) store.sessions.set(entry.hash, entry.expires);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Cannot load remembered-browser state. Stop the service and inspect .state/device-sessions.json or reset generated state.');
    }
    return store;
  }
  private hash(value: string): string { return createHmac('sha256', this.token).update(value).digest('hex'); }
  private save(): Promise<void> {
    return writeJson(this.file, { schemaVersion: 1, tokenHash: this.tokenHash, sessions: [...this.sessions].map(([hash, expires]) => ({ hash, expires })) });
  }
  async issue(existing?: string): Promise<string> {
    for (const [hash, expires] of this.sessions) if (expires <= this.now()) this.sessions.delete(hash);
    if (existing && /^[A-Za-z0-9_-]{43}$/.test(existing) && this.sessions.has(this.hash(existing))) {
      this.sessions.set(this.hash(existing), this.now() + lifetime);
      await this.save();
      return existing;
    }
    if (this.sessions.size >= maximumDevices) throw new Error('Too many remembered browsers. Sign out unused browsers or reset generated state.');
    const credential = randomBytes(32).toString('base64url');
    this.sessions.set(this.hash(credential), this.now() + lifetime);
    await this.save();
    return credential;
  }
  async authenticate(credential: string): Promise<{ valid: boolean; renew?: boolean }> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(credential)) return { valid: false };
    const hash = this.hash(credential), expires = this.sessions.get(hash);
    if (!expires || expires <= this.now()) { this.sessions.delete(hash); return { valid: false }; }
    if (expires - this.now() <= lifetime - renewalInterval) {
      this.sessions.set(hash, this.now() + lifetime); await this.save();
      return { valid: true, renew: true };
    }
    return { valid: true };
  }
  async revoke(credential: string): Promise<void> {
    this.sessions.delete(this.hash(credential)); await this.save();
  }
}
