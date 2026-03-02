import { stateMachine } from "../dsl/state-machine";
import { pass } from "../dsl/steps";
import { echoOutput } from "../slots/echo";

export const echoFlow = stateMachine("EchoFlow")
  .queryLanguage("JSONata")
  .comment("Echoes the input back")
  .startWith(
    pass("Echo")
      .content(echoOutput())
      .end(),
  );
