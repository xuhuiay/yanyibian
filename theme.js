/* ============================================================
   汐星札记 —— 昼夜主题切换
   ============================================================

   分工：首帧的主题由各页 <head> 里的内联脚本决定（见 HTML），
   这个文件负责之后的交互。之所以要分两处，是因为内联脚本必须
   同步执行才能赶在首帧之前，而它又不能太大——逻辑放这里，
   内联那部分只做「读存储 + 设属性」一件事。

   默认暗色。不跟随 prefers-color-scheme：站点本来就是为深色设计的，
   跟随系统会改变现有访客看到的第一印象。要改成跟随系统，
   改 head 里那行内联脚本即可。
   ============================================================ */

(function () {
  "use strict";

  var STORE_KEY = "sheenova-theme";
  var ANIM_MS = 460;          // 略长于 CSS 的 .42s，确保过渡跑完再摘类
  var root = document.documentElement;
  var timer = null;

  function current() {
    return root.getAttribute("data-theme") === "light" ? "light" : "dark";
  }

  function label(theme) {
    return theme === "light" ? "切换到黑夜模式" : "切换到白天模式";
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function sync() {
    var theme = current();
    var text = label(theme);
    var isLight = theme === "light";
    var buttons = document.querySelectorAll(".theme-toggle");

    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-label", text);
      buttons[i].setAttribute("title", text);
      buttons[i].setAttribute("aria-pressed", isLight ? "true" : "false");
    }
  }

  function apply(theme) {
    var animate = !prefersReducedMotion();

    if (animate) {
      root.classList.add("theme-anim");

      /* 强制一次样式计算。不这么做的话，浏览器可能把「加类」和
         「改 data-theme」合并进同一次样式计算，过渡的起点与终点
         一起被应用，动画根本不会启动——表现为直接跳变。 */
      void root.offsetWidth;
    }

    root.setAttribute("data-theme", theme);

    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (animate) {
      timer = setTimeout(function () {
        root.classList.remove("theme-anim");
        timer = null;
      }, ANIM_MS);
    }

    sync();
  }

  function toggle() {
    var next = current() === "light" ? "dark" : "light";
    apply(next);
    try {
      localStorage.setItem(STORE_KEY, next);
    } catch (error) {
      /* 隐私模式 / 存储被禁：主题仍然切换，只是不记住。静默即可，
         这不是用户需要知道的故障。 */
    }
  }

  /* 用事件委托而不是逐个绑监听：实验页的顶栏是动态渲染的，
     按钮在 DOMContentLoaded 时可能还不存在，逐个绑会漏掉。 */
  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || typeof target.closest !== "function") return;

    var button = target.closest(".theme-toggle");
    if (!button) return;

    event.preventDefault();
    toggle();
  });

  sync();

  /* 供实验页在动态插入顶栏后重新同步按钮状态用 */
  window.SheenovaTheme = {
    get: current,
    set: apply,
    toggle: toggle,
    sync: sync
  };
})();
