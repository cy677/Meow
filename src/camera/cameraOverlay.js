/** Definite pixel sizing avoids cyclic percentage heights in grid/iframe layouts. */
export function getFrameSize(width, height) {
  const availableWidth = Math.max(0, width - 64);
  const availableHeight = Math.max(0, height - 148);
  const frameHeight = Math.min(760, availableHeight, availableWidth * 4 / 3);
  return { width: frameHeight * 3 / 4, height: frameHeight };
}

export function createCameraOverlay({viewport, overlay, shell, onLayout = () => {}}) {
  let active = false;
  let disposed = false;
  let previousFocus;
  const resize = () => {
    if (disposed || !active) return;
    const rect = viewport.getBoundingClientRect();
    const size = getFrameSize(rect.width, rect.height);
    shell.style.width = `${size.width}px`;
    shell.style.height = `${size.height}px`;
    onLayout();
  };
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(viewport);
  window.addEventListener('resize', resize);
  return {
    open() {
      if (disposed) throw new Error('拍照界面已销毁');
      if (!active) previousFocus = document.activeElement;
      active = true;
      overlay.hidden = false;
      overlay.setAttribute('aria-hidden', 'false');
      viewport.dataset.shareCardOpen = 'true';
      resize();
      // Do not wait for a second animation frame to make the frame visible.
      overlay.classList.add('is-open');
    },
    close() {
      active = false;
      overlay.classList.remove('is-open');
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      viewport.dataset.shareCardOpen = 'false';
      previousFocus?.focus?.({preventScroll:true});
    },
    dispose() {
      if (disposed) return;
      this.close(); disposed = true;
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      overlay.remove();
    },
  };
}
