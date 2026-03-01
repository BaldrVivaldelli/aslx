import { TaskBuilder } from "./task";

function toAwsSdkResource(service: string, action: string): string {
  return `arn:aws:states:::aws-sdk:${service}:${action}`;
}

export class AwsSdkTaskBuilder extends TaskBuilder {
  private serviceName?: string;
  private actionName?: string;

  constructor(name: string) {
    super(name);
  }

  service(value: string): this {
    this.serviceName = value;
    this.syncResource();
    return this;
  }

  action(value: string): this {
    this.actionName = value;
    this.syncResource();
    return this;
  }

  api(service: string, action: string): this {
    this.serviceName = service;
    this.actionName = action;
    this.syncResource();
    return this;
  }

  override build() {
    const missingParts: string[] = [];
    if (!this.serviceName) missingParts.push("service");
    if (!this.actionName) missingParts.push("action");

    if (missingParts.length > 0) {
      throw new Error(
        `AWS SDK task state ${this.node.name} must declare ${missingParts.join(" and ")}`,
      );
    }

    this.syncResource();
    return super.build();
  }

  private syncResource(): void {
    if (!this.serviceName || !this.actionName) {
      return;
    }

    super.resource(toAwsSdkResource(this.serviceName, this.actionName));
  }
}

export function awsSdkTask(name: string): AwsSdkTaskBuilder {
  return new AwsSdkTaskBuilder(name);
}
