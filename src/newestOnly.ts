export interface NewestOnly {
  ask(): void;
  finished(): void;
  isBusy(): boolean;
}

export function newestOnly(start: () => void): NewestOnly {
  let busy = false;
  let askedWhileBusy = false;
  const runner: NewestOnly = {
    ask() {
      if (busy) {
        askedWhileBusy = true;
        return;
      }
      busy = true;
      start();
    },
    finished() {
      busy = false;
      if (askedWhileBusy) {
        askedWhileBusy = false;
        runner.ask();
      }
    },
    isBusy: () => busy,
  };
  return runner;
}
