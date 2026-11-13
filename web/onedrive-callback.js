window.msalRedirectBridge.broadcastResponseToMainFrame().catch(() => {
  document.querySelector('p').textContent = '登录未完成，请关闭此窗口并重试。';
});
