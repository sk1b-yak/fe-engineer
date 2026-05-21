// Optional runtime UI audit (experimental). Drives a real browser via Browser
// Rendering (CDP), loads a page, clicks every button, and checks whether anything
// actually changed (URL / title / DOM size). Best-effort: if there's no BROWSER
// binding or the page can't load, it returns `skipped` and the static audit stands.

import { connectBrowser, type CdpSession } from "agents/browser";

export interface ButtonResult {
  index: number;
  label: string;
  changed: boolean;
  error?: string;
}

export interface RuntimeAuditReport {
  skipped: boolean;
  reason?: string;
  url?: string;
  buttonCount?: number;
  results?: ButtonResult[];
}

const SIG = "JSON.stringify([location.href, document.title, document.body ? document.body.innerHTML.length : 0])";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function evalValue<T>(cdp: CdpSession, expression: string): Promise<T | undefined> {
  const res = (await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as { result?: { value?: T } } | undefined;
  return res?.result?.value;
}

export async function runtimeAudit(
  browser: Fetcher | undefined,
  url: string,
  maxButtons = 24,
): Promise<RuntimeAuditReport> {
  if (!browser) return { skipped: true, reason: "No BROWSER binding configured on this Worker" };
  if (!/^https?:\/\//.test(url)) return { skipped: true, reason: "A valid http(s) URL is required" };

  let cdp: CdpSession | undefined;
  try {
    cdp = await connectBrowser(browser);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.navigate", { url });

    for (let i = 0; i < 20; i++) {
      if ((await evalValue<string>(cdp, "document.readyState")) === "complete") break;
      await sleep(250);
    }

    const tagExpr =
      `(() => { const els = [...document.querySelectorAll(` +
      `'button,[role=button],a[href],input[type=submit],input[type=button]')].slice(0, ${maxButtons});` +
      `els.forEach((e, i) => e.setAttribute('data-audit-idx', String(i)));` +
      `return els.map((e, i) => ({ index: i, label: (e.innerText || e.value || ` +
      `e.getAttribute('aria-label') || e.tagName || '').trim().slice(0, 40) })); })()`;
    const buttons = (await evalValue<{ index: number; label: string }[]>(cdp, tagExpr)) ?? [];

    const results: ButtonResult[] = [];
    for (const b of buttons) {
      const before = (await evalValue<string>(cdp, SIG)) ?? "";
      let error: string | undefined;
      try {
        await evalValue(cdp, `(() => { const el = document.querySelector('[data-audit-idx="${b.index}"]'); if (el) el.click(); return true; })()`);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      await sleep(350);
      const after = (await evalValue<string>(cdp, SIG)) ?? "";
      results.push({ index: b.index, label: b.label, changed: before !== after, error });
    }

    return { skipped: false, url, buttonCount: buttons.length, results };
  } catch (err) {
    return { skipped: true, reason: `Runtime audit failed: ${err instanceof Error ? err.message : String(err)}`, url };
  } finally {
    try {
      cdp?.close();
    } catch {
      /* already closed */
    }
  }
}
