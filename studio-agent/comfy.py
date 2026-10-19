"""
Minimal ComfyUI client (standard library only).

Talks to ComfyUI on the same machine (default http://127.0.0.1:8188). ComfyUI itself is never
exposed to the internet; in the Kaggle notebook it listens on 127.0.0.1 only.
"""
from __future__ import annotations

import base64
import json
import os
import socket
import struct
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


class ComfyError(Exception):
    pass


class ComfyClient:
    def __init__(self, base_url: str, timeout: float = 15.0):
        self.base = base_url.rstrip("/")
        self.timeout = timeout
        self.client_id = uuid.uuid4().hex
        # prompt_id -> {"value": int, "max": int, "node": str|None, "updated": float}
        self.progress: dict[str, dict] = {}
        self.executing: str | None = None
        self._lock = threading.Lock()

    # ---------------------------------------------------------------- HTTP
    def _request(self, method: str, path: str, body: bytes | None = None, headers: dict | None = None, timeout: float | None = None):
        req = urllib.request.Request(self.base + path, data=body, method=method, headers=headers or {})
        try:
            return urllib.request.urlopen(req, timeout=timeout or self.timeout)
        except urllib.error.HTTPError as e:
            detail = e.read()[:2000].decode("utf-8", "replace")
            raise ComfyError(f"ComfyUI {method} {path} → HTTP {e.code}: {detail}") from None
        except (urllib.error.URLError, OSError) as e:
            raise ComfyError(f"ComfyUI is not reachable at {self.base} ({e})") from None

    def get_json(self, path: str):
        with self._request("GET", path) as r:
            return json.loads(r.read())

    def post_json(self, path: str, data) -> dict:
        body = json.dumps(data).encode()
        with self._request("POST", path, body, {"Content-Type": "application/json"}) as r:
            raw = r.read()
            return json.loads(raw) if raw.strip() else {}

    # ---------------------------------------------------------------- API
    def system_stats(self) -> dict:
        return self.get_json("/system_stats")

    def object_info(self, node_class: str) -> dict:
        return self.get_json("/object_info/" + urllib.parse.quote(node_class)).get(node_class, {})

    def queue_prompt(self, graph: dict) -> str:
        res = self.post_json("/prompt", {"prompt": graph, "client_id": self.client_id})
        if res.get("node_errors"):
            raise ComfyError("ComfyUI rejected the workflow: " + json.dumps(res["node_errors"])[:1500])
        pid = res.get("prompt_id")
        if not pid:
            raise ComfyError("ComfyUI did not return a prompt_id: " + json.dumps(res)[:500])
        return pid

    def history(self, prompt_id: str) -> dict | None:
        return self.get_json("/history/" + urllib.parse.quote(prompt_id)).get(prompt_id)

    def queue(self) -> dict:
        return self.get_json("/queue")

    def interrupt(self, prompt_id: str) -> None:
        self.post_json("/interrupt", {"prompt_id": prompt_id})

    def delete_pending(self, prompt_id: str) -> None:
        self.post_json("/queue", {"delete": [prompt_id]})

    def upload_image(self, filename: str, data: bytes, content_type: str, subfolder: str = "studio") -> str:
        """Uploads to ComfyUI's input folder. Returns the value LoadImage expects ("subfolder/name")."""
        boundary = uuid.uuid4().hex
        parts = []
        for name, value in (("type", "input"), ("subfolder", subfolder), ("overwrite", "true")):
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{filename}"\r\nContent-Type: {content_type}\r\n\r\n'.encode()
            + data + b"\r\n"
        )
        parts.append(f"--{boundary}--\r\n".encode())
        with self._request("POST", "/upload/image", b"".join(parts), {"Content-Type": f"multipart/form-data; boundary={boundary}"}, timeout=60) as r:
            res = json.loads(r.read())
        return f"{res['subfolder']}/{res['name']}" if res.get("subfolder") else res["name"]

    def download_output(self, filename: str, subfolder: str, folder_type: str, dest: str) -> int:
        q = urllib.parse.urlencode({"filename": filename, "subfolder": subfolder, "type": folder_type})
        tmp = dest + ".part"
        size = 0
        with self._request("GET", "/view?" + q, timeout=300) as r, open(tmp, "wb") as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)
                size += len(chunk)
        os.replace(tmp, dest)
        return size

    # ---------------------------------------------------------------- live progress (websocket)
    def start_progress_listener(self) -> None:
        threading.Thread(target=self._ws_loop, name="comfy-ws", daemon=True).start()

    def progress_for(self, prompt_id: str) -> dict | None:
        with self._lock:
            p = self.progress.get(prompt_id)
            return dict(p) if p else None

    def _ws_loop(self) -> None:
        while True:
            try:
                self._ws_session()
            except Exception:
                pass  # ComfyUI offline or restarted — progress is optional; status still comes from /history.
            time.sleep(3)

    def _ws_session(self) -> None:
        u = urllib.parse.urlparse(self.base)
        host, port = u.hostname or "127.0.0.1", u.port or 80
        sock = socket.create_connection((host, port), timeout=10)
        try:
            key = base64.b64encode(os.urandom(16)).decode()
            sock.sendall(
                (f"GET /ws?clientId={self.client_id} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\n"
                 f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode()
            )
            head = b""
            while b"\r\n\r\n" not in head:
                chunk = sock.recv(1024)
                if not chunk:
                    return
                head += chunk
            if b" 101 " not in head.split(b"\r\n", 1)[0]:
                return
            buf = head.split(b"\r\n\r\n", 1)[1]
            sock.settimeout(60)
            while True:
                opcode, payload, buf = self._read_frame(sock, buf)
                if opcode == 1:
                    self._on_message(payload)
                elif opcode == 9:  # ping → pong (client frames must be masked)
                    self._send_frame(sock, 10, payload)
                elif opcode == 8:
                    return
                # opcode 2 = binary preview images — ignored
        finally:
            sock.close()

    @staticmethod
    def _recv_exact(sock, buf: bytes, n: int) -> tuple[bytes, bytes]:
        while len(buf) < n:
            chunk = sock.recv(65536)
            if not chunk:
                raise ConnectionError("websocket closed")
            buf += chunk
        return buf[:n], buf[n:]

    def _read_frame(self, sock, buf: bytes):
        hdr, buf = self._recv_exact(sock, buf, 2)
        opcode = hdr[0] & 0x0F
        length = hdr[1] & 0x7F
        if length == 126:
            ext, buf = self._recv_exact(sock, buf, 2)
            length = struct.unpack(">H", ext)[0]
        elif length == 127:
            ext, buf = self._recv_exact(sock, buf, 8)
            length = struct.unpack(">Q", ext)[0]
        mask = b""
        if hdr[1] & 0x80:
            mask, buf = self._recv_exact(sock, buf, 4)
        payload, buf = self._recv_exact(sock, buf, length)
        if mask:
            payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        return opcode, payload, buf

    @staticmethod
    def _send_frame(sock, opcode: int, payload: bytes) -> None:
        mask = os.urandom(4)
        n = len(payload)
        head = bytes([0x80 | opcode])
        head += bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack(">H", n)
        sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def _on_message(self, payload: bytes) -> None:
        try:
            msg = json.loads(payload)
        except ValueError:
            return
        data = msg.get("data") or {}
        pid = data.get("prompt_id")
        with self._lock:
            if msg.get("type") == "progress" and pid:
                self.progress[pid] = {"value": int(data.get("value", 0)), "max": int(data.get("max", 0)), "node": data.get("node"), "updated": time.time()}
            elif msg.get("type") == "executing":
                self.executing = pid if data.get("node") is not None else None
            if len(self.progress) > 200:
                for old in sorted(self.progress, key=lambda k: self.progress[k]["updated"])[:100]:
                    self.progress.pop(old, None)
