#!/usr/bin/env python3
import http.server
import socketserver
import sys

PORT = 8000
if len(sys.argv) > 1:
    PORT = int(sys.argv[1])

class CORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # We must establish Cross-Origin-Isolation for WebAssembly SharedArrayBuffer to work safely!
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        # Ensure our blobs/CDN fetches don't get blocked
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

Handler = CORSRequestHandler

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serving heavily-threaded webapps at http://localhost:{PORT}")
    print("Cross-Origin-Isolation headers are ACTIVE (SAB enabled).")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
