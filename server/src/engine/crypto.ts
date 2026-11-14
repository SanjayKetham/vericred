/**
 * SHA-256 hashing + Ed25519 signing over canonical payloads.
 *
 * The signing keypair is a FIXED, COMMITTED, NON-PRODUCTION test key held in
 * server/fixtures/issuer-keys.json. Generating a key at runtime would make the
 * dataset non-reproducible (Step 10), so the key is part of the seed material.
 * It is clearly labelled and must never be used for anything real.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as nodeSign,
  verify as nodeVerify,
  type KeyObject,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalize, type CanonicalValue } from './canonical.js';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Hash a payload via its canonical form. Returns lowercase hex, 64 chars. */
export function hashPayload(payload: CanonicalValue): string {
  return sha256Hex(canonicalize(payload));
}

interface KeyFile {
  _warning: string;
  keys: Record<string, { privateKeyPem: string; publicKeyPem: string; keyId: string; algorithm: string }>;
}

let cache: KeyFile | null = null;

function keyFile(): KeyFile {
  if (!cache) {
    const p = fileURLToPath(new URL('../../fixtures/issuer-keys.json', import.meta.url));
    cache = JSON.parse(readFileSync(p, 'utf8')) as KeyFile;
  }
  return cache;
}

/** Signing key material for an issuer, falling back to the platform root key. */
export function keysFor(issuerId: string): { priv: KeyObject; pub: KeyObject; keyId: string } {
  const f = keyFile();
  const entry = f.keys[issuerId] ?? f.keys['ROOT'];
  if (!entry) throw new Error(`No signing key for issuer ${issuerId} and no ROOT key`);
  return {
    priv: createPrivateKey(entry.privateKeyPem),
    pub: createPublicKey(entry.publicKeyPem),
    keyId: entry.keyId,
  };
}

export function publicKeyPem(issuerId: string): string {
  const f = keyFile();
  return (f.keys[issuerId] ?? f.keys['ROOT'])!.publicKeyPem;
}

/**
 * Ed25519 signature over the hex digest (not the raw payload) — so a verifier
 * can check the signature knowing only the digest, which is what the public
 * verification endpoint returns.
 */
export function signDigest(issuerId: string, digestHex: string): string {
  const { priv } = keysFor(issuerId);
  return nodeSign(null, Buffer.from(digestHex, 'utf8'), priv).toString('base64');
}

export function verifyDigestSignature(issuerId: string, digestHex: string, signatureB64: string): boolean {
  try {
    const { pub } = keysFor(issuerId);
    return nodeVerify(null, Buffer.from(digestHex, 'utf8'), pub, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

/** Stable checksum of a file's bytes — used by the reproducibility harness. */
export function sha256File(contents: string | Buffer): string {
  return createHash('sha256').update(contents).digest('hex');
}
