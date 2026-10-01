# ThreadClip 隱私權政策

最後更新：2026-10-01

ThreadClip 是一個 Chrome 擴充功能，讓你在瀏覽 Threads 時下載貼文中的影片。

## 我們不收集任何資料

ThreadClip **不會收集、儲存、傳送或分享**任何使用者資料，包括個人身分資訊、瀏覽紀錄、帳號資訊或使用行為。擴充功能沒有任何分析、追蹤或廣告程式碼，也不會連線到開發者的伺服器。

## 擴充功能在你的裝置上做了什麼

- **讀取 Threads 頁面**：在 threads.com／threads.net 上找出影片並插入下載按鈕。當影片以串流方式播放時，會在你的瀏覽器內重新讀取該貼文頁面，以找出影片檔的網址。這些內容只在本機處理，不會傳送到任何地方。
- **下載影片**：只有在你按下下載按鈕時，才會從 Threads 的影片 CDN（cdninstagram.com、fbcdn.net）下載該影片。
- **寫入來源資訊**：下載的 MP4 檔案中會寫入中繼資料標籤，內容為 `https://justmao.com` 與原始貼文網址，方便日後辨識影片來源。影片的影音內容不會被修改或重新編碼。
- **儲存檔案**：影片透過 Chrome 的下載功能存到你電腦「下載／ThreadClip」資料夾。

## 權限說明

| 權限 | 用途 |
| --- | --- |
| `downloads` | 把影片存到你的電腦 |
| `offscreen` | 在背景處理影片檔、寫入來源資訊 |
| threads.com／threads.net | 在頁面上顯示下載按鈕 |
| cdninstagram.com／fbcdn.net | 下載影片檔 |

## 聯絡方式

如有任何問題，請到 <https://github.com/justmaocom/ThreadClip/issues> 回報，或透過 <https://justmao.com> 聯絡。

ThreadClip 與 Meta Platforms, Inc. 或 Threads 沒有任何關聯。
