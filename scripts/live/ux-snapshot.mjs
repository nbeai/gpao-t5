// 실제 제품면을 같은 자로 나란히 보는 대본. 격리 Chrome만 쓰고, 받은 URL 밖은 건드리지 않는다.
import { writeFile } from 'node:fs/promises';
import { 크롬띄우기 } from './ux-cdp.mjs';

const [url, out, widthArg = '1180'] = process.argv.slice(2);
if (!url || !out) throw new Error('사용법: node scripts/live/ux-snapshot.mjs <url> <png> [폭]');
const width = Number(widthArg);
const 크롬 = await 크롬띄우기({ url, width, height: 860 });
try {
  await 크롬.준비대기('document.body && document.body.innerText.length > 0', 120);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await 크롬.send('Emulation.setDeviceMetricsOverride', {
    width, height: 860, deviceScaleFactor: 1, mobile: width <= 720,
  });
  const 화면 = await 크롬.돌리기(`(() => ({
    title: document.title,
    url: location.href.replace(/#.*$/, '#…'),
    text: document.body.innerText.slice(0, 4000),
    buttons: [...document.querySelectorAll('button')].filter((x) => {
      const r = x.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).slice(0, 40).map((x) => (x.innerText || x.getAttribute('aria-label') || x.title || '').trim()).filter(Boolean),
    nav: [...document.querySelectorAll('nav a, aside a, [role="navigation"] a')].filter((x) => {
      const r = x.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).slice(0, 40).map((x) => (x.innerText || x.getAttribute('aria-label') || '').trim()).filter(Boolean),
  }))()`);
  const shot = await 크롬.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(out, Buffer.from(shot.data, 'base64'));
  console.log(JSON.stringify({ width, out, 화면 }, null, 2));
} finally {
  await 크롬.닫기();
}
// Node 내장 fetch의 keep-alive 소켓이 계측 완료 뒤에도 대본을 붙잡지 않게 한다.
setTimeout(() => process.exit(process.exitCode ?? 0), 50);
