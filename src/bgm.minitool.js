export function createRandomBgm(button) {
  button?.closest('.music-tool')?.remove();
  return {
    audio: null,
    resume: async () => {},
    pause: () => {},
    next: async () => {},
    getState: () => ({
      playing: false,
      currentIndex: -1,
      source: null,
      volume: 0,
    }),
  };
}
