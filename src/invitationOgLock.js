/** Jedan Playwright OG render u isto vrijeme — ne guši VPS i API. */
let chain = Promise.resolve();

export function withOgRenderLock(task) {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
