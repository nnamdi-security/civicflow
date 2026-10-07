/** Injected time source. Domain code never reads the system clock directly. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function fixedClock(at: Date): Clock & { advance(ms: number): void } {
  let current = at.getTime();
  return {
    now: () => new Date(current),
    advance: (ms) => {
      current += ms;
    },
  };
}
