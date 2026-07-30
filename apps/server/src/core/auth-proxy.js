'use strict';
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { SocksProxyAgent } = require('socks-proxy-agent');

// undici is used internally by Node.js for the global fetch() which powers prismarine-auth
// We need to install it to access ProxyAgent + setGlobalDispatcher
let undiciPromise = null;

function getUndici() {
  if (undiciPromise) return undiciPromise;
  undiciPromise = (async () => {
    try {
      return require('undici');
    } catch {
      return null;
    }
  })();
  return undiciPromise;
}

const saved = {
  httpAgent: null,
  httpsAgent: null,
  undiciDispatcher: null
};

/**
 * Activate auth proxy for HTTP(S) requests used during Microsoft/Mojang login.
 * The raw TCP connection to the Minecraft server is NOT affected.
 * @param {string} proxyUrl  e.g. "socks5://127.0.0.1:1080" or "http://proxy:8080"
 */
async function activateAuthProxy(proxyUrl) {
  if (!proxyUrl) return;

  const url = new URL(proxyUrl);
  const protocol = url.protocol.toLowerCase();

  // 1) Patch http.Agent / https.Agent — affects yggdrasil (Mojang auth) and any
  //    legacy fetch implementations that use the built-in http/https module.
  saved.httpAgent = http.globalAgent;
  saved.httpsAgent = https.globalAgent;

  // SocksProxyAgent from socks-proxy-agent also handles http:// and https:// proxies
  // when given an http(s) URL, so one agent works for all.
  const globalAgent = new SocksProxyAgent(proxyUrl);
  http.globalAgent = globalAgent;
  https.globalAgent = globalAgent;

  // 2) Patch undici global dispatcher — affects global fetch() used by prismarine-auth
  try {
    const undici = await getUndici();
    if (undici) {
      saved.undiciDispatcher = undici.getGlobalDispatcher();
      const { ProxyAgent } = undici;
      const dispatcher = new ProxyAgent(proxyUrl);
      undici.setGlobalDispatcher(dispatcher);
    }
  } catch {
    // undici not available; fetch() will attempt to use http.Agent above,
    // but Node's built-in fetch does NOT use http.Agent. Proxy may not work for
    // fetch() in this case, so log a warning.
    console.warn('[auth-proxy] undici not available — fetch() based auth (Microsoft) may not be proxied');
  }
}

/**
 * Restore original global agents/dispatchers after auth completes.
 */
function deactivateAuthProxy() {
  if (saved.httpAgent) {
    http.globalAgent = saved.httpAgent;
    saved.httpAgent = null;
  }
  if (saved.httpsAgent) {
    https.globalAgent = saved.httpsAgent;
    saved.httpsAgent = null;
  }
  if (saved.undiciDispatcher) {
    getUndici().then((undici) => {
      if (undici && saved.undiciDispatcher) {
        undici.setGlobalDispatcher(saved.undiciDispatcher);
        saved.undiciDispatcher = null;
      }
    }).catch(() => {});
  }
}

module.exports = { activateAuthProxy, deactivateAuthProxy };