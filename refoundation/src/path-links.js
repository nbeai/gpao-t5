function wholeLineSegment(text) {
  const start = text.search(/\S/);
  if (start < 0) return [];
  const end = text.search(/\s*$/);
  const path = text.slice(start, end);
  const absolute = path.startsWith('/')
    || /^[A-Za-z]:[\\/]/.test(path)
    || /^\\\\[^\\]+\\[^\\]+/.test(path);
  return absolute && !/^https?:\/\//i.test(path) ? [{ start, end, path }] : [];
}

export function absolutePathSegments(input, { wholeLine = false } = {}) {
  const text = String(input ?? '');
  if (wholeLine) return wholeLineSegment(text);
  const found = [];
  const pattern = /[A-Za-z]:\\[^\s<>"'`]+|\/(?!\/)[^\s<>"'`]+/g;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    if (start > 0 && text[start - 1] === '/') continue;
    if (match[0].startsWith('/') && start > 0 && /[\p{L}\p{N}_.-]/u.test(text[start - 1])) continue;
    if (/https?:\/$/i.test(text.slice(Math.max(0, start - 8), start))) continue;
    let path = match[0];
    path = path.replace(/[.,;:!?)}\]]+$/, '');
    if (path === '/') continue;
    found.push({ start, end: start + path.length, path });
  }
  return found;
}

function segmentsForNode(node) {
  if (node.parentElement?.tagName !== 'CODE') return absolutePathSegments(node.data);
  const segments = [];
  let offset = 0;
  for (const line of node.data.split('\n')) {
    for (const segment of absolutePathSegments(line, { wholeLine: true })) {
      segments.push({ ...segment, start: segment.start + offset, end: segment.end + offset });
    }
    offset += line.length + 1;
  }
  return segments;
}

function linkifyTextNode(node) {
  if (!node.data || node.parentElement?.closest('a,script,style,textarea')) return;
  const segments = segmentsForNode(node);
  if (!segments.length) return;
  const fragment = node.ownerDocument.createDocumentFragment();
  let cursor = 0;
  for (const segment of segments) {
    fragment.append(node.data.slice(cursor, segment.start));
    const link = node.ownerDocument.createElement('a');
    link.href = '#';
    link.className = 't5-path-link';
    link.dataset.t5Path = segment.path;
    link.title = '파일 탐색기에서 보기';
    link.textContent = node.data.slice(segment.start, segment.end);
    fragment.append(link);
    cursor = segment.end;
  }
  fragment.append(node.data.slice(cursor));
  node.replaceWith(fragment);
}

export function linkifyPaths(root) {
  const document = root.ownerDocument ?? root;
  const walker = document.createTreeWalker(root, globalThis.NodeFilter?.SHOW_TEXT ?? 4);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) linkifyTextNode(node);
}

function install() {
  const style = document.createElement('style');
  style.textContent = '.t5-path-link{color:inherit;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px;cursor:pointer}.t5-path-link:hover{text-decoration-style:solid}';
  document.head.append(style);

  const enhance = (root = document) => {
    if (root.nodeType === 1 && root.matches?.('.bot')) linkifyPaths(root);
    root.querySelectorAll?.('.bot').forEach(linkifyPaths);
  };
  enhance();
  new MutationObserver((changes) => {
    for (const change of changes) {
      const element = change.target.nodeType === 1 ? change.target : change.target.parentElement;
      const answer = element?.closest?.('.bot');
      if (answer) linkifyPaths(answer);
      for (const node of change.addedNodes ?? []) enhance(node);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  document.addEventListener('click', async (event) => {
    const link = event.target.closest?.('a.t5-path-link');
    if (!link) return;
    event.preventDefault();
    const response = await fetch('/computer/reveal', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-t5-console-action': 'reveal' },
      body: JSON.stringify({ path: link.dataset.t5Path }),
    });
    if (!response.ok) link.title = '이 경로를 열지 못했어요';
  });
}

if (typeof document !== 'undefined') install();
