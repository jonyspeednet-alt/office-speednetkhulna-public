const createBrowserPool = ({ maxConcurrent = 1, maxWaiting = 10, waitTimeoutMs = 30000 } = {}) => {
  let active = 0;
  const waiters = [];
  const releaseForSlot = () => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const waiter = waiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(releaseForSlot());
      } else active--;
    };
  };
  return async () => {
    if (active < maxConcurrent) {
      active++;
      return releaseForSlot();
    }
    if (waiters.length >= maxWaiting) throw new Error('Screenshot queue is full. Please retry.');
    return new Promise((resolve, reject) => {
      const waiter = { resolve };
      waiter.timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index !== -1) waiters.splice(index, 1);
        reject(new Error('Screenshot queue timed out. Please retry.'));
      }, waitTimeoutMs);
      waiters.push(waiter);
    });
  };
};

const launchBrowserWithSlot = async (puppeteer, options, acquire) => {
  const release = await acquire();
  let browser;
  try {
    browser = await puppeteer.launch(options);
  } catch (error) {
    release();
    throw error;
  }
  return { browser, closeBrowser: async () => {
    try { await browser.close(); } finally { release(); }
  } };
};

module.exports = { createBrowserPool, launchBrowserWithSlot };
