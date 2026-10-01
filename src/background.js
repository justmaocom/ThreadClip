import { DOWNLOAD_FOLDER } from './config.js';

const OFFSCREEN_PATH = 'src/offscreen.html';
// downloadId → blobUrl，下載結束後通知 offscreen 釋放記憶體
const pendingBlobs = new Map();
let creatingOffscreen = null;

async function ensureOffscreen() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });
  if (contexts.length > 0) return;

  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['BLOBS'],
      justification: '將寫入中繼資料後的影片轉成 blob URL 以供下載',
    })
    .finally(() => {
      creatingOffscreen = null;
    });
  await creatingOffscreen;
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 150);
}

async function handleDownload({ videoUrl, postUrl, filename }) {
  await ensureOffscreen();
  const result = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'process', videoUrl, postUrl });
  if (!result?.ok) throw new Error(result?.error ?? '處理影片時發生未知錯誤');

  const downloadId = await chrome.downloads.download({
    url: result.blobUrl,
    filename: `${DOWNLOAD_FOLDER}/${sanitizeFilename(filename)}`,
    conflictAction: 'uniquify',
  });
  pendingBlobs.set(downloadId, result.blobUrl);
  return { tagged: result.tagged };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 只處理來自 content script 的請求；offscreen 的訊息由 offscreen 自己處理
  if (message?.type !== 'download' || !sender.tab) return false;

  handleDownload(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.downloads.onChanged.addListener(({ id, state }) => {
  if (!state || state.current === 'in_progress') return;
  const blobUrl = pendingBlobs.get(id);
  if (!blobUrl) return;
  pendingBlobs.delete(id);
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'revoke', blobUrl }).catch(() => {});
});
