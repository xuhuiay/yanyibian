(() => {
  "use strict";

  const STORAGE_KEY = "starflow-workspace-v1";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = selector => document.querySelector(selector);
  const uid = () => `node-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const defaults = [
    { id: "trigger", type: "agent", label: "理解任务", prompt: "先读懂用户的目标，提炼出清晰的任务边界。", enabled: true, status: "idle" },
    { id: "research", type: "tool", label: "收集材料", prompt: "整理已有资料，找到可以支撑判断的关键信息。", enabled: true, status: "idle" },
    { id: "draft", type: "agent", label: "生成初稿", prompt: "把信息组织成一版可以继续修改的初稿。", enabled: true, status: "idle" },
    { id: "review", type: "review", label: "人工确认", prompt: "检查结果是否符合真实场景，再决定是否发布。", enabled: true, status: "idle" }
  ];
  const typeMeta = {
    agent: { name: "智能体", icon: "AI" },
    tool: { name: "工具调用", icon: "◎" },
    router: { name: "条件分流", icon: "↗" },
    review: { name: "人工确认", icon: "人" }
  };
  let state = loadState();
  let selectedId = state.nodes[0]?.id || null;
  let running = false;

  function cloneDefaults() { return defaults.map(node => ({ ...node })); }
  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Array.isArray(saved.nodes)) return { name: saved.name || "内容研究助手", nodes: saved.nodes };
    } catch (error) { /* Ignore malformed local data and use the starter flow. */ }
    return { name: "内容研究助手", nodes: cloneDefaults() };
  }
  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: state.name, nodes: state.nodes }));
    $("#save-state").textContent = "已自动保存";
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
  }
  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2400);
  }
  function renderSavedFlows() {
    $("#saved-flow-list").innerHTML = `
      <button class="saved-flow-item is-active" type="button">
        <span></span><b>${escapeHtml(state.name)}</b><small>${state.nodes.length} 节点</small>
      </button>`;
  }
  function renderCanvas() {
    const canvas = $("#flow-canvas");
    $("#canvas-title").textContent = state.name;
    $("#flow-name").value = state.name;
    $("#node-count").textContent = state.nodes.length;
    $("#canvas-empty").hidden = state.nodes.length > 0;
    canvas.innerHTML = state.nodes.map((node, index) => {
      const meta = typeMeta[node.type] || typeMeta.agent;
      const statusLabel = node.status === "running" ? "运行中" : node.status === "complete" ? "已完成" : node.enabled ? "待执行" : "已停用";
      return `<div class="flow-node-wrap">
        <button class="flow-node ${node.id === selectedId ? "is-selected" : ""} ${node.status === "running" ? "is-running" : ""} ${node.status === "complete" ? "is-complete" : ""} ${node.enabled ? "" : "is-disabled"}" type="button" data-node-id="${node.id}">
          <span class="node-icon ${node.type}">${meta.icon}</span>
          <span class="node-copy"><b>${escapeHtml(node.label)}</b><small>${escapeHtml(node.prompt || meta.name)}</small></span>
          <span class="node-status">${statusLabel}</span>
        </button>
      </div>`;
    }).join("");
  }
  function renderInspector() {
    const node = state.nodes.find(item => item.id === selectedId);
    $("#inspector-empty").hidden = Boolean(node);
    $("#node-form").hidden = !node;
    if (!node) return;
    const meta = typeMeta[node.type] || typeMeta.agent;
    $("#inspector-index").textContent = String(state.nodes.indexOf(node) + 1).padStart(2, "0");
    $("#selected-node-preview").innerHTML = `<span class="node-icon ${node.type}">${meta.icon}</span><span><b>${meta.name}</b><small>流程中的第 ${state.nodes.indexOf(node) + 1} 步</small></span>`;
    $("#node-label").value = node.label;
    $("#node-type").value = node.type;
    $("#node-prompt").value = node.prompt;
    $("#node-enabled").checked = node.enabled;
  }
  function render() { renderSavedFlows(); renderCanvas(); renderInspector(); }
  function selectedNode() { return state.nodes.find(node => node.id === selectedId); }
  function updateSelected(callback) {
    const node = selectedNode();
    if (!node) return;
    callback(node);
    saveState();
    render();
  }
  function resetStatuses() {
    state.nodes.forEach(node => { node.status = "idle"; });
  }
  function addNode(type) {
    const meta = typeMeta[type] || typeMeta.agent;
    const count = state.nodes.filter(node => node.type === type).length + 1;
    const node = { id: uid(), type, label: `${meta.name}${count > 1 ? ` ${count}` : ""}`, prompt: type === "tool" ? "调用一个工具，返回可以继续处理的结果。" : type === "router" ? "根据当前结果判断下一步应该走哪一条路径。" : type === "review" ? "停下来检查结果，把最终决定交给人。" : "让智能体完成一个明确的小任务。", enabled: true, status: "idle" };
    state.nodes.push(node);
    selectedId = node.id;
    saveState();
    render();
    showToast(`已添加${meta.name}`);
  }
  async function runFlow() {
    if (running || !state.nodes.length) return;
    running = true;
    resetStatuses();
    $("#run-flow").disabled = true;
    $("#run-state").className = "run-state is-running";
    $("#run-state").innerHTML = "<i></i>运行中";
    render();
    for (const node of state.nodes) {
      if (!node.enabled) continue;
      selectedId = node.id;
      node.status = "running";
      render();
      await new Promise(resolve => window.setTimeout(resolve, reducedMotion ? 100 : 560));
      node.status = "complete";
      render();
    }
    running = false;
    $("#run-flow").disabled = false;
    $("#run-state").className = "run-state is-success";
    $("#run-state").innerHTML = "<i></i>流程完成";
    saveState();
    showToast("流程已完成一轮本地演示");
  }

  $("#flow-name").addEventListener("input", event => {
    state.name = event.target.value.trim() || "未命名流程";
    $("#canvas-title").textContent = state.name;
    saveState();
    renderSavedFlows();
  });
  $("#flow-canvas").addEventListener("click", event => {
    const nodeButton = event.target.closest("[data-node-id]");
    if (!nodeButton) return;
    selectedId = nodeButton.dataset.nodeId;
    render();
  });
  document.querySelectorAll("[data-add-node]").forEach(button => button.addEventListener("click", () => addNode(button.dataset.addNode)));
  $("#node-label").addEventListener("input", event => updateSelected(node => { node.label = event.target.value || "未命名节点"; }));
  $("#node-type").addEventListener("change", event => updateSelected(node => { node.type = event.target.value; }));
  $("#node-prompt").addEventListener("input", event => updateSelected(node => { node.prompt = event.target.value; }));
  $("#node-enabled").addEventListener("change", event => updateSelected(node => { node.enabled = event.target.checked; node.status = "idle"; }));
  $("#delete-node").addEventListener("click", () => {
    if (!selectedNode()) return;
    state.nodes = state.nodes.filter(node => node.id !== selectedId);
    selectedId = state.nodes[Math.max(0, state.nodes.length - 1)]?.id || null;
    saveState();
    render();
    showToast("节点已删除");
  });
  $("#new-flow").addEventListener("click", () => {
    state = { name: "新的流程", nodes: [{ ...defaults[0], id: uid(), label: "理解任务" }] };
    selectedId = state.nodes[0].id;
    resetStatuses();
    saveState();
    render();
    showToast("已新建流程");
  });
  $("#reset-flow").addEventListener("click", () => {
    if (running) return;
    state = { name: "内容研究助手", nodes: cloneDefaults() };
    selectedId = state.nodes[0].id;
    saveState();
    render();
    showToast("已恢复示例流程");
  });
  $("#run-flow").addEventListener("click", runFlow);
  render();
})();
