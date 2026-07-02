// SSH / wp-cli helpers for the live WordPress adapter. Ported from VOBET blog-project
// (getSSH / wpCli / sshPutBuffer / sshRm / sshClose). One lazily-opened connection per process.
//
// Env: WP_SSH_HOST, WP_SSH_USER, WP_SSH_PORT (default 22), WP_PATH (WordPress install path),
//      and ONE of: WP_SSH_KEY_PATH (path to a private-key file) | WP_SSH_KEY (inline PEM,
//      "\n"-escaped allowed). node-ssh is an optional dependency (installed at live-wiring time).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let _ssh = null;

function privateKey(env) {
  if (env.WP_SSH_KEY_PATH) return fs.readFileSync(env.WP_SSH_KEY_PATH, 'utf8');
  if (env.WP_SSH_KEY) return env.WP_SSH_KEY.replace(/\\n/g, '\n');
  return undefined; // allow password/agent auth if neither is set
}

export async function getSSH(env = process.env) {
  if (_ssh) return _ssh;
  const { NodeSSH } = await import('node-ssh').catch(() => {
    throw new Error('node-ssh not installed — run `npm install node-ssh` for live WordPress');
  });
  const ssh = new NodeSSH();
  await ssh.connect({
    host: env.WP_SSH_HOST,
    username: env.WP_SSH_USER,
    privateKey: privateKey(env),
    password: env.WP_SSH_PASSWORD || undefined,
    port: parseInt(env.WP_SSH_PORT ?? '22', 10),
    readyTimeout: 30000,
    hostVerifier: () => true,
  });
  _ssh = ssh;
  return _ssh;
}

export async function sshClose() {
  if (_ssh) { _ssh.dispose(); _ssh = null; }
}

// Run a wp-cli command at WP_PATH. Throws on non-zero exit with no stdout (matches VOBET semantics).
export async function wpCli(args, env = process.env) {
  const ssh = await getSSH(env);
  const result = await ssh.execCommand(`wp ${args} --path="${env.WP_PATH}"`);
  if (result.code !== 0 && !result.stdout.trim()) {
    throw new Error(`WP-CLI(${result.code}): ${result.stderr || 'no output'}`);
  }
  return result.stdout.trim();
}

export async function sshPutBuffer(buffer, remotePath, env = process.env) {
  const ssh = await getSSH(env);
  const tmpFile = path.join(os.tmpdir(), `snb_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(tmpFile, buffer);
  try { await ssh.putFile(tmpFile, remotePath); }
  finally { try { fs.unlinkSync(tmpFile); } catch { /* ignore */ } }
}

export async function sshRm(remotePath, env = process.env) {
  const ssh = await getSSH(env);
  await ssh.execCommand(`rm -f "${remotePath}"`);
}
