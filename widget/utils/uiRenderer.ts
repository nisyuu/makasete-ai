import { formatMessageText } from "./text";
import type { Product } from "../types";

export interface UIElements {
  container: HTMLElement;
  chatWindow: HTMLElement;
  chatTitle: HTMLElement;
  timeline: HTMLElement;
  input: HTMLTextAreaElement;
  sendBtn: HTMLButtonElement;
  micBtn: HTMLButtonElement;
  launcherBtn: HTMLButtonElement;
  loadingOverlay: HTMLElement;
  closeBtn: HTMLElement | null;
}

/**
 * Shadow DOM内のUI要素を取得して返す
 */
export function getUIElements(shadowRoot: ShadowRoot): UIElements {
  return {
    container: shadowRoot.querySelector(".widget-container") as HTMLElement,
    chatWindow: shadowRoot.querySelector(".chat-window") as HTMLElement,
    chatTitle: shadowRoot.querySelector(".chat-title") as HTMLElement,
    timeline: shadowRoot.querySelector(".chat-timeline") as HTMLElement,
    input: shadowRoot.querySelector(".text-input") as HTMLTextAreaElement,
    sendBtn: shadowRoot.querySelector(".send-btn") as HTMLButtonElement,
    micBtn: shadowRoot.querySelector(".mic-btn") as HTMLButtonElement,
    launcherBtn: shadowRoot.querySelector(
      ".launcher-button",
    ) as HTMLButtonElement,
    loadingOverlay: shadowRoot.querySelector(
      ".loading-overlay",
    ) as HTMLElement,
    closeBtn: shadowRoot.querySelector(".close-btn"),
  };
}

/**
 * 入力アクションボタン（送信・マイク）の表示を更新する
 */
export function updateInputActions(
  input: HTMLTextAreaElement,
  sendBtn: HTMLButtonElement,
  micBtn: HTMLButtonElement,
): void {
  const hasText = input.value.trim().length > 0;
  sendBtn.style.display = hasText ? "flex" : "none";
  micBtn.style.display = hasText ? "none" : "flex";
}

/**
 * タイピングインジケーターを表示する
 */
export function showTypingIndicator(timeline: HTMLElement): void {
  if (timeline.querySelector(".typing-indicator")) return;
  const div = document.createElement("div");
  div.className = "typing-indicator";
  div.innerHTML = `
    <div class="typing-dot"></div>
    <div class="typing-dot"></div>
    <div class="typing-dot"></div>
  `;
  timeline.appendChild(div);
  scrollToBottom(timeline);
}

/**
 * タイピングインジケーターを非表示にする
 */
export function hideTypingIndicator(timeline: HTMLElement): void {
  const indicator = timeline.querySelector(".typing-indicator");
  if (indicator) {
    indicator.remove();
  }
}

/**
 * タイムラインを最下部にスクロールする
 */
export function scrollToBottom(timeline: HTMLElement): void {
  requestAnimationFrame(() => {
    timeline.scrollTop = timeline.scrollHeight;
  });
}

/**
 * メッセージ追加の状態を保持するオブジェクト
 */
export interface MessageState {
  currentMakaseteServerMessageRaw: string;
}

/**
 * チャットメッセージをタイムラインに追加する
 * appendToLast=true の場合、最後のサーバーメッセージにストリーミング追記する
 */
export function appendMessage(
  timeline: HTMLElement,
  state: MessageState,
  role: "user" | "makasete-server",
  text: string,
  appendToLast = false,
): void {
  if (role === "makasete-server") {
    hideTypingIndicator(timeline);
  }

  if (appendToLast && role === "makasete-server") {
    const lastMsg = timeline.lastElementChild;
    if (lastMsg && lastMsg.classList.contains("makasete-server")) {
      state.currentMakaseteServerMessageRaw += text;
      lastMsg.innerHTML = formatMessageText(
        state.currentMakaseteServerMessageRaw,
      );
      scrollToBottom(timeline);
      return;
    }
  }

  if (role === "makasete-server") {
    state.currentMakaseteServerMessageRaw = text;
  }

  const div = document.createElement("div");
  div.className = `message ${role}`;
  div.innerHTML = formatMessageText(text);
  timeline.appendChild(div);
  scrollToBottom(timeline);
}

function escapeHtml(str: string): string {
  return str.replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m] || m,
  );
}

/**
 * 商品レコメンデーションカードをタイムラインに追加する。
 * 既存のレコメンデーションがある場合は置き換える。
 */
export function appendRecommendations(timeline: HTMLElement, products: Product[]): void {
  const existing = timeline.querySelector(".recommendations");
  if (existing) existing.remove();

  if (products.length === 0) return;

  const container = document.createElement("div");
  container.className = "recommendations";

  for (const product of products) {
    const isValidUrl = /^https?:\/\//.test(product.url);
    const isValidImageUrl = /^https?:\/\//.test(product.image_url);

    const card = document.createElement(isValidUrl ? "a" : "div");
    card.className = "product-card";
    if (isValidUrl && card instanceof HTMLAnchorElement) {
      card.href = product.url;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
    }

    const imageHtml = isValidImageUrl
      ? `<img class="product-image" src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}" loading="lazy">`
      : "";

    const descHtml = product.description
      ? `<div class="product-desc">${escapeHtml(product.description)}</div>`
      : "";

    const priceHtml = product.price
      ? `<div class="product-price">${escapeHtml(product.price)}</div>`
      : "";

    card.innerHTML = `${imageHtml}<div class="product-info"><div class="product-name">${escapeHtml(product.name)}</div>${descHtml}${priceHtml}</div>`;

    container.appendChild(card);
  }

  timeline.appendChild(container);
  scrollToBottom(timeline);
}

/**
 * プライマリカラーをShadow Hostに適用する
 */
export function applyPrimaryColor(
  shadowRoot: ShadowRoot,
  color: string,
): void {
  const host = shadowRoot.host as HTMLElement;
  host.style.setProperty("--primary-color", color);
}

/**
 * ローディングオーバーレイを非表示にする
 */
export function hideLoadingOverlay(loadingOverlay: HTMLElement): void {
  loadingOverlay.classList.add("hidden");
}
