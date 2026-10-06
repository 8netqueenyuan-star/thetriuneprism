/* ============================================================
 * 三一棱镜 · 会诊前导聊天挂件
 * 用法：在页面 </body> 前加两行：
 *   <link rel="stylesheet" href="/path/to/prism-chat.css">
 *   <script src="/path/to/prism-chat.js"></script>
 * 挂件会自动在右下角生成，无需其他代码。
 * ============================================================ */
(function () {
  'use strict';

  /* ---------------- 配置（只改这里） ---------------- */
  var CONFIG = {
    BACKEND_URL: 'https://script.google.com/macros/s/AKfycbw9QgKYT7ChGqU6C3bi9dsdjMcu1vaXd3Qip1UHeNc3nzDSmw1Bjn0IthBWEfOgbH0p/exec', // 2026-09-29 已联通
    INTAKE_FORM_URL: 'https://form.jotform.com/262377863526064', // 《入前之问》表单（已从 consult 页核验）
    MAX_HISTORY_TURNS: 8,
    REQUEST_TIMEOUT_MS: 25000
  };

  /* ---------------- 文案（可按需要微调） ---------------- */
  var TEXT = {
    title: '棱镜前导',
    identity: 'AI 会诊前导 · 非三棱镜本人',
    welcome: '你带进来的这件事，目前最确凿的一个事实是什么？\n\n（不是你觉得什么、不是别人说了什么，是你亲眼看到或亲身经历的一件具体的事）',
    placeholder: '把你的问题带进来…',
    send: '发送',
    notReady: '前导还在准备中，过几天再来看看吧。',
    sensitiveNote: '请勿输入姓名、电话等个人隐私信息。',
    intakeButton: '填写《入前之问》 →',
    networkError: '网络开小差了，稍后再试一次好吗？',
    thinking: '正在想…'
  };


  /* ---------------- 工具 ---------------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }

  function getCid() {
    try {
      var k = 'prism_cid';
      var cid = localStorage.getItem(k);
      if (!cid) {
        cid = 'c' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem(k, cid);
      }
      return cid;
    } catch (e) { return 'global'; }
  }

  // JSONP 请求（Apps Script 不返回 CORS 头，用 JSONP 绕开）
  var cbSeq = 0;
  function jsonp(params, onDone) {
    var cbName = 'prismChatCb_' + (++cbSeq) + '_' + Date.now();
    var script = document.createElement('script');
    var timer = null;
    function cleanup() {
      if (timer) clearTimeout(timer);
      timer = null;
      try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    }
    window[cbName] = function (data) { cleanup(); onDone(null, data); };
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    script.src = CONFIG.BACKEND_URL +
      (CONFIG.BACKEND_URL.indexOf('?') >= 0 ? '&' : '?') +
      qs + '&callback=' + cbName;
    script.onerror = function () { cleanup(); onDone(new Error('network')); };
    timer = setTimeout(function () { cleanup(); onDone(new Error('timeout')); },
      CONFIG.REQUEST_TIMEOUT_MS);
    document.head.appendChild(script);
  }

  /* ---------------- 挂件 ---------------- */
  var history = []; // [{role:'user'|'model', text}]
  var formShown = false;

  function buildUI() {
    var root = document.createElement('div');
    root.className = 'prism-chat-root';
    root.innerHTML =
      '<button class="prism-bubble" aria-label="和棱镜前导聊聊">' +
        '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">' +
          '<path d="M12 2 L22 12 L12 22 L2 12 Z" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
          '<path d="M12 2 L12 22 M2 12 L22 12" stroke="currentColor" stroke-width="0.9" opacity="0.55"/>' +
        '</svg>' +
      '</button>' +
      '<div class="prism-panel" hidden>' +
        '<div class="prism-header">' +
          '<div class="prism-header-text">' +
            '<div class="prism-title">' + esc(TEXT.title) + '</div>' +
            '<div class="prism-identity">' + esc(TEXT.identity) + '</div>' +
          '</div>' +
          '<button class="prism-close" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="prism-messages"></div>' +
        '<div class="prism-input-row">' +
          '<input class="prism-input" type="text" placeholder="' + esc(TEXT.placeholder) + '" maxlength="500" />' +
          '<button class="prism-send">' + esc(TEXT.send) + '</button>' +
        '</div>' +
        '<div class="prism-sensitive">' + esc(TEXT.sensitiveNote) + '</div>' +
      '</div>';
    document.body.appendChild(root);
    return root;
  }

  function scrollDown(msgs) { msgs.scrollTop = msgs.scrollHeight; }

  function addMessage(root, who, text) {
    var msgs = root.querySelector('.prism-messages');
    var div = document.createElement('div');
    div.className = 'prism-msg prism-msg-' + who;
    div.innerHTML = nl2br(text);
    msgs.appendChild(div);
    scrollDown(msgs);
    return div;
  }

  function addTyping(root) {
    var msgs = root.querySelector('.prism-messages');
    var div = document.createElement('div');
    div.className = 'prism-msg prism-msg-model prism-typing';
    div.innerHTML = '<span></span><span></span><span></span>';
    div.setAttribute('aria-label', TEXT.thinking);
    msgs.appendChild(div);
    scrollDown(msgs);
    return div;
  }

  // 后端 reply 里带 [SHOW_FORM] 时，直接渲染《入前之问》表单按钮
  function showIntakeButton(root) {
    if (formShown) return;
    formShown = true;
    var msgs = root.querySelector('.prism-messages');
    var card = document.createElement('div');
    card.className = 'prism-msg prism-msg-model prism-email-card';
    card.innerHTML =
      '<a class="prism-intake-btn" href="' + esc(CONFIG.INTAKE_FORM_URL) + '" target="_blank" rel="noopener">' +
        esc(TEXT.intakeButton) + '</a>';
    msgs.appendChild(card);
    scrollDown(msgs);
  }

  function sendMessage(root) {
    var input = root.querySelector('.prism-input');
    var text = input.value.trim();
    if (!text) return;

    if (!CONFIG.BACKEND_URL) {
      addMessage(root, 'model', TEXT.notReady);
      input.value = '';
      return;
    }

    input.value = '';
    input.disabled = true;
    addMessage(root, 'user', text);
    // 发给后端的 history 不含本轮消息（后端会把 message 拼进 contents，避免重复）
    var histToSend = history.slice(-CONFIG.MAX_HISTORY_TURNS * 2);
    history.push({ role: 'user', text: text });
    var typing = addTyping(root);

    jsonp({
      action: 'chat',
      message: text,
      history: JSON.stringify(histToSend),
      cid: getCid()
    }, function (e, data) {
      typing.remove();
      input.disabled = false;
      input.focus();
      if (e || !data || !data.ok) {
        addMessage(root, 'model', (data && data.error) || TEXT.networkError);
        history.pop(); // 失败的用户消息不计入历史
        return;
      }
      var reply = String(data.reply || '');
      var showForm = reply.indexOf('[SHOW_FORM]') >= 0;
      reply = reply.replace('[SHOW_FORM]', '').trim();
      if (reply) {
        addMessage(root, 'model', reply);
        history.push({ role: 'model', text: reply });
      }
      if (showForm) showIntakeButton(root);
    });
  }

  function init() {
    var root = buildUI();
    var bubble = root.querySelector('.prism-bubble');
    var panel = root.querySelector('.prism-panel');
    var closeBtn = root.querySelector('.prism-close');
    var input = root.querySelector('.prism-input');
    var sendBtn = root.querySelector('.prism-send');
    var welcomed = false;

    function open() {
      panel.hidden = false;
      bubble.classList.add('prism-open');
      if (!welcomed) {
        welcomed = true;
        addMessage(root, 'model', TEXT.welcome);
      }
      setTimeout(function () { input.focus(); }, 50);
    }
    function close() {
      panel.hidden = true;
      bubble.classList.remove('prism-open');
    }

    bubble.addEventListener('click', function () {
      panel.hidden ? open() : close();
    });
    closeBtn.addEventListener('click', close);
    sendBtn.addEventListener('click', function () { sendMessage(root); });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') sendMessage(root);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
