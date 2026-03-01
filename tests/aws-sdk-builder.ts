import assert from 'node:assert/strict';

import { awsSdkTask } from '../dsl/aws-sdk';

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: 'builds the expected aws-sdk resource from service and action',
    run: () => {
      const built = awsSdkTask('GetPackage')
        .service('dynamodb')
        .action('getItem')
        .end()
        .build();

      assert.equal(built.resource, 'arn:aws:states:::aws-sdk:dynamodb:getItem');
      assert.equal(built.end, true);
    },
  },
  {
    name: 'supports api(...) as a shorthand',
    run: () => {
      const built = awsSdkTask('PutItem')
        .api('dynamodb', 'putItem')
        .end()
        .build();

      assert.equal(built.resource, 'arn:aws:states:::aws-sdk:dynamodb:putItem');
    },
  },
  {
    name: 'rejects builds without a service',
    run: () => {
      assert.throws(
        () => awsSdkTask('Broken').action('getItem').end().build(),
        /must declare service/,
      );
    },
  },
  {
    name: 'rejects builds without an action',
    run: () => {
      assert.throws(
        () => awsSdkTask('Broken').service('dynamodb').end().build(),
        /must declare action/,
      );
    },
  },
];

let failures = 0;
for (const test of tests) {
  try {
    test.run();
    console.log(`✅ ${test.name}`);
  } catch (error: unknown) {
    failures += 1;
    console.error(`❌ ${test.name}`);
    console.error(error instanceof Error ? error.stack : String(error));
  }
}

if (failures > 0) {
  console.error(`\n${failures} awsSdkTask test(s) failed.`);
  process.exit(1);
}

console.log(`\n${tests.length} awsSdkTask test(s) passed.`);
