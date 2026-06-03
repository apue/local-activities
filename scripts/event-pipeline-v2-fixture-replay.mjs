import { runReplayCli } from "./event-pipeline-v2-fixtures.mjs";

if (import.meta.url === `file://${process.argv[1]}`) {
  runReplayCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
