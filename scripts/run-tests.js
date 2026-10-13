// Runs the test suite, and runs it once more if the first run failed.
//
// Node's test runner now and then fails a whole file before any of its tests
// start ("Unable to deserialize cloned data") - a different file each time,
// and the same file passes when run again. That turned the release checks red
// for no reason. A test that is really broken fails both runs, so nothing is
// hidden; a run that only tripped over the runner passes the second time.

const { spawnSync } = require('child_process')

function run() {
  return spawnSync(process.execPath, ['--test', ...process.argv.slice(2)], { stdio: 'inherit' }).status
}

let status = run()
if (status !== 0) {
  console.error('\n[tests] The run failed - running once more to rule out a runner hiccup.\n')
  status = run()
}
process.exit(status === null ? 1 : status)
