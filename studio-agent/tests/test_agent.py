"""
Plumbing tests for agent.py against a FAKE ComfyUI (no GPU, no model).
They prove auth, uploads, validation, job tracking, output collection and range streaming work.
They do NOT prove real video generation — that needs the studio computer (see README "First real test").

    python -m unittest discover -s tests      (run from studio-agent/)
"""
import base64
import hashlib
import hmac
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import agent as agent_mod  # noqa: E402

SECRET = "s" * 48
ORIGIN = "https://studio.example"
FAKE_MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 4000
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100


def token(scope="agent", exp_in=600, secret=SECRET):
    payload = base64.urlsafe_b64encode(json.dumps({"exp": int(time.time()) + exp_in, "scope": scope}).encode()).rstrip(b"=").decode()
    body = f"v1.{payload}"
    sig = base64.urlsafe_b64encode(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
    return f"{body}.{sig}"


class FakeComfy(BaseHTTPRequestHandler):
    prompts: dict = {}
    graphs: list = []
    fail_next = False

    def log_message(self, *a):
        pass

    def _json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        p = self.path
        if p == "/system_stats":
            return self._json({"system": {"os": "nt", "ram_total": 32 * 1024**3, "comfyui_version": "test"},
                               "devices": [{"name": "cuda:0 NVIDIA Test GPU", "type": "cuda", "vram_total": 12 * 1024**3, "vram_free": 11 * 1024**3}]})
        if p.startswith("/object_info/"):
            name = p.split("/")[-1]
            files = {"UNETLoader": ("unet_name", "wan2.2_ti2v_5B_fp16.safetensors"), "CLIPLoader": ("clip_name", "umt5_xxl_fp8_e4m3fn_scaled.safetensors"),
                     "VAELoader": ("vae_name", "wan2.2_vae.safetensors")}
            if name in files:
                k, v = files[name]
                return self._json({name: {"input": {"required": {k: [[v]]}}}})
            return self._json({name: {"input": {}}})
        if p == "/queue":
            # Each prompt is "running" for one poll, then finishes.
            running = [[0, pid, {}, {}, []] for pid, st in self.prompts.items() if st == "queued"]
            for item in running:
                FakeComfy.prompts[item[1]] = "done"
            return self._json({"queue_running": running, "queue_pending": []})
        if p.startswith("/history/"):
            pid = p.split("/")[-1]
            if self.prompts.get(pid) == "done":
                return self._json({pid: {"status": {"status_str": "success", "completed": True}, "outputs": {"58": {"images": [{"filename": f"{pid}_00001_.mp4", "subfolder": "studio", "type": "output"}], "animated": [True]}}}})
            if self.prompts.get(pid) == "error":
                return self._json({pid: {"status": {"status_str": "error", "completed": False, "messages": [["execution_error", {"exception_message": "CUDA out of memory. Tried to allocate"}]]}, "outputs": {}}})
            return self._json({})
        if p.startswith("/view?"):
            self.send_response(200)
            self.send_header("Content-Length", str(len(FAKE_MP4)))
            self.end_headers()
            self.wfile.write(FAKE_MP4)
            return
        self._json({}, 404)

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        if self.path == "/prompt":
            graph = json.loads(body)["prompt"]
            FakeComfy.graphs.append(graph)
            pid = f"p{len(self.prompts)}"
            FakeComfy.prompts[pid] = "error" if FakeComfy.fail_next else "queued"
            FakeComfy.fail_next = False
            return self._json({"prompt_id": pid, "number": 1, "node_errors": {}})
        if self.path == "/upload/image":
            assert b'name="image"' in body
            return self._json({"name": "ref.png", "subfolder": "studio", "type": "input"})
        if self.path in ("/interrupt", "/queue"):
            return self._json({})
        self._json({}, 404)


class AgentTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.comfy = ThreadingHTTPServer(("127.0.0.1", 0), FakeComfy)
        threading.Thread(target=cls.comfy.serve_forever, daemon=True).start()
        cls.tmp = tempfile.mkdtemp()
        cls.agent = agent_mod.Agent({"secret": SECRET, "allowed_origins": [ORIGIN], "data_dir": cls.tmp,
                                     "comfy_url": f"http://127.0.0.1:{cls.comfy.server_address[1]}"})
        cls.agent.ffprobe = None
        agent_mod.Handler.agent = cls.agent
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), agent_mod.Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.comfy.shutdown()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def call(self, method, path, data=None, raw=None, ctype=None, tok=None, headers=None):
        h = {"Origin": ORIGIN, **(headers or {})}
        if tok != "":  # "" = no Authorization header (like a <video>/<img> request)
            h["Authorization"] = f"Bearer {tok or token()}"
        body = raw
        if data is not None:
            body = json.dumps(data).encode()
            h["Content-Type"] = "application/json"
        if ctype:
            h["Content-Type"] = ctype
        req = urllib.request.Request(self.base + path, data=body, method=method, headers=h)
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, r.read(), dict(r.headers)
        except urllib.error.HTTPError as e:
            return e.code, e.read(), dict(e.headers)

    def project_id(self):
        _, b, _ = self.call("GET", "/projects")
        return json.loads(b)["projects"][0]["id"]

    def test_rejects_missing_wrong_and_expired_tokens(self):
        self.assertEqual(self.call("GET", "/health", tok="nope")[0], 401)
        self.assertEqual(self.call("GET", "/health", tok=token(exp_in=-5))[0], 401)
        self.assertEqual(self.call("GET", "/health", tok=token(scope="session"))[0], 401)
        self.assertEqual(self.call("GET", "/health", tok=token(secret="x" * 48))[0], 401)
        status, _, headers = self.call("GET", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), ORIGIN)

    def test_cors_only_for_allowed_origin(self):
        _, _, headers = self.call("GET", "/health", headers={"Origin": "https://evil.example"})
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_capabilities_reports_hardware_and_models(self):
        status, body, _ = self.call("GET", "/capabilities")
        caps = json.loads(body)
        self.assertEqual(status, 200)
        self.assertTrue(caps["comfy"]["online"])
        self.assertEqual(caps["hardware"]["vram_gb"], 12.0)
        self.assertTrue(all(w["available"] for w in caps["workflows"]))

    def test_upload_validation(self):
        self.assertEqual(self.call("POST", "/uploads", raw=b"not an image", ctype="image/png")[0], 400)
        self.assertEqual(self.call("POST", "/uploads", raw=PNG, ctype="image/gif")[0], 400)
        status, body, _ = self.call("POST", "/uploads", raw=PNG, ctype="image/png")
        self.assertEqual(status, 201)
        uid = json.loads(body)["id"]
        self.assertEqual(self.call("GET", f"/uploads/{uid}?t={token()}", tok="")[0], 200)  # query token for <img>
        self.assertEqual(self.call("GET", f"/uploads/{uid}", tok="")[0], 401)
        self.assertEqual(self.call("GET", "/uploads/..%2f..%2fstate.json")[0], 404)

    def test_param_validation(self):
        pid = self.project_id()
        bad = [{"prompt": "", "size": "16x9"}, {"prompt": "x", "size": "4k"}, {"prompt": "x", "size": "16x9", "frames": 50},
               {"prompt": "x", "size": "16x9", "frames": 500}, {"prompt": "x", "size": "16x9", "steps": 1000}]
        for params in bad:
            status, body, _ = self.call("POST", "/jobs", {"workflow": "wan22-t2v", "project_id": pid, "params": params})
            self.assertEqual(status, 400, params)
        status, _, _ = self.call("POST", "/jobs", {"workflow": "wan22-i2v", "project_id": pid, "params": {"prompt": "x", "size": "16x9"}})
        self.assertEqual(status, 400)  # image required

    def test_image_to_video_job_end_to_end_with_fake_comfy(self):
        pid = self.project_id()
        _, body, _ = self.call("POST", "/uploads", raw=PNG, ctype="image/png")
        uid = json.loads(body)["id"]
        status, body, _ = self.call("POST", "/jobs", {"workflow": "wan22-i2v", "project_id": pid, "upload_id": uid,
                                                      "params": {"prompt": "slow push-in", "size": "9x16", "frames": 49, "steps": 12, "seed": 7}})
        self.assertEqual(status, 201, body)
        job = json.loads(body)
        graph = FakeComfy.graphs[-1]
        self.assertEqual(graph["55"]["inputs"]["start_image"], ["56", 0])
        self.assertEqual(graph["56"]["inputs"]["image"], "studio/ref.png")
        self.assertEqual((graph["55"]["inputs"]["width"], graph["55"]["inputs"]["height"], graph["55"]["inputs"]["length"]), (704, 1280, 49))
        self.assertEqual(graph["3"]["inputs"]["seed"], 7)

        self.agent.refresh()  # → running
        self.assertEqual(json.loads(self.call("GET", f"/jobs/{job['id']}")[1])["status"], "running")
        self.agent.refresh()  # → finished, output copied + validated
        done = json.loads(self.call("GET", f"/jobs/{job['id']}")[1])
        self.assertEqual(done["status"], "succeeded", done)
        self.assertEqual(done["output"]["bytes"], len(FAKE_MP4))

        status, data, headers = self.call("GET", f"/media/{job['id']}", headers={"Range": "bytes=0-99"})
        self.assertEqual(status, 206)
        self.assertEqual(len(data), 100)
        self.assertEqual(headers["Content-Range"], f"bytes 0-99/{len(FAKE_MP4)}")
        status, data, headers = self.call("GET", f"/media/{job['id']}?download=1")
        self.assertEqual(data, FAKE_MP4)
        self.assertIn("attachment", headers["Content-Disposition"])

        self.assertEqual(self.call("DELETE", f"/jobs/{job['id']}")[0], 200)
        self.assertEqual(self.call("GET", f"/media/{job['id']}")[0], 404)

    def test_text_to_video_has_no_image_node(self):
        pid = self.project_id()
        status, body, _ = self.call("POST", "/jobs", {"workflow": "wan22-t2v", "project_id": pid, "params": {"prompt": "ocean", "size": "16x9-draft", "frames": 25}})
        self.assertEqual(status, 201, body)
        self.assertNotIn("56", FakeComfy.graphs[-1])
        self.assertNotIn("start_image", FakeComfy.graphs[-1]["55"]["inputs"])

    def test_out_of_memory_is_reported_plainly(self):
        pid = self.project_id()
        FakeComfy.fail_next = True
        _, body, _ = self.call("POST", "/jobs", {"workflow": "wan22-t2v", "project_id": pid, "params": {"prompt": "x", "size": "16x9", "frames": 25}})
        jid = json.loads(body)["id"]
        self.agent.refresh()
        job = json.loads(self.call("GET", f"/jobs/{jid}")[1])
        self.assertEqual(job["status"], "failed")
        self.assertIn("ran out of memory", job["error"])

    def test_projects_crud(self):
        status, body, _ = self.call("POST", "/projects", {"name": "  Summer   promo "})
        self.assertEqual(status, 201)
        p = json.loads(body)
        self.assertEqual(p["name"], "Summer promo")
        self.assertEqual(json.loads(self.call("PATCH", f"/projects/{p['id']}", {"name": "Renamed"})[1])["name"], "Renamed")
        self.assertEqual(self.call("DELETE", f"/projects/{p['id']}")[0], 200)
        self.assertEqual(self.call("POST", "/projects", {"name": ""})[0], 400)


if __name__ == "__main__":
    unittest.main()
