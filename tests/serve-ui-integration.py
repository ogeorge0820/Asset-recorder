from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
CHART = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/private/tmp/asset-chart-4.4.0.js')
if not CHART.is_file():
    raise SystemExit('請提供本機 Chart.js 4.4.0 檔案路徑')

COMPARE_HTML = """<!doctype html><html lang="zh-TW"><meta charset="utf-8"><title>並排驗收</title>
<style>body{margin:0;font:13px/1.6 -apple-system,'PingFang TC',sans-serif;background:#dde6ee}
.bar{display:flex;gap:6px;padding:8px 12px;align-items:center;flex-wrap:wrap}
.bar button{padding:6px 12px;cursor:pointer}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 8px 8px;height:calc(100vh - 60px)}
.cols.mobile{grid-template-columns:390px 390px;justify-content:center}
.col{display:flex;flex-direction:column;background:#fff;border:1px solid #9db3c6;min-width:0}
.col h2{margin:0;padding:5px 10px;font-size:12px;background:#203449;color:#fff;font-weight:500}
iframe{border:0;width:100%;flex:1}</style>
<div class="bar"><b>並排驗收</b>
<button onclick="go('總覽','overview')">總覽</button>
<button onclick="go('管理','management')">管理</button>
<button onclick="go('人生規劃','dwz')">人生規劃</button>
<button onclick="go('指標','indicators')">指標</button>
<button onclick="go('新聞','news')">新聞</button>
<button onclick="go('質押','staking')">質押</button>
<button onclick="document.querySelector('.cols').classList.toggle('mobile')">手機寬度</button>
<label><input type="checkbox" id="sync" checked>同步捲動</label></div>
<div class="cols">
<div class="col"><h2>核准預覽稿 ui-preview.html</h2><iframe id="f1" src="/ui-preview.html"></iframe></div>
<div class="col"><h2>整合版 integration.html（示意資料）</h2><iframe id="f2" src="/integration.html"></iframe></div>
</div>
<script>
function go(p, t) {
  try { f1.contentWindow.navigatePage(p); } catch (e) {}
  try { f2.contentWindow.switchTab(t); } catch (e) {}
  try { f1.contentWindow.scrollTo(0, 0); f2.contentWindow.scrollTo(0, 0); } catch (e) {}
}
let lock = false;
function hook(a, b) {
  a.contentWindow.addEventListener('scroll', () => {
    if (!sync.checked || lock) return;
    lock = true;
    const ra = a.contentWindow, rb = b.contentWindow;
    const denom = Math.max(1, ra.document.documentElement.scrollHeight - ra.innerHeight);
    const pct = ra.scrollY / denom;
    rb.scrollTo(0, pct * Math.max(0, rb.document.documentElement.scrollHeight - rb.innerHeight));
    requestAnimationFrame(() => { lock = false; });
  });
}
f1.onload = () => hook(f1, f2);
f2.onload = () => hook(f2, f1);
</script></html>"""

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        route = self.path.split('?')[0]
        if route == '/compare.html':
            self.send_response(200)
            body = COMPARE_HTML.encode()
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'self'; connect-src 'none'; img-src data:; form-action 'none'; base-uri 'none'; object-src 'none'")
            self.end_headers()
            self.wfile.write(body)
            return
        if route == '/ui-preview.html':
            body, mime = (ROOT / 'ui-preview.html').read_bytes(), 'text/html; charset=utf-8'
        elif route in ('/', '/integration.html'):
            html = (ROOT / 'index.html').read_text()
            html = re.sub(r'<script\b[^>]*>.*?</script>', '', html, flags=re.S)
            html = re.sub(r'<link\b[^>]*>', lambda m: m[0] if re.search(r'href="(?:theme|style)\.css', m[0]) else '', html)
            html = html.replace('</body>', '<script src="/chart.js"></script><script src="/test-app.js"></script><script src="/fixture.js"></script></body>')
            body, mime = html.encode(), 'text/html; charset=utf-8'
        elif route == '/test-app.js':
            source = (ROOT / 'app.js').read_text()
            # 排除整段正式啟動流程，避免測試登入、遷移與排程。
            marker = "document.addEventListener('DOMContentLoaded', () => {"
            assert source.count(marker) == 1
            body, mime = source.split(marker)[0].encode(), 'text/javascript; charset=utf-8'
        elif route in ('/theme.css', '/style.css', '/fixture.js', '/chart.js'):
            file = {'/fixture.js': ROOT / 'tests/ui-integration-fixture.js', '/chart.js': CHART}.get(route, ROOT / route[1:])
            body = file.read_bytes()
            mime = 'text/css' if route.endswith('.css') else 'text/javascript; charset=utf-8'
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src data:; font-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'")
        self.end_headers()
        self.wfile.write(body)

ThreadingHTTPServer(('127.0.0.1', 5187), Handler).serve_forever()
