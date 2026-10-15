#!/usr/bin/env python3
"""Interactive OAuth (auth-code + PKCE) + MCP connection check for Shared Memory.

Uses only the Python standard library and `requests`. Never hardcodes secrets.
Run:

  pip install requests
  python3 scripts/verify_oauth_mcp.py

Optional environment:
  MCP_URL          default https://shared-memory-mcp-production.up.railway.app/mcp
  CLIENT_ID        skip DCR and use this public client id
  REDIRECT_URI     default http://127.0.0.1:<ephemeral-port>/callback
  OAUTH_SCOPES     default "profile email"
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import sys
import threading
import time
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

try:
    import requests
except ImportError:
    sys.stderr.write("Install requests first: pip install requests\n")
    sys.exit(1)

DEFAULT_MCP_URL = "https://shared-memory-mcp-production.up.railway.app/mcp"
REQUIRED_SCOPES = "profile email"
MCP_PROTOCOL_VERSION = "2025-11-25"


def die(message: str, code: int = 1) -> None:
    sys.stderr.write(message.rstrip() + "\n")
    sys.exit(code)


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def pkce_pair() -> tuple[str, str]:
    verifier = b64url(secrets.token_bytes(32))
    challenge = b64url(hashlib.sha256(verifier.encode("ascii")).digest())
    return verifier, challenge


def get_json(url: str) -> dict[str, Any]:
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    return response.json()


def discover(mcp_url: str) -> tuple[str, dict[str, Any], dict[str, Any]]:
    origin = urllib.parse.urlparse(mcp_url)._replace(path="", params="", query="", fragment="").geturl().rstrip("/")
    path = urllib.parse.urlparse(mcp_url).path.rstrip("/") or "/mcp"
    metadata_url = f"{origin}/.well-known/oauth-protected-resource{path}"
    protected = get_json(metadata_url)
    resource = protected.get("resource")
    if resource != mcp_url:
        die(
            f"Protected-resource metadata resource mismatch:\n"
            f"  expected {mcp_url}\n"
            f"  got      {resource}\n"
            f"  from     {metadata_url}"
        )
    servers = protected.get("authorization_servers") or []
    if not servers:
        die("No authorization_servers in protected-resource metadata")
    issuer = servers[0].rstrip("/")
    as_meta = get_json(f"{issuer}/.well-known/oauth-authorization-server")
    return resource, protected, as_meta


def register_public_client(as_meta: dict[str, Any], redirect_uri: str, client_name: str) -> str:
    endpoint = as_meta.get("registration_endpoint")
    if not endpoint:
        die(
            "Authorization server does not advertise registration_endpoint.\n"
            "Create a public OAuth application in the Clerk Dashboard and set CLIENT_ID.\n"
            "Redirect URI must be exactly: " + redirect_uri
        )
    payload = {
        "client_name": client_name,
        "redirect_uris": [redirect_uri],
        "token_endpoint_auth_method": "none",
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "scope": REQUIRED_SCOPES,
    }
    response = requests.post(endpoint, json=payload, timeout=30)
    if response.status_code >= 400:
        die(f"DCR failed ({response.status_code}): {response.text}")
    body = response.json()
    client_id = body.get("client_id")
    if not client_id:
        die(f"DCR response missing client_id: {body}")
    print(f"Registered public client via DCR: {client_id}")
    return client_id


class CallbackServer:
    def __init__(self, redirect_uri: str | None) -> None:
        parsed = urllib.parse.urlparse(redirect_uri) if redirect_uri else None
        host = parsed.hostname if parsed and parsed.hostname else "127.0.0.1"
        port = parsed.port if parsed and parsed.port else 0
        self._code: str | None = None
        self._error: str | None = None
        self._state_expected: str | None = None
        self._event = threading.Event()
        parent = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802
                query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                state = (query.get("state") or [None])[0]
                if parent._state_expected and state != parent._state_expected:
                    parent._error = "state_mismatch"
                elif "error" in query:
                    parent._error = query.get("error_description") or query.get("error") or ["oauth_error"]
                    parent._error = parent._error[0] if isinstance(parent._error, list) else parent._error
                else:
                    parent._code = (query.get("code") or [None])[0]
                    if not parent._code:
                        parent._error = "missing_code"
                body = (
                    b"<html><body><h1>Shared Memory OAuth</h1>"
                    b"<p>You can close this window and return to the terminal.</p>"
                    b"</body></html>"
                )
                self.send_response(200 if parent._code else 400)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                parent._event.set()

            def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
                return

        self._httpd = HTTPServer((host, port), Handler)
        actual_host, actual_port = self._httpd.server_address
        path = parsed.path if parsed and parsed.path else "/callback"
        self.redirect_uri = f"http://{actual_host}:{actual_port}{path}"
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)

    def start(self, state: str) -> None:
        self._state_expected = state
        self._thread.start()

    def wait(self, timeout: float = 600) -> str:
        if not self._event.wait(timeout):
            die("Timed out waiting for the browser OAuth callback")
        self._httpd.shutdown()
        if self._error:
            die(f"OAuth callback error: {self._error}")
        if not self._code:
            die("OAuth callback missing authorization code")
        return self._code


def exchange_code(
    as_meta: dict[str, Any],
    *,
    client_id: str,
    code: str,
    redirect_uri: str,
    code_verifier: str,
    resource: str,
) -> dict[str, Any]:
    token_endpoint = as_meta.get("token_endpoint")
    if not token_endpoint:
        die("Authorization server metadata missing token_endpoint")
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": client_id,
        "code_verifier": code_verifier,
        "resource": resource,
    }
    response = requests.post(
        token_endpoint,
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30,
    )
    if response.status_code >= 400:
        die(f"Token exchange failed ({response.status_code}): {response.text}")
    body = response.json()
    if not body.get("access_token"):
        die(f"Token response missing access_token: {json.dumps(body)}")
    return body


def mcp_rpc(mcp_url: str, access_token: str, method: str, params: dict[str, Any] | None, rpc_id: int) -> Any:
    payload = {"jsonrpc": "2.0", "id": rpc_id, "method": method}
    if params is not None:
        payload["params"] = params
    response = requests.post(
        mcp_url,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
        },
        json=payload,
        timeout=60,
    )
    if response.status_code == 401:
        die(
            f"MCP 401 unauthorized for {method}.\n"
            f"WWW-Authenticate: {response.headers.get('WWW-Authenticate')}\n"
            f"Body: {response.text}\n"
            "Confirm resource=/mcp audience binding and required scopes profile email."
        )
    if response.status_code >= 400:
        die(f"MCP {method} failed ({response.status_code}): {response.text}")
    content_type = response.headers.get("Content-Type", "")
    if "text/event-stream" in content_type:
        data_lines = []
        for line in response.text.splitlines():
            if line.startswith("data:"):
                data_lines.append(line[5:].strip())
        if not data_lines:
            die(f"SSE response for {method} had no data frames")
        body = json.loads(data_lines[-1])
    else:
        body = response.json()
    if "error" in body:
        die(f"MCP {method} JSON-RPC error: {json.dumps(body['error'])}")
    return body.get("result")


def print_identity(result: Any) -> None:
    structured = (result or {}).get("structuredContent") or {}
    user = structured.get("user") or {}
    print("\n=== get_connection_status ===")
    print(json.dumps(structured, indent=2, sort_keys=True))
    print("\nAccount identity:")
    print(f"  id:    {user.get('id')}")
    print(f"  name:  {user.get('name')}")
    print(f"  email: {user.get('email')}")


def main() -> None:
    mcp_url = os.environ.get("MCP_URL", DEFAULT_MCP_URL).rstrip("/")
    if not mcp_url.endswith("/mcp"):
        die(f"MCP_URL must end with /mcp (got {mcp_url})")
    scopes = os.environ.get("OAUTH_SCOPES", REQUIRED_SCOPES)
    if scopes != REQUIRED_SCOPES:
        print(f"Note: using OAUTH_SCOPES={scopes!r} (service requires profile email)")

    print(f"Discovering OAuth for {mcp_url}")
    resource, protected, as_meta = discover(mcp_url)
    print(f"resource: {resource}")
    print(f"authorization_servers: {protected.get('authorization_servers')}")
    print(f"authorize: {as_meta.get('authorization_endpoint')}")
    print(f"token:     {as_meta.get('token_endpoint')}")
    print(f"register:  {as_meta.get('registration_endpoint') or '(none — use CLIENT_ID)'}")

    redirect_override = os.environ.get("REDIRECT_URI")
    callback = CallbackServer(redirect_override)
    code_verifier, code_challenge = pkce_pair()
    state = b64url(secrets.token_bytes(16))

    client_id = os.environ.get("CLIENT_ID")
    if client_id:
        print(f"Using CLIENT_ID from environment: {client_id}")
        print(
            "Clerk Dashboard: OAuth applications → your public app → "
            f"Redirect URI must include exactly {callback.redirect_uri}"
        )
    else:
        client_id = register_public_client(
            as_meta,
            callback.redirect_uri,
            "Shared Memory local OAuth verifier",
        )

    authorize_endpoint = as_meta.get("authorization_endpoint")
    if not authorize_endpoint:
        die("Authorization server metadata missing authorization_endpoint")

    auth_params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": callback.redirect_uri,
        "scope": scopes,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "resource": resource,
    }
    authorize_url = authorize_endpoint + "?" + urllib.parse.urlencode(auth_params)

    callback.start(state)
    print("\nOpen this URL to sign in (browser should open automatically):\n")
    print(authorize_url)
    print()
    try:
        webbrowser.open(authorize_url)
    except Exception:
        pass
    print("Waiting for interactive login / consent…")
    code = callback.wait()
    print("Authorization code received; exchanging for tokens (with resource=)…")

    tokens = exchange_code(
        as_meta,
        client_id=client_id,
        code=code,
        redirect_uri=callback.redirect_uri,
        code_verifier=code_verifier,
        resource=resource,
    )
    access_token = tokens["access_token"]
    print(
        f"Token ok (token_type={tokens.get('token_type')}, "
        f"expires_in={tokens.get('expires_in')}, "
        f"scope={tokens.get('scope')!r})"
    )

    print("\nMCP initialize…")
    init = mcp_rpc(
        mcp_url,
        access_token,
        "initialize",
        {
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "shared-memory-oauth-verifier", "version": "1.0"},
        },
        1,
    )
    print(json.dumps(init.get("serverInfo") if isinstance(init, dict) else init, indent=2))

    print("\nMCP tools/list…")
    listed = mcp_rpc(mcp_url, access_token, "tools/list", {}, 2)
    tools = (listed or {}).get("tools") or []
    names = [t.get("name") for t in tools]
    print("tools:", ", ".join(n for n in names if n))
    if "get_connection_status" not in names:
        die("get_connection_status not advertised by tools/list")

    print("\nMCP tools/call get_connection_status…")
    status = mcp_rpc(
        mcp_url,
        access_token,
        "tools/call",
        {"name": "get_connection_status", "arguments": {}},
        3,
    )
    print_identity(status)
    print("\nOAuth + MCP verification succeeded.")


if __name__ == "__main__":
    try:
        main()
    except requests.RequestException as exc:
        die(f"HTTP error: {exc}")
