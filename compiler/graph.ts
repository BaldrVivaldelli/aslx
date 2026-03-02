import type { AslStateMachineDefinition } from "./emit-asl";

type MachineLike = {
  StartAt: string;
  States: Record<string, any>;
};

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, "_");
}

function escapeLabel(raw: string): string {
  return raw.replace(/"/g, "\\\"");
}

function shorten(raw: string, max = 60): string {
  if (raw.length <= max) return raw;
  return raw.slice(0, Math.max(0, max - 1)) + "…";
}

function describeChoice(choice: any): string {
  // JSONata uses Condition; JSONPath typically uses Variable + operator fields
  if (typeof choice?.Condition === "string") return choice.Condition;
  if (typeof choice?.Variable === "string") return choice.Variable;
  return "choice";
}

function terminalStateNames(machine: MachineLike): string[] {
  const terminals: string[] = [];
  for (const [name, state] of Object.entries(machine.States)) {
    if (state?.End === true || state?.Type === "Succeed" || state?.Type === "Fail") {
      terminals.push(name);
    }
  }
  return terminals;
}

function renderMachine(
  machine: MachineLike,
  prefix: string,
  lines: string[],
  indent: string,
): { startId: string; terminalIds: string[] } {
  // Declare nodes
  for (const [name, state] of Object.entries(machine.States)) {
    const id = sanitizeId(prefix + name);
    const label = `${name}\\n(${state?.Type ?? "State"})`;
    lines.push(`${indent}${id}["${escapeLabel(label)}"]`);
  }

  // Declare edges
  for (const [name, state] of Object.entries(machine.States)) {
    const from = sanitizeId(prefix + name);

    // Catch edges
    if (Array.isArray(state?.Catch)) {
      for (const catcher of state.Catch) {
        if (!catcher?.Next) continue;
        const to = sanitizeId(prefix + catcher.Next);
        const errors = Array.isArray(catcher.ErrorEquals) ? catcher.ErrorEquals.join(",") : "error";
        lines.push(`${indent}${from} -->|"catch ${escapeLabel(shorten(errors, 40))}"| ${to}`);
      }
    }

    if (state?.Type === "Choice") {
      if (Array.isArray(state?.Choices)) {
        for (const choice of state.Choices) {
          if (!choice?.Next) continue;
          const to = sanitizeId(prefix + choice.Next);
          const label = shorten(describeChoice(choice), 60);
          lines.push(`${indent}${from} -->|"${escapeLabel(label)}"| ${to}`);
        }
      }
      if (state?.Default) {
        const to = sanitizeId(prefix + state.Default);
        lines.push(`${indent}${from} -->|"default"| ${to}`);
      }
      continue;
    }

    // Next edge
    if (state?.Next) {
      const to = sanitizeId(prefix + state.Next);
      lines.push(`${indent}${from} --> ${to}`);
    }
  }

  // Recurse into Parallel branches and Map item processors
  for (const [name, state] of Object.entries(machine.States)) {
    const from = sanitizeId(prefix + name);

    if (state?.Type === "Parallel" && Array.isArray(state?.Branches)) {
      const joinId = sanitizeId(prefix + name + "__join");
      lines.push(`${indent}${joinId}((join))`);
      lines.push(`${indent}${from} --> ${joinId}`);

      for (let i = 0; i < state.Branches.length; i += 1) {
        const branch = state.Branches[i] as MachineLike;
        const branchPrefix = prefix + name + `__branch${i}__`;
        const subgraphId = sanitizeId(branchPrefix + "subgraph");
        lines.push(`${indent}subgraph ${subgraphId}["${escapeLabel(`${name} / Branch ${i}`)}"]`);
        const rendered = renderMachine(branch, branchPrefix, lines, indent + "  ");
        lines.push(`${indent}end`);

        // entry edge
        lines.push(`${indent}${from} -->|"branch ${i}"| ${rendered.startId}`);

        // exit edges to join
        for (const terminalId of rendered.terminalIds) {
          lines.push(`${indent}${terminalId} --> ${joinId}`);
        }
      }

      // Connect join to the parallel's Next (if any) using already-rendered Next edge
      // (we don't special-case End here; top-level renderer will connect Ends to END)
    }

    if (state?.Type === "Map" && state?.ItemProcessor?.States && state?.ItemProcessor?.StartAt) {
      const processor = state.ItemProcessor as MachineLike;
      const processorPrefix = prefix + name + "__item__";
      const subgraphId = sanitizeId(processorPrefix + "subgraph");
      const joinId = sanitizeId(prefix + name + "__join");
      lines.push(`${indent}${joinId}((join))`);
      lines.push(`${indent}${from} --> ${joinId}`);

      lines.push(`${indent}subgraph ${subgraphId}["${escapeLabel(`${name} / ItemProcessor`)}"]`);
      const rendered = renderMachine(processor, processorPrefix, lines, indent + "  ");
      lines.push(`${indent}end`);

      lines.push(`${indent}${from} -->|"each item"| ${rendered.startId}`);

      for (const terminalId of rendered.terminalIds) {
        lines.push(`${indent}${terminalId} --> ${joinId}`);
      }
      // Next edge already emitted above (from -> Next). This join is informative.
    }
  }

  const startId = sanitizeId(prefix + machine.StartAt);
  const terminalIds = terminalStateNames(machine).map((name) => sanitizeId(prefix + name));
  return { startId, terminalIds };
}

export function renderMermaid(definition: AslStateMachineDefinition): string {
  const lines: string[] = [];
  lines.push("flowchart TD");
  const start = "_start";
  const end = "_end";
  lines.push(`  ${start}((start))`);
  lines.push(`  ${end}((end))`);

  const rendered = renderMachine(definition as unknown as MachineLike, "main__", lines, "  ");
  lines.push(`  ${start} --> ${rendered.startId}`);

  for (const terminalId of rendered.terminalIds) {
    lines.push(`  ${terminalId} --> ${end}`);
  }

  return lines.join("\n") + "\n";
}
