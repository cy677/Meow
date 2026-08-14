function getMiniToolBridge() {
  return window.xhs?.miniTool ?? null;
}

function blobToDataUri(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Image conversion failed')));
    reader.readAsDataURL(blob);
  });
}

export async function saveBlob(blob) {
  if (!blob?.type?.startsWith('image/')) {
    throw new Error('小工具只支持将图片保存到相册');
  }

  const bridge = getMiniToolBridge();
  if (!bridge?.writeTempFile || !bridge?.saveImageToPhotosAlbum) {
    throw new Error('当前环境未提供小红书相册能力');
  }

  const data = await blobToDataUri(blob);
  const tempFile = await bridge.writeTempFile({ data });
  if (!tempFile?.filePath) {
    throw new Error('临时图片写入失败');
  }
  await bridge.saveImageToPhotosAlbum({ filePath: tempFile.filePath });
}

export function getRepositoryMarkup(label) {
  return `<span class="share-card-repo" aria-label="项目地址">${label}</span>`;
}
