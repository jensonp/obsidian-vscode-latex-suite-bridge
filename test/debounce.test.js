const test = require("node:test");
const assert = require("node:assert/strict");

const { createDebouncedAsyncTask, sleep } = require("../lib/debounce");

test("debounced task coalesces rapid triggers", async () => {
  let runs = 0;
  const debounced = createDebouncedAsyncTask(async () => {
    runs += 1;
  }, 20);

  debounced.trigger();
  debounced.trigger();
  debounced.trigger();

  await sleep(60);
  debounced.dispose();

  assert.equal(runs, 1);
});

test("debounced task re-runs after queueing while in-flight", async () => {
  let runs = 0;
  const debounced = createDebouncedAsyncTask(async () => {
    runs += 1;
    await sleep(30);
  }, 10);

  debounced.trigger();
  await sleep(15);
  debounced.trigger();
  debounced.trigger();

  await sleep(120);
  debounced.dispose();

  assert.equal(runs, 2);
});
