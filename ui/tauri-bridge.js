(function () {
  var invoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
  if (!invoke) return;

  function parseCanvas(file) {
    if (!file || !file.text) return null;
    var parsed = JSON.parse(file.text);
    if (file.path) document.title = 'ICE Canvas - ' + file.path;
    return parsed;
  }

  async function open() {
    try {
      var file = await invoke('open_canvas_dialog');
      if (!file) return null;
      var parsed = parseCanvas(file);
      if (parsed && window.ICECanvasLoadDocument) {
        window.ICECanvasLoadDocument(parsed, '열었습니다');
      }
      return file.path || null;
    } catch (err) {
      console.error(err);
      if (window.ICECanvasToast) window.ICECanvasToast('열기에 실패했습니다');
      return null;
    }
  }

  async function save(text, title) {
    return invoke('save_canvas', { text: text, title: title || 'canvas' });
  }

  async function saveAs(text, title) {
    return invoke('save_canvas_as', { text: text, title: title || 'canvas' });
  }

  async function saveAttachment(dataUrl, filename) {
    return invoke('save_attachment', { dataUrl: dataUrl, filename: filename || 'attachment' });
  }

  async function openInBrowser(url) {
    return invoke('open_in_browser', { url: url });
  }

  window.ICECanvasNative = { open: open, save: save, saveAs: saveAs, saveAttachment: saveAttachment, openInBrowser: openInBrowser };

  invoke('get_startup_canvas').then(function (file) {
    if (!file) return;
    var parsed = parseCanvas(file);
    if (parsed && window.ICECanvasLoadDocument) {
      window.ICECanvasLoadDocument(parsed, null);
    }
  }).catch(function (err) {
    console.error(err);
  });
})();
