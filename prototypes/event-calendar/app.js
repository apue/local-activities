const today = "2026-05-27";

const events = [
  {
    id: "italy-contemporary",
    bucket: "今天",
    bucketDate: "5月27日 周三",
    title: "当代发展：Pietro Ruffo、Flavio Favelli 与 Daniele Sigalot",
    originalTitle: "Sviluppi del Contemporaneo",
    organizer: "IICPechino",
    sourceType: "意大利使馆文化中心",
    timeLabel: "19:00",
    dateText: "5月27日",
    timeText: "19:00",
    venue: "意大利驻华使馆文化中心",
    area: "朝阳",
    address: "地址待官方页面补充",
    reservation: "need",
    reservationLabel: "需实名预约",
    status: "scheduled",
    statusLabel: "今晚",
    visual: "italy",
    summary:
      "意大利使馆文化中心与意大利驻华大使馆举办当代艺术讲座，艺术家 Pietro Ruffo、Flavio Favelli 与 Daniele Sigalot 到场分享。",
    notes: ["实名预约，座位有限", "需持有效身份证件原件入场", "1.2米以下儿童谢绝入场"],
    sourceUrl: "https://mp.weixin.qq.com/s/7pxDkaPCtPyaGKb5lGeG9g",
    actionImage: {
      label: "报名二维码",
      visual: "qr-italy",
    },
    evidence: [
      {
        label: "活动海报",
        visual: "italy",
      },
      {
        label: "报名二维码",
        visual: "qr-italy",
      },
    ],
  },
  {
    id: "sri-lanka-vesak",
    bucket: "本周末",
    bucketDate: "5月30日 周六",
    title: "2026卫塞节布施茶会",
    originalTitle: "Vesak Dansala 2026",
    organizer: "斯里兰卡驻华大使馆",
    sourceType: "使馆活动",
    timeLabel: "16:00-19:00",
    dateText: "5月30日",
    timeText: "16:00-19:00",
    venue: "斯里兰卡驻华大使馆",
    area: "建华路",
    address: "北京市建华路3号",
    reservation: "free",
    reservationLabel: "无需预约",
    status: "scheduled",
    statusLabel: "周末",
    visual: "sri-lanka",
    summary:
      "斯里兰卡驻华大使馆邀请公众参加卫塞节布施茶会，现场提供锡兰冰红茶与传统斯里兰卡小吃。",
    notes: ["All are welcome", "信息主要来自中英文活动图", "地址已按中文图标准化"],
    sourceUrl: "https://mp.weixin.qq.com/s/9LN6Uo2aurZXjMrerVuT6w",
    evidence: [
      {
        label: "中文活动图",
        visual: "sri-lanka",
      },
      {
        label: "英文活动图",
        visual: "sri-lanka-en",
      },
    ],
  },
  {
    id: "india-masterclass",
    bucket: "本周末",
    bucketDate: "5月30日 周六",
    title: "节奏・韵律・表达：卡塔克与塔布拉鼓深度工作坊",
    originalTitle: "Taal, Laya & Abhinaya",
    organizer: "印度驻华大使馆",
    sourceType: "使馆文化中心",
    timeLabel: "15:00-17:00",
    dateText: "5月30日",
    timeText: "15:00-17:00",
    venue: "印度驻华使馆",
    area: "亮马桥",
    address: "北京市朝阳区亮马桥北街5号",
    reservation: "need",
    reservationLabel: "扫码报名",
    status: "scheduled",
    statusLabel: "周末",
    visual: "india",
    summary:
      "由 Vidushi Surangama 与 Suramya Pushan 带来的卡塔克舞蹈、塔布拉鼓和 Abhinaya 表达大师课。",
    notes: ["报名入口在海报二维码中", "适合印度文化、舞蹈与音乐爱好者"],
    sourceUrl: "https://mp.weixin.qq.com/s/lmSAjseKEzNU5drU3LLaeA",
    actionImage: {
      label: "报名二维码海报",
      visual: "qr-india",
    },
    evidence: [
      {
        label: "含报名二维码海报",
        visual: "qr-india",
      },
      {
        label: "课程说明图",
        visual: "india-notes",
      },
    ],
  },
  {
    id: "palladio-preview",
    bucket: "下周",
    bucketDate: "6月上旬",
    title: "Chinese Voices on Palladio 相关展览预告",
    originalTitle: "Flowers of Time preview",
    organizer: "意大利驻华大使馆",
    sourceType: "相关展览提及",
    timeLabel: "日期待确认",
    dateText: "6月上旬",
    timeText: "待确认",
    venue: "东景缘寺庙",
    area: "东城",
    address: "地址待确认",
    reservation: "pending",
    reservationLabel: "信息待确认",
    status: "pending",
    statusLabel: "待确认",
    visual: "palladio",
    summary:
      "来源文章提及 Pietro Ruffo 与 Lois Conner 的作品在东景缘寺庙预展。时间和预约方式需要人工确认后才可公开发布。",
    notes: ["这是 secondary mention", "不应自动发布为正式活动", "需要管理员确认活动边界"],
    sourceUrl: "https://mp.weixin.qq.com/s/7pxDkaPCtPyaGKb5lGeG9g",
    evidence: [
      {
        label: "来源文章封面",
        visual: "palladio",
      },
    ],
  },
  {
    id: "mexico-football",
    bucket: "已结束参考",
    bucketDate: "5月24日 周日",
    title: "墨西哥足球嘉年华",
    originalTitle: "Mexico Football Fest",
    organizer: "墨西哥驻华大使馆",
    sourceType: "使馆节日活动",
    timeLabel: "09:00-晚间",
    dateText: "5月24日",
    timeText: "09:00 until late",
    venue: "首农东枫国际体育园",
    area: "朝阳",
    address: "北京市朝阳区农展馆南路甲9号",
    reservation: "free",
    reservationLabel: "无需报名",
    status: "ended",
    statusLabel: "已结束",
    visual: "mexico",
    summary:
      "面向公众的墨西哥足球节，包含球星对谈、球迷挑战、足球锦标赛、美食与现场娱乐。",
    notes: ["免费入场", "无需报名", "主流程默认不展示已结束活动"],
    sourceUrl: "https://mp.weixin.qq.com/s/tZcV_vd_3Y8G6NnyJNTdYw",
    evidence: [
      {
        label: "活动节目海报",
        visual: "mexico",
      },
    ],
  },
];

let selectedId = events[0].id;

const agendaEl = document.querySelector("#agenda");
const desktopDetailEl = document.querySelector("#desktop-detail");
const mobileDetailEl = document.querySelector("#mobile-detail");
const modalRoot = document.querySelector("#modal-root");

function statusClass(event) {
  if (event.status === "ended") return "ended";
  if (event.reservation === "need") return "need";
  if (event.reservation === "free") return "free";
  return "pending";
}

function groupEvents() {
  return events.reduce((groups, event) => {
    if (!groups.has(event.bucket)) {
      groups.set(event.bucket, { title: event.bucket, date: event.bucketDate, events: [] });
    }
    groups.get(event.bucket).events.push(event);
    return groups;
  }, new Map());
}

function renderAgenda() {
  const groups = Array.from(groupEvents().values());
  agendaEl.innerHTML = groups
    .map(
      (group) => `
        <section class="time-group" aria-label="${group.title}">
          <div class="group-header">
            <h3 class="group-title">${group.title}</h3>
            <span class="group-date">${group.date}</span>
          </div>
          <div class="event-list">
            ${group.events.map(renderCard).join("")}
          </div>
        </section>
      `,
    )
    .join("");

  agendaEl.querySelectorAll(".event-card").forEach((button) => {
    button.addEventListener("click", () => selectEvent(button.dataset.eventId, true));
  });
}

function renderCard(event) {
  const selected = event.id === selectedId ? " is-selected" : "";
  return `
    <button class="event-card${selected}" type="button" data-event-id="${event.id}">
      <span class="thumb">${renderVisual(event.visual, event.originalTitle, "thumb")}</span>
      <span class="event-main">
        <span class="event-topline">
          <span class="time-pill">${event.timeLabel}</span>
          <span class="status ${statusClass(event)}">${event.reservationLabel}</span>
        </span>
        <h3>${event.title}</h3>
        <span class="card-meta">
          <span>${event.organizer}</span>
          <span>${event.area} · ${event.venue}</span>
        </span>
      </span>
    </button>
  `;
}

function renderDetail(event, mode = "desktop") {
  const isMobile = mode === "mobile";
  const actionImageButton = event.actionImage
    ? `<button class="action-button" type="button" data-open-visual="${event.actionImage.visual}" data-image-label="${event.actionImage.label}">⌗ ${event.actionImage.label}</button>`
    : "";
  const sourceLink = `<a class="action-button secondary" href="${event.sourceUrl}" target="_blank" rel="noreferrer">↗ 官方来源</a>`;
  const mapLink = event.address.includes("待确认")
    ? ""
    : `<a class="action-button secondary" href="https://map.baidu.com/search/${encodeURIComponent(event.address)}" target="_blank" rel="noreferrer">⌖ 地图</a>`;

  return `
    <article class="${isMobile ? "mobile-sheet" : ""}">
      ${
        isMobile
          ? `<div class="backbar"><button class="icon-button" type="button" data-close-detail aria-label="返回">‹</button><strong>${event.statusLabel}</strong></div>`
          : ""
      }
      <div class="detail-hero">
        ${renderVisual(event.visual, event.originalTitle, "hero")}
      </div>
      <div class="detail-body">
        <span class="source-type">${event.sourceType}</span>
        <h2 class="detail-title">${event.title}</h2>
        <div class="tag-row">
          <span class="status ${statusClass(event)}">${event.reservationLabel}</span>
          <span class="status ${event.status === "ended" ? "ended" : "free"}">${event.statusLabel}</span>
        </div>
        <p class="summary">${event.summary}</p>

        <div class="fact-grid" aria-label="Event facts">
          <div class="fact"><span class="meta-label">时间</span><strong>${event.dateText} · ${event.timeText}</strong></div>
          <div class="fact"><span class="meta-label">地点</span><strong>${event.venue}</strong></div>
          <div class="fact"><span class="meta-label">地址</span><strong>${event.address}</strong></div>
          <div class="fact"><span class="meta-label">主办方</span><strong>${event.organizer}</strong></div>
        </div>

        <div class="detail-actions">
          ${actionImageButton}
          ${mapLink}
          ${sourceLink}
        </div>

        <section class="body-section">
          <h3>确认事项</h3>
          <p>${event.notes.join("；")}。</p>
        </section>

        <section class="body-section">
          <h3>官方证据</h3>
          <div class="evidence-grid">
            ${event.evidence.map(renderEvidence).join("")}
          </div>
        </section>
      </div>
    </article>
  `;
}

function renderEvidence(item) {
  return `
    <button class="evidence-button" type="button" data-open-visual="${item.visual}" data-image-label="${item.label}">
      ${renderVisual(item.visual, item.label, "evidence")}
      <span class="evidence-label">${item.label}</span>
    </button>
  `;
}

function renderVisual(visual, label, size) {
  return `
    <span class="poster-art ${visual} ${size}" aria-label="${label}" role="img">
      <span class="poster-mark"></span>
      <span class="poster-copy">${label}</span>
    </span>
  `;
}

function selectEvent(id, openOnMobile = false) {
  selectedId = id;
  renderAgenda();
  renderDesktopDetail();
  if (openOnMobile && window.matchMedia("(max-width: 859px)").matches) {
    openMobileDetail();
  }
}

function selectedEvent() {
  return events.find((event) => event.id === selectedId) || events[0];
}

function bindDetailInteractions(root) {
  root.querySelectorAll("[data-open-visual]").forEach((button) => {
    button.addEventListener("click", () => {
      openImageModal(button.dataset.openVisual, button.dataset.imageLabel);
    });
  });
  const close = root.querySelector("[data-close-detail]");
  if (close) close.addEventListener("click", closeMobileDetail);
}

function renderDesktopDetail() {
  desktopDetailEl.innerHTML = renderDetail(selectedEvent());
  bindDetailInteractions(desktopDetailEl);
}

function openMobileDetail() {
  mobileDetailEl.innerHTML = renderDetail(selectedEvent(), "mobile");
  mobileDetailEl.classList.add("is-open");
  mobileDetailEl.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  bindDetailInteractions(mobileDetailEl);
}

function closeMobileDetail() {
  mobileDetailEl.classList.remove("is-open");
  mobileDetailEl.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function openImageModal(visual, label) {
  modalRoot.innerHTML = `
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="${label}">
      <div class="modal">
        <div class="modal-header">
          <h2>${label}</h2>
          <button class="icon-button" type="button" data-close-modal aria-label="关闭">×</button>
        </div>
        <div class="modal-content">
          ${renderVisual(visual, label, "modal-visual")}
          <p>保留为官方 evidence；用户无需从图片中二次寻找核心时间地点。</p>
        </div>
      </div>
    </div>
  `;
  modalRoot.querySelector("[data-close-modal]").addEventListener("click", closeModal);
  modalRoot.querySelector(".modal-backdrop").addEventListener("click", (event) => {
    if (event.target.classList.contains("modal-backdrop")) closeModal();
  });
}

function closeModal() {
  modalRoot.innerHTML = "";
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeModal();
    closeMobileDetail();
  }
});

renderAgenda();
renderDesktopDetail();
