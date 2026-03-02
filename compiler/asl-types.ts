// asl/types.ts
export type AslStateMachineDefinition = {
  Comment?: string;
  StartAt: string;
  States: Record<string, unknown>;
  QueryLanguage?: "JSONata" | "JSONPath";
  Version?: string;
};