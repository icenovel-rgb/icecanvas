(function () {
  document.querySelector('[data-act="new-local"]').addEventListener('click', function () {
    if (!confirm('새 캔버스를 만들까요? 저장하지 않은 변경은 사라질 수 있습니다.')) return;
    location.reload();
  });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'o' || e.key === 'O')) {
      e.preventDefault();
      if (window.ICECanvasNative) window.ICECanvasNative.open();
    }
  }, true);
})();
