import logger from "../config/logger";
import { rpc as SorobanRpc } from "@stellar/stellar-sdk";
import { isStellarMemoStealth, decodeMemoToEphemeralPubkey } from "../../../shared/src/crypto/stealth-derive";
import { supabase } from "../config/database";
import { resolveStellarNetwork } from "../../../shared/blockchain-flags";

export interface StealthPaymentDetection {
  transactionHash: string;
  ledgerSequence: number;
  ephemeralPubkey: string;
  timestamp: string;
}

/**
 * Scans Stellar transactions for stealth payments by matching memo prefix.
 * Identifies transactions with SYNCRO_STEALTH_V1 encoded ephemeral public keys.
 */
export class StealthScanner {
  private rpcUrl: string;

  constructor(rpcUrl?: string) {
    this.rpcUrl = rpcUrl || (process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org");
  }

  /**
   * Scans a specific transaction for stealth payment memo.
   *
   * @param transactionHash - The transaction hash to scan
   * @returns StealthPaymentDetection if stealth payment found, null otherwise
   */
  async scanTransaction(transactionHash: string): Promise<StealthPaymentDetection | null> {
    try {
      const rpc = new SorobanRpc.Server(this.rpcUrl);
      const tx = await rpc.getTransaction(transactionHash);

      if (!tx) {
        return null;
      }

      const ephemeralPubkey = this.extractEphemeralPubkeyFromTransaction(tx);
      if (!ephemeralPubkey) {
        return null;
      }

      return {
        transactionHash,
        ledgerSequence: tx.ledger_sequence,
        ephemeralPubkey,
        timestamp: tx.created_at,
      };
    } catch (err) {
      logger.warn(`Failed to scan transaction ${transactionHash}:`, err);
      return null;
    }
  }

  /**
   * Scans a range of ledgers for stealth payments.
   *
   * @param startLedger - Starting ledger sequence
   * @param endLedger - Ending ledger sequence
   * @returns Array of detected stealth payments
   */
  async scanLedgerRange(startLedger: number, endLedger: number): Promise<StealthPaymentDetection[]> {
    const results: StealthPaymentDetection[] = [];

    try {
      const rpc = new SorobanRpc.Server(this.rpcUrl);

      for (let ledger = startLedger; ledger <= endLedger; ledger++) {
        try {
          const transactions = await rpc.getNetwork().getTransactions({ ledger });

          for (const tx of transactions.records || []) {
            const ephemeralPubkey = this.extractEphemeralPubkeyFromTransaction(tx);
            if (ephemeralPubkey) {
              results.push({
                transactionHash: tx.hash,
                ledgerSequence: tx.ledger_sequence,
                ephemeralPubkey,
                timestamp: tx.created_at,
              });
            }
          }
        } catch (err) {
          logger.warn(`Failed to scan ledger ${ledger}:`, err);
          continue;
        }
      }

      return results;
    } catch (err) {
      logger.error(`Ledger range scan failed [${startLedger}-${endLedger}]:`, err);
      return results;
    }
  }

  /**
   * Extracts ephemeral public key from transaction memo if it matches stealth format.
   *
   * @param transaction - The Stellar transaction object
   * @returns The ephemeral public key as hex string, or null if not a stealth payment
   */
  private extractEphemeralPubkeyFromTransaction(transaction: any): string | null {
    if (!transaction.memo || transaction.memo_type !== "return") {
      return null;
    }

    if (!isStellarMemoStealth(transaction.memo)) {
      return null;
    }

    return decodeMemoToEphemeralPubkey(transaction.memo);
  }

  /**
   * Records a detected stealth payment in the database.
   *
   * @param detection - The detected stealth payment
   * @param subscriptionId - The subscription this payment is for (optional)
   */
  async recordStealthPayment(
    detection: StealthPaymentDetection,
    subscriptionId?: string
  ): Promise<void> {
    try {
      await supabase.from("stealth_payments").insert({
        transaction_hash: detection.transactionHash,
        ledger_sequence: detection.ledgerSequence,
        ephemeral_pubkey: detection.ephemeralPubkey,
        subscription_id: subscriptionId || null,
        detected_at: new Date().toISOString(),
        blockchain_timestamp: detection.timestamp,
      });

      logger.info("Recorded stealth payment:", { hash: detection.transactionHash, subscriptionId });
    } catch (err) {
      logger.error("Failed to record stealth payment:", err);
    }
  }
}

export const stealthScanner = new StealthScanner();
