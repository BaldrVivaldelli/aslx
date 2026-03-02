export type AslStateMachineDefinition = {
  Comment?: string;
  StartAt: string;
  QueryLanguage?: "JSONata" | "JSONPath";
  Version?: string;
  States: Record<string, any>;
};