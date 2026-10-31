// One command for everything: film every take, then cut the trailers.
//   node promo/render.js             full quality → promo/out/*.mp4
//   node promo/render.js --preview   quick low-resolution pass, to check timing after changing takes or cuts
// --only=… is passed to capture.js (re-film just those takes); use edit.js on its own to re-cut without re-filming.
// A signal to this process is passed on to the running step, which shuts its Chrome down.
'use strict';
const { spawn } = require('child_process'), path = require('path');
const args = process.argv.slice(2), pass = args.filter(a => a === '--preview');
let child = null;
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { if (child) child.kill(sig); process.exitCode = 130; });
(async () => {
  for (const [script, extra] of [['capture.js', args], ['edit.js', pass]]) {
    console.log(`\n== ${script} ${extra.join(' ')}`);
    const code = await new Promise(res => { child = spawn(process.execPath, [path.join(__dirname, script), ...extra], { stdio: 'inherit' }); child.on('exit', c => res(c)); });
    child = null;
    if (code !== 0) { console.error(`${script} failed`); process.exit(code || 1); }
  }
})();
