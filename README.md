# ThreadClip

在瀏覽 [Threads](https://www.threads.com) 時，於每支貼文影片的右上角加入下載按鈕，一鍵把影片存到電腦。

## 安裝（開發者模式）

1. 開啟 `chrome://extensions`
2. 打開右上角「開發人員模式」
3. 點「載入未封裝項目」，選擇本專案資料夾
4. 前往 Threads，影片右上角會出現下載按鈕

影片會存到「下載／ThreadClip」資料夾，檔名格式為 `threads_<帳號>_<貼文代碼>.mp4`（多影片貼文會加上 `_1`、`_2`…）。

## 架構

```
content.js  ──(videoUrl, filename)──▶  background.js  ──▶  offscreen.js
 偵測影片、插入按鈕                     建立 offscreen、     抓取影片、寫入中繼資料、
                                       呼叫 downloads API   產生 blob URL
```

- `src/mp4-metadata.js`：純 JavaScript 的 MP4 box 編輯器，在 `moov/udta/meta/ilst` 寫入標籤，並修正 `stco`／`co64`／`tfhd` 的絕對位移，不重新編碼影片。
- 影片抓取在 offscreen document 中進行，靠 `host_permissions` 繞過 CDN 的 CORS 限制。

## 測試

需要安裝 ffmpeg（測試會產生各種結構的 MP4，寫入標籤後用 ffprobe 驗證，並比對解碼雜湊確保影音資料未損壞）。

```sh
npm test
```

## 打包上架

```sh
npm run package
```

會產生 `threadclip-<版本>.zip`，上傳到 [Chrome Web Store 開發人員資訊主頁](https://chrome.google.com/webstore/devconsole)。商店表單要填的文字在 `store/listing.md`，隱私權政策在 `PRIVACY.md`。
