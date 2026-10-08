import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { CredentialVault } from "../../../packages/control-plane-client/src/identity.js";
export interface StorageCipher { isEncryptionAvailable(): boolean; getSelectedStorageBackend?(): string;
  encryptString(plaintext: string): Buffer; decryptString(ciphertext: Buffer): string }
const stored = z.strictObject({ origin: z.string().url(), refreshToken: z.string().min(1).max(2048) });
/** Electron safeStorage uses Keychain/DPAPI. Linux basic_text is rejected. */
export class SystemCredentialVault implements CredentialVault {
  constructor(private path: string, private cipher: StorageCipher) {}
  available() { return this.cipher.isEncryptionAvailable() && this.cipher.getSelectedStorageBackend?.() !== "basic_text"; }
  private requireSecure() { if (!this.available()) throw new Error("系统安全凭据存储不可用"); }
  async read() {
    this.requireSecure();
    try { const info = await lstat(this.path); if (!info.isFile() || info.isSymbolicLink() || info.size > 16384) throw new Error("invalid vault");
      return stored.parse(JSON.parse(this.cipher.decryptString(await readFile(this.path))));
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new Error("加密登录记录不可读取，请重新登录"); }
  }
  async write(value: { origin: string; refreshToken: string }) {
    this.requireSecure(); const plaintext = JSON.stringify(stored.parse(value));
    const ciphertext = this.cipher.encryptString(plaintext);
    await mkdir(dirname(this.path), { recursive: true }); const temporary = `${this.path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, ciphertext, { mode: 0o600, flag: "wx" }); await rename(temporary, this.path); }
    finally { await rm(temporary, { force: true }); }
  }
  async clear() { await rm(this.path, { force: true }); }
}
