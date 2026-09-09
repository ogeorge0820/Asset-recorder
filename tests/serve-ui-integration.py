from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
CHART = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/private/tmp/asset-chart-4.4.0.js')
if not CHART.is_file():
    raise SystemExit('請提供本機 Chart.js 4.4.0 檔案路徑')

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        route = self.path.split('?')[0]
        if route in ('/', '/integration.html'):
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
