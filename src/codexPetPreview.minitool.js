export function createCodexPetPreview({ trigger }) {
  trigger?.remove();
  return {
    get active() {
      return false;
    },
    open: () => {},
    close: () => {},
  };
}
