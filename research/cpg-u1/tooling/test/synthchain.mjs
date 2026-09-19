// SYNTHETIC test chain for the self-test. Deterministic, easy-target ("synthetic-test" network) headers
// and transactions. Every "witness" and script hash here is SHA-256 filler derived from a label:
// there is no key, no signature, no wallet, and nothing is valid on any real network.
import { createHash } from 'node:crypto';
import { bitsToTarget, fromDisplay, merkleRootFromTxids, parseTransaction, sha256d, toDisplay } from '../lib/bitcoin.mjs';

export const SYNTHETIC_BITS = 0x207fffff;
const filler = (label, n = 32) => {
  const out = [];
  for (let i = 0; out.length * 32 < n; i++) out.push(createHash('sha256').update(`SYNTHETIC|${label}|${i}`).digest());
  return Buffer.concat(out).subarray(0, n);
};
export const syntheticTxid = (label) => filler(`txid|${label}`).toString('hex');

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const varint = (n) => {
  if (n < 0xfd) return Buffer.from([n]);
  const b = Buffer.alloc(3); b[0] = 0xfd; b.writeUInt16LE(n, 1); return b;
};
const push = (buf) => Buffer.concat([varint(buf.length), buf]);

export const p2wpkh = (label) => Buffer.concat([Buffer.from([0x00, 0x14]), filler(`p2wpkh|${label}`, 20)]);

/** inputs: [{txid, vout, scriptSig?}], outputs: [{value, script}]; witness=true adds SYNTHETIC filler witness items. */
export function buildTx({ inputs, outputs, witness = false, label = '' }) {
  const ins = inputs.map((i) => Buffer.concat([fromDisplay(i.txid), u32(i.vout), push(i.scriptSig ?? Buffer.alloc(0)), u32(0xfffffffd)]));
  const outs = outputs.map((o) => Buffer.concat([i64(o.value), push(o.script)]));
  const parts = [u32(2)];
  if (witness) parts.push(Buffer.from([0x00, 0x01]));
  parts.push(varint(inputs.length), ...ins, varint(outputs.length), ...outs);
  if (witness) {
    for (const i of inputs) parts.push(varint(2), push(filler(`witness-a|${label}|${i.txid}|${i.vout}`, 71)), push(filler(`witness-b|${label}|${i.txid}|${i.vout}`, 33)));
  }
  parts.push(u32(0));
  return Buffer.concat(parts).toString('hex');
}

function coinbase(height, tag) {
  const h = Buffer.alloc(3); h.writeUIntLE(height, 0, 3);
  return buildTx({
    inputs: [{ txid: '0'.repeat(64), vout: 0xffffffff, scriptSig: Buffer.concat([Buffer.from([0x03]), h, Buffer.from(`SYNTHETIC${tag}`, 'ascii')]) }],
    outputs: [{ value: 312500000, script: p2wpkh('coinbase') }],
  });
}

function mine(prevHash, merkleRoot, time, bits) {
  const target = bitsToTarget(bits);
  const b = Buffer.alloc(80);
  b.writeInt32LE(0x20000000, 0);
  fromDisplay(prevHash).copy(b, 4);
  fromDisplay(merkleRoot).copy(b, 36);
  b.writeUInt32LE(time, 68);
  b.writeUInt32LE(bits, 72);
  for (let nonce = 0; ; nonce++) {
    b.writeUInt32LE(nonce, 76);
    const hash = toDisplay(sha256d(b));
    if (BigInt(`0x${hash}`) <= target) return { hex: b.toString('hex'), hash };
  }
}

export class SynthChain {
  constructor(startHeight) { this.startHeight = startHeight; this.blocks = []; }
  get tipHeight() { return this.startHeight + this.blocks.length - 1; }
  block(h) { return this.blocks[h - this.startHeight]; }

  /** Append one block containing a coinbase plus `txs` (hex). `tag` varies the coinbase to fork deterministically. */
  add(time, txs = [], tag = '', bits = SYNTHETIC_BITS) {
    const height = this.startHeight + this.blocks.length;
    const all = [coinbase(height, tag), ...txs];
    const txids = all.map((t) => parseTransaction(t).txid);
    const prev = this.blocks.length ? this.blocks.at(-1).hash : '0'.repeat(64);
    const { hex, hash } = mine(prev, merkleRootFromTxids(txids), time, bits);
    this.blocks.push({ height, header: hex, hash, txs: all, txids, time });
    return height;
  }

  /** A copy of the chain below `height` (for forks). */
  prefix(height) {
    const c = new SynthChain(this.startHeight);
    c.blocks = this.blocks.slice(0, height - this.startHeight);
    return c;
  }

  archive(source, tip = this.tipHeight) {
    return { source, start_height: this.startHeight, headers_hex: this.blocks.slice(0, tip - this.startHeight + 1).map((b) => b.header) };
  }

  /** Inclusion evidence {tx_hex, height, merkle_branch, merkle_pos} for a transaction hex placed in the chain. */
  proof(txHex) {
    const txid = parseTransaction(txHex).txid;
    const blk = this.blocks.find((b) => b.txids.includes(txid));
    if (!blk) throw new Error(`transaction ${txid} not in synthetic chain`);
    const pos = blk.txids.indexOf(txid);
    let level = blk.txids.map(fromDisplay);
    let idx = pos;
    const branch = [];
    while (level.length > 1) {
      const sib = idx ^ 1;
      branch.push(toDisplay(level[sib] ?? level[idx]));
      const next = [];
      for (let i = 0; i < level.length; i += 2) next.push(sha256d(Buffer.concat([level[i], level[i + 1] ?? level[i]])));
      level = next;
      idx = Math.floor(idx / 2);
    }
    return { tx_hex: txHex, height: blk.height, merkle_branch: branch, merkle_pos: pos };
  }
}
