/**
 * Wrapper passed to steps that have a Gherkin data table.
 *
 *   | name  | role  |
 *   | alice | admin |
 *
 * table.raw()        -> [['name','role'],['alice','admin']]
 * table.rows()       -> [['alice','admin']]            (header dropped)
 * table.hashes()     -> [{ name: 'alice', role: 'admin' }]
 * table.rowsHash()   -> { name: 'role', alice: 'admin' } (2-column tables only)
 * table.asObjects(m) -> typed objects via a row mapper
 */
export class DataTable {
  constructor(private readonly cells: readonly (readonly string[])[]) {}

  raw(): string[][] {
    return this.cells.map((r) => [...r]);
  }

  header(): string[] {
    return [...(this.cells[0] ?? [])];
  }

  rows(): string[][] {
    return this.cells.slice(1).map((r) => [...r]);
  }

  hashes(): Record<string, string>[] {
    const header = this.header();
    return this.rows().map((row) => {
      const o: Record<string, string> = {};
      header.forEach((h, i) => (o[h] = row[i] ?? ''));
      return o;
    });
  }

  rowsHash(): Record<string, string> {
    const o: Record<string, string> = {};
    for (const r of this.cells) {
      if (r.length !== 2) throw new Error(`rowsHash() needs a 2-column table, got a row with ${r.length} cells`);
      o[r[0]!] = r[1]!;
    }
    return o;
  }

  /** Map each hash row to a typed object. Throw inside the mapper to reject bad rows. */
  asObjects<T>(mapper: (row: Record<string, string>, index: number) => T): T[] {
    return this.hashes().map(mapper);
  }

  transpose(): DataTable {
    const width = Math.max(0, ...this.cells.map((r) => r.length));
    const out: string[][] = [];
    for (let c = 0; c < width; c++) out.push(this.cells.map((r) => r[c] ?? ''));
    return new DataTable(out);
  }
}

/** Value passed to steps that have a doc string. Behaves like a string. */
export class DocString extends String {
  constructor(
    readonly content: string,
    readonly mediaType?: string,
  ) {
    super(content);
  }
}
