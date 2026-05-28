const drafts = [
  {
    id: "india-masterclass",
    title: "卡塔克与塔布拉鼓深度工作坊",
    source: "印度驻华大使馆",
    time: "5月30日 15:00-17:00",
    venue: "印度驻华使馆",
    reason: "QR registration",
    type: "missing",
    badges: ["需预约", "二维码", "待确认报名"],
    summary: "海报包含报名二维码，活动字段完整；需要确认二维码是否可用并保存报名图。",
    fields: {
      time: "已确认",
      venue: "已确认",
      reservation: "二维码",
      confidence: "0.86",
    },
  },
  {
    id: "italy-talk",
    title: "当代发展：Pietro Ruffo、Flavio Favelli 与 Daniele Sigalot",
    source: "IICPechino",
    time: "5月27日 19:00",
    venue: "意大利使馆文化中心",
    reason: "Missing address",
    type: "missing",
    badges: ["需实名预约", "缺地址", "今晚"],
    summary: "主活动清楚，但地址未从正文抽到；发布前需要补齐或确认场馆固定地址。",
    fields: {
      time: "已确认",
      venue: "场馆已确认",
      reservation: "二维码",
      confidence: "0.79",
    },
  },
  {
    id: "palladio-preview",
    title: "Chinese Voices on Palladio 相关展览预告",
    source: "IICPechino",
    time: "待确认",
    venue: "东景缘寺庙",
    reason: "Secondary mention",
    type: "duplicate",
    badges: ["相关提及", "低置信", "不要自动发布"],
    summary: "来源文章主要是讲座，此条是相关项目提及。需要确认是否独立成活动。",
    fields: {
      time: "缺失",
      venue: "部分确认",
      reservation: "未知",
      confidence: "0.42",
    },
  },
  {
    id: "sri-lanka-vesak",
    title: "2026卫塞节布施茶会",
    source: "斯里兰卡驻华",
    time: "5月30日 16:00-19:00",
    venue: "斯里兰卡驻华大使馆",
    reason: "Ready",
    type: "ready",
    badges: ["无需预约", "图片抽取", "可发布"],
    summary: "中英文活动图均给出时间、地点和入场方式；适合直接进入发布前确认。",
    fields: {
      time: "已确认",
      venue: "已确认",
      reservation: "无需预约",
      confidence: "0.91",
    },
  },
];

const sources = [
  ["印度驻华大使馆", "healthy", "28m ago", "last run success"],
  ["IICPechino", "healthy", "1h ago", "2 drafts generated"],
  ["斯里兰卡驻华", "warn", "Yesterday", "image-dominant parser"],
  ["墨西哥驻华大使馆", "warn", "4d ago", "no recent upcoming posts"],
  ["某文化中心", "bad", "6h ago", "fetch_timeout x2"],
];

const runs = [
  ["10:42", "success", "18 sources", "6 posts, 3 drafts"],
  ["06:42", "partial", "18 sources", "2 fetch_timeout"],
  ["02:42", "success", "18 sources", "1 post, 1 draft"],
  ["22:42", "success", "18 sources", "no new posts"],
  ["18:42", "failed", "4 sources", "network unavailable"],
  ["14:42", "success", "18 sources", "5 posts, 2 drafts"],
];

const published = [
  ["2026卫塞节布施茶会", "5月30日", "无需预约", "ok"],
  ["卡塔克与塔布拉鼓深度工作坊", "5月30日", "二维码待确认", "warn"],
  ["墨西哥足球嘉年华", "5月24日", "已结束，需隐藏", "bad"],
  ["当代发展讲座", "5月27日", "地址缺失", "warn"],
];

let selectedDraftId = drafts[0].id;
let currentFilter = "all";

const draftList = document.querySelector("#draft-list");
const draftDetail = document.querySelector("#draft-detail");
const sourceList = document.querySelector("#source-list");
const runList = document.querySelector("#run-list");
const publishedList = document.querySelector("#published-list");
const modalRoot = document.querySelector("#modal-root");

function badgeClass(text) {
  if (text.includes("缺") || text.includes("低") || text.includes("不要")) return "red";
  if (text.includes("待") || text.includes("二维码") || text.includes("今晚")) return "amber";
  if (text.includes("可") || text.includes("无需") || text.includes("已确认")) return "green";
  return "blue";
}

function healthClass(status) {
  if (status === "bad" || status === "failed") return "bad";
  if (status === "warn" || status === "partial") return "warn";
  return "";
}

function filteredDrafts() {
  if (currentFilter === "missing") return drafts.filter((draft) => draft.type === "missing");
  if (currentFilter === "duplicate") return drafts.filter((draft) => draft.type === "duplicate");
  return drafts;
}

function renderDrafts() {
  draftList.innerHTML = filteredDrafts().map(renderDraftCard).join("");
  draftList.querySelectorAll("[data-draft]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedDraftId = button.dataset.draft;
      renderDrafts();
      renderDraftDetail();
    });
  });
}

function renderDraftCard(draft) {
  const selected = draft.id === selectedDraftId ? " is-selected" : "";
  return `
    <button class="draft-card${selected}" type="button" data-draft="${draft.id}">
      <div class="draft-top">
        <div>
          <h3>${draft.title}</h3>
          <span class="muted">${draft.source} · ${draft.time}</span>
        </div>
        <span class="badge ${badgeClass(draft.reason)}">${draft.reason}</span>
      </div>
      <p>${draft.summary}</p>
      <div class="badge-row">${draft.badges.map((badge) => `<span class="badge ${badgeClass(badge)}">${badge}</span>`).join("")}</div>
    </button>
  `;
}

function selectedDraft() {
  return drafts.find((draft) => draft.id === selectedDraftId) || drafts[0];
}

function renderDraftDetail() {
  const draft = selectedDraft();
  draftDetail.innerHTML = `
    <p class="eyebrow">Selected draft</p>
    <h2 class="detail-title">${draft.title}</h2>
    <p class="detail-summary">${draft.summary}</p>
    <div class="field-grid">
      ${Object.entries(draft.fields)
        .map(
          ([key, value]) => `
          <div class="field">
            <span class="field-label">${key}</span>
            <strong>${value}</strong>
          </div>
        `,
        )
        .join("")}
    </div>
    <div class="action-row">
      <button class="small-button dark" type="button">Review draft</button>
      <button class="small-button" type="button">Open source</button>
      <button class="small-button" type="button">Mark duplicate</button>
    </div>
  `;
}

function renderSources() {
  sourceList.innerHTML = sources
    .map(
      ([name, status, lastRun, note]) => `
        <div class="table-row">
          <div class="row-main">
            <span class="health-dot ${healthClass(status)}"></span>
            <div>
              <span class="row-title">${name}</span>
              <span class="row-meta">${note}</span>
            </div>
          </div>
          <span class="count-pill">${lastRun}</span>
        </div>
      `,
    )
    .join("");
}

function renderRuns() {
  runList.innerHTML = runs
    .map(
      ([time, status, scope, result]) => `
        <div class="table-row">
          <div>
            <span class="row-title">${time} · ${scope}</span>
            <span class="row-meta">${result}</span>
          </div>
          <span class="badge ${healthClass(status) === "bad" ? "red" : healthClass(status) === "warn" ? "amber" : "green"}">${status}</span>
        </div>
      `,
    )
    .join("");
}

function renderPublished() {
  publishedList.innerHTML = published
    .map(
      ([title, date, status, level]) => `
        <div class="published-item">
          <div>
            <h3>${title}</h3>
            <span class="row-meta">${date}</span>
          </div>
          <span class="badge ${level === "bad" ? "red" : level === "warn" ? "amber" : "green"}">${status}</span>
        </div>
      `,
    )
    .join("");
}

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    currentFilter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("is-selected", item === button));
    renderDrafts();
  });
});

document.querySelector("[data-open-seed]").addEventListener("click", () => {
  modalRoot.innerHTML = `
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Add seed URL">
      <div class="modal">
        <div class="modal-header">
          <h2>Add seed URL</h2>
          <button class="icon-button" type="button" data-close-modal aria-label="Close">×</button>
        </div>
        <form class="modal-body">
          <label>
            <span class="field-label">Source article URL</span>
            <input value="https://mp.weixin.qq.com/s/example" />
          </label>
          <label>
            <span class="field-label">Operator note</span>
            <textarea>Official account article from an embassy or cultural center.</textarea>
          </label>
          <button class="primary-action" type="button" data-close-modal>Queue source check</button>
        </form>
      </div>
    </div>
  `;
  modalRoot.querySelectorAll("[data-close-modal]").forEach((item) => item.addEventListener("click", closeModal));
});

function closeModal() {
  modalRoot.innerHTML = "";
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModal();
});

renderDrafts();
renderDraftDetail();
renderSources();
renderRuns();
renderPublished();
