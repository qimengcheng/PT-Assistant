/**
 * offscreen 文档生命周期管理，平移自 PT-depiler background/utils/offscreen.ts。
 */
let creating: Promise<void> | null; // A global promise to avoid concurrency issues

const offscreenPath = "/offscreen.html";

export async function setupOffscreenDocument() {
  // Check all windows controlled by the service worker to see if one
  // of them is the offscreen document with the given path
  const offscreenUrl = chrome.runtime.getURL(offscreenPath);
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [offscreenUrl],
  });

  if (existingContexts.length > 0) {
    return;
  }

  // create offscreen document for DOM_PARSER and other reason ( f**k google )
  if (creating) {
    await creating;
  } else {
    creating = chrome.offscreen.createDocument({
      url: offscreenUrl,
      reasons: [chrome.offscreen.Reason.DOM_PARSER],
      justification: "Allow DOM_PARSER, CLIPBOARD, BLOBS in background.",
    });
    await creating;
    creating = null;
  }
}

export function setupOffscreenDocumentSafe() {
  // noinspection ES6IgnoredPromiseFromCall
  setupOffscreenDocument().catch((e) => {
    console.error("setupOffscreenDocument failed:", e);
  });
}
