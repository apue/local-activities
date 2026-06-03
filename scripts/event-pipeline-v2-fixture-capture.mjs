import { runCaptureCli } from "./event-pipeline-v2-fixtures.mjs";

if (import.meta.url === `file://${process.argv[1]}`) {
  runCaptureCli()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
