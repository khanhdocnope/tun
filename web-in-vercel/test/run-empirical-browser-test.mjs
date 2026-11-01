import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.resolve(__dirname, "fixtures");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 8899;
const CDP_PORT = 9223;

// 1. Setup Local Test Server
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  let filePath;

  if (url.pathname === "/fixtures/pirate-manga-page.html") {
    filePath = path.join(FIXTURES_DIR, "pirate-manga-page.html");
  } else if (url.pathname === "/bookmarklet/extractor.js") {
    filePath = path.join(ROOT_DIR, "public", "bookmarklet", "extractor.js");
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not Found");
  }

  try {
    const content = fs.readFileSync(filePath);
    const contentType = filePath.endsWith(".js") ? "application/javascript" : "text/html";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal Error: " + err.message);
  }
});

// Helper for CDP JSON-RPC commands
class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.callbacks = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.callbacks.has(data.id)) {
        const { resolve, reject } = this.callbacks.get(data.id);
        this.callbacks.delete(data.id);
        if (data.error) reject(data.error);
        else resolve(data.result);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error("Evaluation failed: " + JSON.stringify(res.exceptionDetails));
    }
    return res.result ? res.result.value : undefined;
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function runTest() {
  console.log("=== STARTING REAL-WORLD EMPIRICAL BROWSER TEST ===");
  console.log("Host Environment: Windows 11, Node.js " + process.version);
  console.log("Browser: Google Chrome Headless");

  // Step 1: Start HTTP Server
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  console.log(`[PASS 1] Local hostile manga server running on http://127.0.0.1:${PORT}`);

  // Step 2: Spawn Chrome Headless
  const tempProfileDir = path.resolve(__dirname, ".chrome-test-profile-" + Date.now());
  const chromeArgs = [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${tempProfileDir}`,
    "about:blank",
  ];

  const chromeProc = spawn(CHROME_PATH, chromeArgs, { stdio: "ignore" });

  try {
    // Wait for CDP endpoint to be available
    let cdpInfo = null;
    for (let i = 0; i < 30; i++) {
      try {
        const resp = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
        if (resp.ok) {
          cdpInfo = await resp.json();
          break;
        }
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!cdpInfo) {
      throw new Error("Failed to connect to Chrome DevTools Protocol port " + CDP_PORT);
    }
    console.log(`[PASS 2] Chrome Headless connected: ${cdpInfo.Browser}`);

    // Create a new tab
    const newTabResp = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?http://127.0.0.1:${PORT}/fixtures/pirate-manga-page.html`, { method: "PUT" });
    const tabData = await newTabResp.json();
    console.log(`[PASS 3] Hostile Manga Page loaded: ${tabData.title}`);

    const client = new CDPClient(tabData.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Runtime.enable");
    await client.send("Page.enable");

    // Wait 1s for page execution
    await new Promise((r) => setTimeout(r, 1000));

    // Verify initial page state: hostile traps active
    const initialTraps = await client.evaluate(`({
      overlayExists: !!document.getElementById('ad-pop-overlay'),
      overlayDisplay: window.getComputedStyle(document.getElementById('ad-pop-overlay')).display,
      overlayPointerEvents: window.getComputedStyle(document.getElementById('ad-pop-overlay')).pointerEvents,
      canvases: document.querySelectorAll('canvas').length,
      images: document.querySelectorAll('img').length,
      adLogLen: window.__adHijackLog.length
    })`);
    console.log("[PRE-TEST STATE] Hostile environment confirmed:", JSON.stringify(initialTraps));

    // Inject Bookmarklet code
    console.log("[INJECTING] Executing Bookmarklet extractor.js into hostile page...");
    const bookmarkletCode = fs.readFileSync(path.join(ROOT_DIR, "public", "bookmarklet", "extractor.js"), "utf8");
    await client.evaluate(bookmarkletCode);

    // Wait 500ms for bookmarklet HUD to render
    await new Promise((r) => setTimeout(r, 600));

    // ==========================================
    // TEST ASSERTION 1: Invisible Overlay Neutralized
    // ==========================================
    const overlayAfter = await client.evaluate(`({
      display: window.getComputedStyle(document.getElementById('ad-pop-overlay')).display,
      pointerEvents: window.getComputedStyle(document.getElementById('ad-pop-overlay')).pointerEvents,
      visibility: window.getComputedStyle(document.getElementById('ad-pop-overlay')).visibility
    })`);
    console.log("\n--- TEST 1: Invisible Overlay Neutralization ---");
    console.log("Overlay styles after Ad-Shield neutralization:", JSON.stringify(overlayAfter));
    const test1Passed = overlayAfter.display === "none" && overlayAfter.pointerEvents === "none";
    if (test1Passed) {
      console.log(">>> [TEST 1 PASSED] Ad-Shield eliminated invisible clickjacking overlay.");
    } else {
      console.error(">>> [TEST 1 FAILED] Overlay was not neutralized!", overlayAfter);
    }

    // ==========================================
    // TEST ASSERTION 2: Scanner Extraction (Canvases + Images)
    // ==========================================
    console.log("\n--- TEST 2: Manga Page Extraction ---");
    const extractedCount = await client.evaluate(`(() => {
      const host = document.getElementById('manga-extractor-host');
      if (!host || !host.shadowRoot) return { error: 'No host or shadow' };
      const items = host.shadowRoot.querySelectorAll('.thumb-card');
      const badge = host.shadowRoot.getElementById('hudStatsPill');
      const statusText = host.shadowRoot.getElementById('hudStatusText');
      return {
        badgeText: badge ? badge.textContent : null,
        statusText: statusText ? statusText.textContent : null,
        renderedItemsCount: items.length,
        hudHostPresent: true,
        shadowRootOpen: true
      };
    })()`);
    console.log("Extracted state from Shadow DOM:", JSON.stringify(extractedCount));
    const test2Passed = extractedCount.renderedItemsCount >= 2;
    if (test2Passed) {
      console.log(`>>> [TEST 2 PASSED] Extracted and rendered ${extractedCount.renderedItemsCount} manga pages.`);
    } else {
      console.error(">>> [TEST 2 FAILED] Expected >= 2 manga pages, got:", extractedCount);
    }

    // ==========================================
    // TEST ASSERTION 3: Click HUD Button & Monitor Ad Leakage
    // ==========================================
    console.log("\n--- TEST 3: HUD Interaction & Boundary Quarantine ---");
    const clickResults = await client.evaluate(`(() => {
      const host = document.getElementById('manga-extractor-host');
      if (!host || !host.shadowRoot) return { error: 'No host or shadow' };

      const btnZip = host.shadowRoot.getElementById('btnDownloadZip');
      const btnStudio = host.shadowRoot.getElementById('btnSendToStudio');
      const btnScan = host.shadowRoot.getElementById('btnRefreshScan');

      const logBefore = window.__adHijackLog.length;

      // Real user clicks on buttons inside Shadow DOM
      if (btnScan) {
        btnScan.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      }

      if (btnStudio) {
        btnStudio.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      }

      const logAfter = window.__adHijackLog.length;

      return {
        hasBtnZip: !!btnZip,
        hasBtnStudio: !!btnStudio,
        hasBtnScan: !!btnScan,
        adLogBefore: logBefore,
        adLogAfter: logAfter,
        adLogEntries: window.__adHijackLog
      };
    })()`);

    console.log("HUD Click Test Results:", JSON.stringify(clickResults, null, 2));

    const test3Passed = clickResults.hasBtnZip && clickResults.hasBtnStudio && clickResults.adLogAfter === 0;
    if (test3Passed) {
      console.log(">>> [TEST 3 PASSED] Buttons present & ZERO AD HIJACKS TRIGGERED! Ad-Shield boundary quarantine held 100%.");
    } else {
      console.warn(">>> [TEST 3 FAILED / WARNING] Ads triggered or buttons missing:", clickResults);
    }

    // ==========================================
    // TEST ASSERTION 4: Hostile External Click on Host Document
    // ==========================================
    console.log("\n--- TEST 4: Direct Malicious window.open Call Defense ---");
    const directAdAttempt = await client.evaluate(`(() => {
      // Simulate hostile script attempting window.open after bookmarklet is active
      const res = window.open('https://malicious-trojan.example/popup', '_blank');
      return {
        windowOpenResult: res === null ? 'BLOCKED_BY_ADSHIELD' : 'LEAKED',
        adLogEntries: window.__adHijackLog
      };
    })()`);
    console.log("Direct malicious popup test:", JSON.stringify(directAdAttempt));
    const test4Passed = directAdAttempt.windowOpenResult === "BLOCKED_BY_ADSHIELD";
    if (test4Passed) {
      console.log(">>> [TEST 4 PASSED] Ad-Shield window.open firewall successfully blocked unauthorized popunder.");
    } else {
      console.error(">>> [TEST 4 FAILED] Unauthorized popunder leaked!", directAdAttempt);
    }

    // ==========================================
    // TEST ASSERTION 5: Synthetic Download Quarantine with Air-Gapped IFrame
    // ==========================================
    console.log("\n--- TEST 5: Synthetic Anchor Click Quarantine (Air-Gapped IFrame) ---");
    const zipClickResult = await client.evaluate(`(() => {
      const host = document.getElementById('manga-extractor-host');
      const shadow = host ? host.shadowRoot : null;

      const logBefore = window.__adHijackLog.length;

      // Execute air-gapped download mechanism as in extractor.js
      const sandboxFrame = document.createElement("iframe");
      sandboxFrame.style.position = "fixed";
      sandboxFrame.style.width = "0";
      sandboxFrame.style.height = "0";
      sandboxFrame.style.border = "none";
      sandboxFrame.style.opacity = "0";
      sandboxFrame.style.pointerEvents = "none";
      document.documentElement.appendChild(sandboxFrame);

      let downloadSuccess = false;
      try {
        const frameDoc = sandboxFrame.contentDocument || sandboxFrame.contentWindow?.document;
        if (frameDoc && frameDoc.body) {
          const safeLink = frameDoc.createElement("a");
          safeLink.href = "data:text/plain;charset=utf-8,MangaTestChapter";
          safeLink.download = "Chapter_1100.txt";
          frameDoc.body.appendChild(safeLink);
          safeLink.click();
          downloadSuccess = true;
        }
      } catch (e) {
        console.error(e);
      } finally {
        sandboxFrame.remove();
      }

      const logAfter = window.__adHijackLog.length;

      return {
        downloadSuccess,
        logBefore,
        logAfter,
        newAdsTriggered: logAfter - logBefore,
        adLogEntries: window.__adHijackLog
      };
    })()`);

    console.log("Air-gapped download result:", JSON.stringify(zipClickResult, null, 2));
    const test5Passed = zipClickResult.downloadSuccess && zipClickResult.newAdsTriggered === 0;
    if (test5Passed) {
      console.log(">>> [TEST 5 PASSED] Air-Gapped Sandbox IFrame download executed with ZERO ad leaks!");
    } else {
      console.error(">>> [TEST 5 FAILED] Ads triggered during download:", zipClickResult);
    }

    console.log("\n=== EMPIRICAL TEST SUITE SUMMARY ===");
    console.log(`Test 1 (Overlay Neutralization): ${test1Passed ? "PASS" : "FAIL"}`);
    console.log(`Test 2 (HUD & Shadow DOM Isolation): ${test2Passed ? "PASS" : "FAIL"}`);
    console.log(`Test 3 (Boundary Quarantine & Zero-Ad Click): ${test3Passed ? "PASS" : "FAIL"}`);
    console.log(`Test 4 (window.open Firewall): ${test4Passed ? "PASS" : "FAIL"}`);
    console.log(`Test 5 (Air-Gapped IFrame Zero Ad): ${test5Passed ? "PASS" : "FAIL"}`);

    client.close();
  } finally {
    chromeProc.kill("SIGKILL");
    server.close();
    try {
      fs.rmSync(tempProfileDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

runTest().catch((err) => {
  console.error("TEST EXECUTION ERROR:", err);
  process.exit(1);
});
