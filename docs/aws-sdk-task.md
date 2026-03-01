# AWS SDK Task Sugar

`awsSdkTask(...)` is a thin convenience layer on top of `task(...)`.

Use it when you want the ergonomics of `.service(...)` and `.action(...)` while preserving the exact same normalized graph, validation, and ASL emission pipeline used by plain `task(...)`.

## Example

```ts
awsSdkTask("GetPackage")
  .comment("Loads the package definition from DynamoDB.")
  .service("dynamodb")
  .action("getItem")
  .arguments({
    TableName: "${file(resources/index.json):tables.providers}",
    Key: packageKey(),
  })
  .output(getPackageOutput())
  .next("ArePreparedModulesValid");
```

This emits the same resource as:

```ts
task("GetPackage")
  .resource("arn:aws:states:::aws-sdk:dynamodb:getItem")
  .arguments({
    TableName: "${file(resources/index.json):tables.providers}",
    Key: packageKey(),
  })
  .output(getPackageOutput())
  .next("ArePreparedModulesValid");
```

## Why it exists

- keeps authoring closer to the AWS domain vocabulary
- avoids repeating full `arn:aws:states:::aws-sdk:...` strings
- reuses the same `task(...)` semantics under the hood

## Current scope

`awsSdkTask(...)` is intended for singular SDK integrations such as:

- `dynamodb:getItem`
- `dynamodb:putItem`
- `dynamodb:updateItem`
- `dynamodb:deleteItem`

Collection-oriented or many-item workflows should still be modeled through a domain Lambda or a future collection primitive.
