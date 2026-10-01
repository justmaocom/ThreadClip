// Offscreen document：負責抓取影片、寫入中繼資料、產生 blob URL。
// Service worker 沒有 URL.createObjectURL，所以這段工作放在這裡。
import { injectMetadata } from './mp4-metadata.js';
import { SOURCE_URL } from './config.js';

const blobUrls = new Set();

async function processVideo({ videoUrl, postUrl }) {
  const response = await fetch(videoUrl, { credentials: 'omit' });
  if (!response.ok) throw new Error(`影片下載失敗（HTTP ${response.status}）`);
  const original = new Uint8Array(await response.arrayBuffer());

  let output = original;
  let tagged = true;
  try {
    output = injectMetadata(original, {
      comment: SOURCE_URL,
      freeform: {
        source: SOURCE_URL,
        ...(postUrl ? { original_post: postUrl } : {}),
      },
    });
  } catch (error) {
    // 格式不如預期時仍讓使用者拿到原始影片
    console.warn('[ThreadClip] 寫入中繼資料失敗，改存原始檔', error);
    tagged = false;
  }

  const blobUrl = URL.createObjectURL(new Blob([output], { type: 'video/mp4' }));
  blobUrls.add(blobUrl);
  return { blobUrl, tagged };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return false;

  if (message.type === 'process') {
    processVideo(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'revoke' && blobUrls.delete(message.blobUrl)) {
    URL.revokeObjectURL(message.blobUrl);
  }
  return false;
});
