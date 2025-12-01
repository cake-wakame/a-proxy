import express from "express";
import fetch from "node-fetch";
import { JSDOM } from "jsdom";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// プロキシ不可サイト
const BLACKLIST = ["youtube.com", "youtu.be", "netflix.com", "spotify.com"];
function isBlocked(url) {
  return BLACKLIST.some(domain => url.includes(domain));
}

// ルートで index.html を返す
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// HTMLページプロキシ
app.get("/proxy-page", async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send("url parameter required");
  if (isBlocked(targetUrl)) return res.status(403).send("このサイトはプロキシ不可です");

  try {
    const response = await fetch(targetUrl, {
      headers: { "User-Agent": req.headers["user-agent"] }
    });
    let html = await response.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const targetBase = new URL(targetUrl).origin;

    // <base> タグを追加して相対パスをターゲットサイト基準にする
    const baseEl = doc.createElement("base");
    baseEl.href = targetBase + "/";
    doc.head.appendChild(baseEl);

    // 監視JSを埋め込む
    const monitorJS = `
      (function() {
        const TARGET_BASE_URL = "${targetBase}";
        const PROXY_HOST = window.location.host;

        function rewriteNode(el) {
          ["src","href"].forEach(attr => {
            const url = el[attr];
            if (!url) return;
            try {
              const absoluteUrl = new URL(url, TARGET_BASE_URL).href;
              if (absoluteUrl.includes(PROXY_HOST)) return;
              el[attr] = "/proxy?url=" + encodeURIComponent(absoluteUrl);
            } catch(e) {}
          });
        }

        // 初期リンク書き換え
        document.querySelectorAll("[src],[href]").forEach(el => rewriteNode(el));

        // 動的DOM監視
        const observer = new MutationObserver(mutations => {
          for (const mutation of mutations) {
            mutation.addedNodes.forEach(node => {
              if (node.nodeType !== 1) return;
              rewriteNode(node);
              node.querySelectorAll && node.querySelectorAll("[src],[href]").forEach(el => rewriteNode(el));
            });
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        // fetchラップ
        const originalFetch = window.fetch;
        window.fetch = function(resource, init) {
          if (typeof resource === "string") {
            try {
              const absoluteUrl = new URL(resource, TARGET_BASE_URL).href;
              if (!absoluteUrl.includes(PROXY_HOST)) {
                resource = "/proxy?url=" + encodeURIComponent(absoluteUrl);
              }
            } catch(e) {}
          }
          return originalFetch(resource, init);
        };

        // XMLHttpRequestラップ
        const OriginalXHR = window.XMLHttpRequest;
        window.XMLHttpRequest = function() {
          const xhr = new OriginalXHR();
          const open = xhr.open;
          xhr.open = function(method, url, ...args) {
            if (typeof url === "string") {
              try {
                const absoluteUrl = new URL(url, TARGET_BASE_URL).href;
                if (!absoluteUrl.includes(PROXY_HOST)) {
                  url = "/proxy?url=" + encodeURIComponent(absoluteUrl);
                }
              } catch(e) {}
            }
            return open.call(this, method, url, ...args);
          };
          return xhr;
        };
      })();
    `;
    const scriptEl = doc.createElement("script");
    scriptEl.textContent = monitorJS;
    doc.body.appendChild(scriptEl);

    res.send(dom.serialize());
  } catch (err) {
    res.status(500).send("取得失敗: " + err.message);
  }
});

// 画像・CSS・JS等リソースプロキシ
app.get("/proxy", async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send("url parameter required");
  if (isBlocked(targetUrl)) return res.status(403).send("このサイトはプロキシ不可です");

  try {
    const response = await fetch(targetUrl, {
      headers: { "User-Agent": req.headers["user-agent"] }
    });
    res.set("Content-Type", response.headers.get("content-type") || "application/octet-stream");
    response.body.pipe(res);
  } catch (err) {
    res.status(500).send("取得失敗: " + err.message);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SPA対応汎用プロキシ稼働中 http://0.0.0.0:${PORT}`);
});
