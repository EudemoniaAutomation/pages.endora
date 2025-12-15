// Endora Chat Core Loader v1.3
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
  const PAGE_URL = SCRIPT_TAG.getAttribute("data-page-url") || window.location.href;
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
    return () => wrap.remove();
  }

  // einfache Session-ID für diesen Tab
  const SESSION_ID =
    (window.crypto && crypto.randomUUID && crypto.randomUUID()) ||
    "sess_" + Date.now() + "_" + Math.random().toString(16).slice(2);

  // --------------------------------------------------
  // 4) Reply robust extrahieren (JSON / Text / Array / n8n-Formate)
  // --------------------------------------------------
  function extractReply(data, rawText) {
    // 1) Wenn Text da ist und JSON leer: nutz Text
    const txt = (rawText || "").trim();

    // Helper: rekursiv in Arrays / verschachtelte Strukturen rein
    function pick(obj) {
      if (!obj) return null;

      // Array von Items (n8n gibt manchmal [ { output: ... } ] zurück)
      if (Array.isArray(obj)) {
        if (obj.length === 0) return null;
        return pick(obj[0]);
      }

      // Direkt ein String
      if (typeof obj === "string") return obj;

      // Object: typische Felder
      if (typeof obj === "object") {
        // “beste” Felder zuerst
        const direct =
          obj.reply ||
          obj.output ||
          obj.answer ||
          obj.message ||
          obj.text;

        if (typeof direct === "string") return direct;

        // manchmal: { output: { text: "..." } } oder { data: [...] }
        if (obj.output && typeof obj.output === "object") {
          const nested = obj.output.reply || obj.output.message || obj.output.text || obj.output.answer || obj.output.output;
          if (typeof nested === "string") return nested;
        }

        if (obj.data) {
          const nestedFromData = pick(obj.data);
          if (nestedFromData) return nestedFromData;
        }

        if (obj.result) {
          const nestedFromResult = pick(obj.result);
          if (nestedFromResult) return nestedFromResult;
        }

        if (obj.body) {
          const nestedFromBody = pick(obj.body);
          if (nestedFromBody) return nestedFromBody;
        }
      }

      return null;
    }

    const fromJson = pick(data);
    if (fromJson && String(fromJson).trim()) return String(fromJson).trim();

    if (txt) return txt;

    return "Okay, got it.";
  }

  // --------------------------------------------------
  // 5) API-Call an Cloudflare → n8n
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

    // ✅ STANDARD: message
    // ✅ ROBUST: zusätzlich chatInput + question (gleicher Inhalt)
    const payload = {
      // Standard
      message: trimmed,

      // Kompatibilität / Alt-Formate
      chatInput: trimmed,
      question: trimmed,

      // Session (beide Schreibweisen, damit nichts bricht)
      session_id: SESSION_ID,
      sessionId: SESSION_ID,

      // Client (beide Schreibweisen)
      client_api_id: CLIENT_API_ID,
      client_id: CLIENT_API_ID,

      // Kontext
      page_url: PAGE_URL,
      brand: BRAND,
      channel: isPopup ? "popup" : "inline",
    };

    try {
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Id": CLIENT_API_ID,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        console.error("[Endora Loader] ❌ HTTP-Error von Cloudflare:", res.status, res.statusText);
        stopTyping();
        appendMessage(msgContainer, "Sorry, something went wrong. (" + res.status + ")", "bot");
        return;
      }

      // Robust: erst Text lesen, dann versuchen JSON zu parsen
      let rawText = "";
      try {
        rawText = await res.text();
      } catch (_) {
        rawText = "";
      }

      let data = null;
      if (rawText && rawText.trim()) {
        try {
          data = JSON.parse(rawText);
        } catch (_) {
          data = null;
        }
      }

      stopTyping();

      const reply = extractReply(data, rawText);
      appendMessage(msgContainer, reply, "bot");
    } catch (err) {
      console.error("[Endora Loader] ❌ Fetch failed:", err);
      stopTyping();
      appendMessage(msgContainer, "Connection problem – please try again in a moment.", "bot");
    }
  }

  // --------------------------------------------------
  // 6) Event Listener – Inline und Popup
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

  if (bubbleBtn) bubbleBtn.addEventListener("click", openPopup);
  if (popupOverlay) popupOverlay.addEventListener("click", closePopup);
  if (popupClose) popupClose.addEventListener("click", closePopup);

  if (inlineClose) {
    inlineClose.addEventListener("click", function () {
      openPopup();
    });
  }

  if (START_OPEN) openPopup();

  console.log("[Endora Loader] ready.");
})();
