import type { JsonataSlot } from "./jsonata";
import type { TaskArgumentValue } from "./task";
import { TaskBuilder } from "./task";

export class LambdaInvokeBuilder extends TaskBuilder {
  constructor(name: string) {
    super(name);
    this.resource("arn:aws:states:::lambda:invoke");
  }

  functionName(value: string | JsonataSlot): this {
    return this.argument("FunctionName", value);
  }

  payload(value: TaskArgumentValue): this {
    return this.argument("Payload", value);
  }

  qualifier(value: string | JsonataSlot): this {
    return this.argument("Qualifier", value);
  }

  invocationType(value: string): this {
    return this.argument("InvocationType", value);
  }

  clientContext(value: string | JsonataSlot): this {
    return this.argument("ClientContext", value);
  }
}

export function lambdaInvoke(name: string): LambdaInvokeBuilder {
  return new LambdaInvokeBuilder(name);
}
