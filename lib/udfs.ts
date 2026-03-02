
import { udf } from "../dsl/jsonata";

export const bar = udf(() => "BAR");
export const foo_bar = udf(() => "FOO_BAR");
export default udf((x: string) => `DEFAULT_${x}`);
