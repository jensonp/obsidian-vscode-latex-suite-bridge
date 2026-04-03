function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDebouncedAsyncTask(task, delayMs) {
  let timer = null;
  let running = false;
  let queued = false;

  async function runTask() {
    if (running) {
      queued = true;
      return;
    }

    running = true;
    try {
      await task();
    } finally {
      running = false;
      if (queued) {
        queued = false;
        schedule();
      }
    }
  }

  function schedule() {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      void runTask();
    }, delayMs);
  }

  function dispose() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return {
    trigger: schedule,
    dispose,
  };
}

module.exports = {
  createDebouncedAsyncTask,
  sleep,
};
