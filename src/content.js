// 在 Threads 頁面上的每支影片右上角加入下載按鈕
(() => {
  const BUTTON_CLASS = 'threadclip-btn';
  const POST_PATH = /\/@([^/]+)\/post\/([^/?#]+)/;
  const buttons = new WeakMap();

  const ICONS = {
    // 與擴充功能圖示相同的「線收束成下載箭頭」
    idle: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 3.75C14.25 4.5 14.25 7.5 12 9v6"/><path d="M7.5 12l4.5 4.5 4.5-4.5"/><path d="M6.75 19.5h10.5"/></g></svg>',
    loading: '<svg viewBox="0 0 24 24" aria-hidden="true" class="threadclip-spin"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-dasharray="38 100" stroke-linecap="round"/></svg>',
    done: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    error: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.5v7m0 4h.01" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
  };
  const LABELS = { idle: '下載', loading: '下載中', done: '完成', error: '失敗' };

  function setState(button, state, title) {
    button.dataset.state = state;
    button.innerHTML = `${ICONS[state]}<span>${LABELS[state]}</span>`;
    button.title = title;
    button.setAttribute('aria-label', title);
  }

  // 從影片往上找最近一個含有貼文連結的祖先元素，視為這支影片所屬的貼文
  function findPostInfo(video) {
    for (let el = video.parentElement; el && el !== document.body; el = el.parentElement) {
      for (const link of el.querySelectorAll('a[href*="/post/"]')) {
        const match = link.pathname.match(POST_PATH);
        if (match) {
          return { username: match[1], code: match[2], postUrl: `${location.origin}/@${match[1]}/post/${match[2]}`, container: el };
        }
      }
    }
    const match = location.pathname.match(POST_PATH);
    if (match) {
      return { username: match[1], code: match[2], postUrl: `${location.origin}/@${match[1]}/post/${match[2]}`, container: document.body };
    }
    return { username: 'unknown', code: String(Date.now()), postUrl: null, container: document.body };
  }

  function directVideoUrl(video) {
    const candidates = [video.currentSrc, video.src, ...Array.from(video.querySelectorAll('source'), (s) => s.src)];
    return candidates.find((url) => url && /^https?:/.test(url)) ?? null;
  }

  // 影片使用 blob:（MediaSource）時，改從貼文頁面的內嵌 JSON 找出 video_versions 的網址
  async function lookupVideoUrlFromPost(postUrl, index) {
    if (!postUrl) return null;
    const html = await (await fetch(postUrl, { credentials: 'include' })).text();
    const urls = [];
    for (const match of html.matchAll(/"video_versions":\[\{[^\]]*?"url":"((?:[^"\\]|\\.)+)"/g)) {
      const url = JSON.parse(`"${match[1]}"`);
      if (!urls.includes(url)) urls.push(url);
    }
    return urls[index] ?? urls[0] ?? null;
  }

  async function download(video, button) {
    if (button.dataset.state === 'loading') return;
    setState(button, 'loading', '下載中…');

    try {
      const { username, code, postUrl, container } = findPostInfo(video);
      const videosInPost = Array.from(container.querySelectorAll('video'));
      const index = Math.max(0, videosInPost.indexOf(video));
      const videoUrl = directVideoUrl(video) ?? (await lookupVideoUrlFromPost(postUrl, index));
      if (!videoUrl) throw new Error('找不到影片來源網址');

      const suffix = videosInPost.length > 1 ? `_${index + 1}` : '';
      const response = await chrome.runtime.sendMessage({
        type: 'download',
        videoUrl,
        postUrl,
        filename: `threads_${username}_${code}${suffix}.mp4`,
      });
      if (!response?.ok) throw new Error(response?.error ?? '下載失敗');

      setState(button, 'done', response.tagged ? '已下載' : '已下載（未能寫入來源資訊）');
    } catch (error) {
      console.error('[ThreadClip]', error);
      setState(button, 'error', `下載失敗：${error.message}`);
    }
    setTimeout(() => setState(button, 'idle', '下載影片'), 3000);
  }

  function createButton(video) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS;
    setState(button, 'idle', '下載影片');
    videoOf.set(button, video);
    return button;
  }

  // Threads 會在影片上方疊一層透明的點擊層（點了會暫停影片），按鈕本身收不到事件。
  // 因此在 window 的 capture 階段依座標判斷是否點在按鈕上，搶在 Threads 之前攔下事件。
  const videoOf = new WeakMap();

  function hitButton(event) {
    const direct = event.target instanceof Element && event.target.closest(`.${BUTTON_CLASS}`);
    if (direct) return direct;

    const point = event.changedTouches?.[0] ?? event;
    const { clientX: x, clientY: y } = point;
    if (x == null || y == null) return null;

    for (const button of document.querySelectorAll(`.${BUTTON_CLASS}`)) {
      const rect = button.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      // 只有最上層元素仍屬於同一支影片的區塊時才算數，避免對話框蓋住時誤觸
      const topmost = document.elementFromPoint(x, y);
      const video = videoOf.get(button);
      if (topmost && video && findPostInfo(video).container.contains(topmost)) return button;
    }
    return null;
  }

  function intercept(event) {
    const button = hitButton(event);
    if (!button) return;
    event.stopImmediatePropagation();
    if (event.type === 'click') {
      event.preventDefault();
      const video = videoOf.get(button);
      if (video) download(video, button);
    }
  }

  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click', 'dblclick']) {
    window.addEventListener(type, intercept, { capture: true });
  }

  function attach(video) {
    const existing = buttons.get(video);
    if (existing?.isConnected) return;

    const host = video.parentElement;
    if (!host) return;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    const button = existing ?? createButton(video);
    host.appendChild(button);
    buttons.set(video, button);
  }

  let scheduled = false;
  function scan() {
    scheduled = false;
    document.querySelectorAll('video').forEach(attach);
  }

  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(scan);
  }).observe(document.documentElement, { childList: true, subtree: true });

  scan();
})();
