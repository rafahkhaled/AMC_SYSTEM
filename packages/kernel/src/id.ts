/**
 * Identifiers are branded strings, so a ClientId cannot be passed where a
 * TaskId belongs. The brand exists only at compile time; the runtime value is
 * an ordinary string.
 */
export type Id<TBrand extends string> = string & { readonly __brand: TBrand };

export const asId = <TBrand extends string>(value: string): Id<TBrand> => value as Id<TBrand>;

/**
 * Identity generation is a port. The production adapter produces ULIDs, which
 * sort by creation time and can be generated before the row is inserted, so an
 * aggregate and the events it records share one identifier from the start.
 */
export interface IdGenerator {
  next(): string;
}

/** A predictable generator for tests: "test-1", "test-2", and so on. */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  constructor(private readonly prefix = 'test') {}

  next(): string {
    this.counter += 1;
    return `${this.prefix}-${this.counter}`;
  }
}
