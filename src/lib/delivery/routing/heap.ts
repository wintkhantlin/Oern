/** Binary min-heap of (key, node) pairs, for lazy-deletion shortest-path search. */
export class MinHeap {
  private keys: number[] = [];
  private nodes: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  /** Smallest key, or Infinity when empty. */
  peekKey(): number {
    return this.keys.length ? this.keys[0] : Number.POSITIVE_INFINITY;
  }

  peekNode(): number {
    return this.nodes.length ? this.nodes[0] : -1;
  }

  push(key: number, node: number): void {
    const keys = this.keys;
    const nodes = this.nodes;
    let i = keys.length;
    keys.push(key);
    nodes.push(node);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      keys[i] = keys[parent];
      nodes[i] = nodes[parent];
      i = parent;
    }
    keys[i] = key;
    nodes[i] = node;
  }

  /** Removes the smallest entry; returns false when empty. Read it via the
   * `lastKey` / `lastNode` fields. */
  lastKey = 0;
  lastNode = -1;
  pop(): boolean {
    const keys = this.keys;
    const nodes = this.nodes;
    if (keys.length === 0) return false;
    this.lastKey = keys[0];
    this.lastNode = nodes[0];
    const key = keys.pop() as number;
    const node = nodes.pop() as number;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      while (true) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= key) break;
        keys[i] = keys[c];
        nodes[i] = nodes[c];
        i = c;
      }
      keys[i] = key;
      nodes[i] = node;
    }
    return true;
  }
}
