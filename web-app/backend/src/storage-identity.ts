import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { uploadDir } from './storage';

const derive = promisify(scrypt);
export const isStorageUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
let secret: Promise<Buffer> | undefined;
async function storageSecret() {
  secret ??= (async () => {
    await fs.mkdir(uploadDir, { recursive: true });
    const file = path.join(uploadDir, '.storage-key');
    try { await fs.writeFile(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('INVALID_STORAGE_IDENTITY_FILE');
    let value = (await fs.readFile(file, 'utf8')).trim();
    // API and worker can initialize together. A second process may observe
    // the exclusive file creation just before its 64-byte write completes.
    for (let attempt = 0; value.length < 64 && attempt < 20; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 25)); value = (await fs.readFile(file, 'utf8')).trim();
    }
    if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('INVALID_STORAGE_IDENTITY_KEY');
    return Buffer.from(value, 'hex');
  })();
  return secret;
}

export async function readSignedStorage<T>(file: string, purpose: string): Promise<T | null> {
  let text: string;
  try {
    if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('INVALID_STORAGE_METADATA_FILE');
    text = await fs.readFile(file, 'utf8');
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  const envelope = JSON.parse(text) as { payload: T; signature: string };
  if (!envelope.payload || typeof envelope.signature !== 'string' || !/^[0-9a-f]{64}$/.test(envelope.signature)) throw new Error('INVALID_STORAGE_METADATA');
  const expected = createHmac('sha256', await storageSecret()).update(purpose + '\n' + JSON.stringify(envelope.payload)).digest();
  if (!timingSafeEqual(expected, Buffer.from(envelope.signature, 'hex'))) throw new Error('STORAGE_METADATA_SIGNATURE_MISMATCH');
  return envelope.payload;
}

export async function writeSignedStorage(file: string, purpose: string, payload: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const signature = createHmac('sha256', await storageSecret()).update(purpose + '\n' + JSON.stringify(payload)).digest('hex');
  const contents = JSON.stringify({ payload, signature }, null, 2) + '\n';
  try { if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('INVALID_STORAGE_METADATA_FILE'); if (await fs.readFile(file, 'utf8') === contents) return; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const temporary = file + '.tmp-' + randomUUID();
  try { await fs.writeFile(temporary, contents, { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, file); }
  finally { await fs.unlink(temporary).catch(() => undefined); }
}

async function bindingFile(email: string, password: string) {
  // A salted slow derivation plus the local secret avoids storing email,
  // plaintext passwords or password hashes in project metadata.
  const proof = await derive(password, 'ai-usage-storage:' + email.trim().toLowerCase(), 32) as Buffer;
  const fingerprint = createHmac('sha256', await storageSecret()).update(proof).digest('hex');
  const directory = path.join(uploadDir, '.owners');
  try { if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error('INVALID_STORAGE_OWNER_DIRECTORY'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return path.join(directory, fingerprint + '.json');
}
export async function recoverStorageOwner(email: string, password: string) {
  const binding = await readSignedStorage<{ namespace: string }>(await bindingFile(email, password), 'owner-binding-v1');
  if (binding && !isStorageUuid(binding.namespace)) throw new Error('INVALID_STORAGE_OWNER');
  return binding?.namespace ?? randomUUID();
}
export async function bindStorageOwner(user: { storageOwnerId: string }, email: string, password: string) {
  const file = await bindingFile(email, password);
  const existing = await readSignedStorage<{ namespace: string }>(file, 'owner-binding-v1');
  if (existing && existing.namespace !== user.storageOwnerId) throw new Error('STORAGE_OWNER_IDENTITY_CONFLICT');
  await writeSignedStorage(file, 'owner-binding-v1', { namespace: user.storageOwnerId });
}
