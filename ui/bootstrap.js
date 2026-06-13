(function () {
  var sample = {
    title: '새 캔버스',
    slug: 'ice-canvas',
    nodes: [
      { id: 'n-start', type: 'text', text: '자료를 카드로 올려놓고 연결하세요.\n\nCtrl+S: 저장\n열기: .icv 파일 불러오기', x: 40, y: 30, width: 320, height: 150 },
      { id: 'n-group', type: 'group', label: '프로젝트', x: 410, y: 20, width: 380, height: 250 },
      { id: 'n-link', type: 'link', label: '참고 링크', url: 'https://icenovel.com', x: 455, y: 90, width: 250, height: 80 }
    ],
    edges: [{ id: 'e-start', fromNode: 'n-start', fromSide: 'right', toNode: 'n-link', toSide: 'left' }]
  };
  var source = sample;
  document.querySelector('.canvas-title').textContent = source.title;
  window.__CANVAS__ = {
    slug: source.slug,
    title: source.title,
    data: { nodes: source.nodes, edges: source.edges },
    isAdmin: true,
    vis: 1,
    saveUrl: null,
    uploadUrl: null
  };
})();
