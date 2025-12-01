// Endora Chat Core Loader v1.1
// Lädt das Chat-Widget, bindet UI-Events und schickt Messages an Cloudflare → n8n.

(function () {
  console.log("[Endora Loader] booting…");

  // --------------------------------------------------
  // 1) Script-Tag + Konfiguration auslesen
  // --------------------------------------------------
  const SCRIPT_TAG = document.currentScript;
  if (!SCRIPT_TAG) {
    console.error("[Endora Loader] ❌ document.currentScript ist null – Loader bricht ab.");
    return;
  }

  const WEBHOOK_BASE = SCRIPT_TAG.getAttribute("data-webhook") || "";
  const CLIENT_API_ID = SCRIPT_TAG.getAttribute("data-client-id") || "";
  const BRAND = SCRIPT_TAG.getAttribute("data-brand") || "Endora";
  const PAGE_URL =
    SCRIPT_TAG.getAttribute("data-page-url") || window.location.href;
  const START_OPEN = SCRIPT_TAG.getAttribute("data-start-open") === "true";

  if (!WEBHOOK_BASE) {
    console.error("[Endora Loader] ❌ data-webhook fehlt am Script-Tag.");
    return;
  }
  if (!CLIENT_API_ID) {
    console.error("[Endora Loader] ❌ data-client-id fehlt am Script-Tag.");
    return;
  }

  // finale URL: Cloudflare-Endpoint + ?client=...
  const WEBHOOK_URL =
    WEBHOOK_BASE.indexOf("?") === -1
      ? WEBHOOK_BASE + "?client=" + encodeURIComponent(CLIENT_API_ID)
      : WEBHOOK_BASE + "&client=" + encodeURIComponent(CLIENT_API_ID);

  console.log("[Endora Loader] client_api_id =", CLIENT_API_ID);
  console.log("[Endora Loader] webhook url  =", WEBHOOK_URL);

  // --------------------------------------------------
  // 2) DOM-Elemente referenzieren
  // --------------------------------------------------
  const inlineMessages = document.getElementById("inline-messages");
  const inlineInput = document.getElementById("inline-input");
  const inlineSend = document.getElementById("inline-send");

  const popupMessages = document.getElementById("popup-messages");
  const popupInput = document.getElementById("popup-input");
  const popupSend = document.getElementById("popup-send");

  const bubbleBtn = document.getElementById("bubble-btn");
  const popupWrap = document.getElementById("popup-wrap");
  const popupOverlay = document.getElementById("popup-overlay");
  const inlineClose = document.getElementById("inline-close");
  const popupClose = document.getElementById("popup-close");

  if (!inlineMessages || !inlineInput || !inlineSend) {
    console.error(
      "[Endora Loader] ❌ Inline-Chat-Elemente fehlen (inline-messages / inline-input / inline-send)."
    );
    return;
  }

  // --------------------------------------------------
  // 3) Utility: Messages rendern
  // --------------------------------------------------
  function appendMessage(container, text, sender) {
    if (!container) return;
    const div = document.createElement("div");
    div.className = "msg " + sender;
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function showTyping(container) {
    if (!container) return () => {};
    const wrap = document.createElement("div");
    wrap.className = "msg bot typing";
    wrap.innerHTML =
      '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
    container.appendChild(wrap);
    container.scrollTop = container.scrollHeight;
    return () => {
      wrap.remove();
    };
  }

  // einfache Session-ID für diesen Tab
  const SESSION_ID =
    (window.crypto && crypto.randomUUID && crypto.randomUUID()) ||
    "sess_" + Date.now() + "_" + Math.random().toString(16).slice(2);

  // --------------------------------------------------
  // 4) API-Call an Cloudflare → n8n
  // --------------------------------------------------
  async function sendMessageToEndora(message, origin) {
    const trimmed = (message || "").trim();
    if (!trimmed) return;

    const isPopup = origin === "popup";
    const msgContainer = isPopup ? popupMessages || inlineMessages : inlineMessages;
    const inputElm = isPopup ? popupInput || inlineInput : inlineInput;

    appendMessage(msgContainer, trimmed, "user");
    if (inputElm) inputElm.value = "";

    const stopTyping = showTyping(msgContainer);

    try {
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Id": CLIENT_API_ID,
        },
        body: JSON.stringify({
          chatInput: trimmed,
          sessionId: SESSION_ID,
          client_id: CLIENT_API_ID,
          page_url: PAGE_URL,
          brand: BRAND,
        }),
      });

      if (!res.ok) {
        console.error(
          "[Endora Loader] ❌ HTTP-Error von Cloudflare:",
          res.status,
          res.statusText
        );
        stopTyping();
        appendMessage(
          msgContainer,
          "Sorry, something went wrong. (" + res.status + ")",
          "bot"
        );
        return;
      }

      let data = null;
      try {
        data = await res.json();
      } catch (_) {
        data = null;
      }
      stopTyping();

      const reply =
        (data && (data.reply || data.message || data.text)) ||
        (typeof data === "string" ? data : "Okay, got it.");

      appendMessage(msgContainer, reply, "bot");
    } catch (err) {
      console.error("[Endora Loader] ❌ Fetch failed:", err);
      stopTyping();
      appendMessage(
        msgContainer,
        "Connection problem – please try again in a moment.",
        "bot"
      );
    }
  }

  // --------------------------------------------------
  // 5) Event Listener – Inline und Popup
  // --------------------------------------------------
  inlineSend.addEventListener("click", function () {
    sendMessageToEndora(inlineInput.value, "inline");
  });

  inlineInput.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      sendMessageToEndora(inlineInput.value, "inline");
    }
  });

  if (popupSend && popupInput && popupMessages) {
    popupSend.addEventListener("click", function () {
      sendMessageToEndora(popupInput.value, "popup");
    });
    popupInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        sendMessageToEndora(popupInput.value, "popup");
      }
    });
  }

  // Bubble Öffnen/Schließen
  function openPopup() {
    if (!popupWrap || !popupOverlay) return;
    popupWrap.style.display = "block";
    popupOverlay.style.display = "block";
  }
  function closePopup() {
    if (!popupWrap || !popupOverlay) return;
    popupWrap.style.display = "none";
    popupOverlay.style.display = "none";
  }

  if (bubbleBtn) {
    bubbleBtn.addEventListener("click", function () {
      openPopup();
    });
  }
  if (popupOverlay) {
    popupOverlay.addEventListener("click", closePopup);
  }
  if (popupClose) {
    popupClose.addEventListener("click", closePopup);
  }

  if (inlineClose) {
    inlineClose.addEventListener("click", function () {
      // optional: Inline minimieren, Popup öffnen etc.
      openPopup();
    });
  }

  if (START_OPEN) {
    openPopup();
  }

  console.log("[Endora Loader] ready.");
})();
