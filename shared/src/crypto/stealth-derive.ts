import { createHmac } from "crypto";

const MEMO_PREFIX = "SYNCRO_STEALTH_V1";

/**
 * Derives a deterministic stealth address for a subscription.
 *
 * Address = HMAC-SHA256(meta_address, `${subscriptionId}:${index}`)
 *
 * Properties:
 * - Same inputs always produce the same address (deterministic).
 * - Different indices produce different addresses (no collisions across subscriptions).
 * - On wallet recovery, iterate index 0..N to regenerate all addresses.
 *
 * @param metaAddress - The user's stealth meta-address (wallet-level secret).
 * @param subscriptionId - The subscription's unique identifier.
 * @param index - The per-subscription derivation index (starts at 0).
 * @returns A hex-encoded 32-byte stealth address string.
 */
export function deriveStealthAddress(
  metaAddress: string,
  subscriptionId: string,
  index: number,
): string {
  if (index < 0 || !Number.isInteger(index)) {
    throw new RangeError(`stealth_index must be a non-negative integer, got ${index}`);
  }
  return createHmac("sha256", metaAddress)
    .update(`${subscriptionId}:${index}`)
    .digest("hex");
}

/**
 * Encodes an ephemeral public key into Stellar memo format.
 * Format: SYNCRO_STEALTH_V1 || compressed_R (32 bytes total)
 * 
 * @param ephemeralPubkey - The ephemeral public key as hex string (32 bytes)
 * @returns Encoded memo as base64 string for Stellar memo_return field
 */
export function encodeMemoWithEphemeralPubkey(ephemeralPubkey: string): string {
  const prefix = Buffer.from(MEMO_PREFIX, "utf-8");
  const pubkeyBuffer = Buffer.from(ephemeralPubkey, "hex");

  if (pubkeyBuffer.length !== 32) {
    throw new Error(`Ephemeral pubkey must be exactly 32 bytes, got ${pubkeyBuffer.length}`);
  }

  const memoData = Buffer.concat([prefix, pubkeyBuffer]);
  return memoData.toString("base64");
}

/**
 * Decodes an ephemeral public key from Stellar memo format.
 * 
 * @param encodedMemo - The encoded memo as base64 string
 * @returns The ephemeral public key as hex string, or null if invalid
 */
export function decodeMemoToEphemeralPubkey(encodedMemo: string): string | null {
  try {
    const memoData = Buffer.from(encodedMemo, "base64");
    const prefix = Buffer.from(MEMO_PREFIX, "utf-8");
    const prefixLength = prefix.length;

    if (memoData.length < prefixLength + 32) {
      return null;
    }

    const storedPrefix = memoData.subarray(0, prefixLength);
    if (!storedPrefix.equals(prefix)) {
      return null;
    }

    const pubkeyBytes = memoData.subarray(prefixLength, prefixLength + 32);
    return pubkeyBytes.toString("hex");
  } catch {
    return null;
  }
}

/**
 * Checks if a memo matches the SYNCRO_STEALTH_V1 prefix.
 * 
 * @param encodedMemo - The encoded memo as base64 string
 * @returns true if memo has the stealth prefix, false otherwise
 */
export function isStellarMemoStealth(encodedMemo: string): boolean {
  try {
    const memoData = Buffer.from(encodedMemo, "base64");
    const prefix = Buffer.from(MEMO_PREFIX, "utf-8");
    return memoData.subarray(0, prefix.length).equals(prefix);
  } catch {
    return false;
  }
}
