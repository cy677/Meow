export async function saveBlob(blob, filename) {
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

export function getRepositoryMarkup(label) {
  return `<a class="share-card-repo" href="https://github.com/ringhyacinth/Meow-Generator" target="_blank" rel="noreferrer">↗ ${label}</a>`;
}
