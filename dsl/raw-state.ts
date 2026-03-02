import type { StateMachineQueryLanguage } from './state-machine';

/**
 * Escape hatch node that allows you to inject a raw ASL state object.
 *
 * - The emitter will render any JsonataSlot values nested anywhere inside `asl`.
 * - Validation is best-effort (we validate reachability and basic structure).
 */
export type RawStateNode = {
  kind: 'raw';
  name: string;
  asl: unknown;
  comment?: string;
  /** Optional per-state QueryLanguage override (JSONata or JSONPath). */
  queryLanguage?: StateMachineQueryLanguage;
};

export class RawStateBuilder {
  private node: RawStateNode;

  constructor(name: string, asl: unknown) {
    this.node = { kind: 'raw', name, asl };
  }

  comment(text: string): this {
    this.node.comment = text;
    return this;
  }

  queryLanguage(lang: StateMachineQueryLanguage): this {
    this.node.queryLanguage = lang;
    return this;
  }

  /**
   * Convenience: set `Next` on the raw ASL state.
   * This mutates the internal raw object if it's an object.
   */
  next(name: string): this {
    if (this.node.asl && typeof this.node.asl === 'object') {
      (this.node.asl as any).Next = name;
      // If someone accidentally had End=true, normalize.
      if ((this.node.asl as any).End === true) delete (this.node.asl as any).End;
    }
    return this;
  }

  /**
   * Convenience: set `End: true` on the raw ASL state.
   * This mutates the internal raw object if it's an object.
   */
  end(): this {
    if (this.node.asl && typeof this.node.asl === 'object') {
      (this.node.asl as any).End = true;
      if ((this.node.asl as any).Next !== undefined) delete (this.node.asl as any).Next;
    }
    return this;
  }

  build(): RawStateNode {
    // Clone the raw object shallowly to reduce accidental sharing.
    const asl = this.node.asl;
    const clonedAsl = asl && typeof asl === 'object'
      ? Array.isArray(asl)
        ? asl.slice()
        : { ...(asl as any) }
      : asl;

    return {
      ...this.node,
      asl: clonedAsl,
    };
  }
}

export function rawState(name: string, asl: unknown): RawStateBuilder {
  return new RawStateBuilder(name, asl);
}
