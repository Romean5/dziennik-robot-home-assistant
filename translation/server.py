#!/usr/bin/env python3
"""Private loopback-only Argos translation endpoint for Dziennik Robót."""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ.setdefault("OMP_NUM_THREADS", "2")

import argostranslate.translate as argos_translate

HOST = "127.0.0.1"
PORT = int(os.environ.get("DZIENNIK_TRANSLATOR_PORT", "8787"))
SOURCES = {"pl", "da"}
TARGET = "en"


class Handler(BaseHTTPRequestHandler):
    server_version = "DziennikLocalTranslator/1.0"

    def _send(self, status, payload):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path != "/health":
            return self._send(404, {"error": "not_found"})
        available = {language.code for language in argos_translate.get_installed_languages()}
        self._send(200, {"ok": TARGET in available and SOURCES.issubset(available), "engine": "argos-local", "sources": sorted(SOURCES), "target": TARGET})

    def do_POST(self):
        if self.path != "/translate":
            return self._send(404, {"error": "not_found"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 24_000:
                return self._send(400, {"error": "invalid_request"})
            body = json.loads(self.rfile.read(size))
            text = str(body.get("text", "")).strip()
            source = str(body.get("sourceLanguage", ""))
            target = str(body.get("targetLanguage", ""))
            if not text or len(text) > 5_000 or source not in SOURCES or target != TARGET:
                return self._send(400, {"error": "unsupported_language_or_text"})
            translated = argos_translate.translate(text, source, target)
            if not translated:
                return self._send(503, {"error": "empty_translation"})
            return self._send(200, {"translatedText": translated, "model": "argos-local"})
        except Exception:
            return self._send(503, {"error": "translation_failed"})

    def log_message(self, _format, *_args):
        # Do not write user descriptions into access logs.
        return


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
